#!/usr/bin/env python3
"""Synthesize spoken German input using local Martin assets and the training frontend."""

import argparse
import ctypes.util
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import re

LEXICON = Path(__file__).resolve().parents[1] / "data/english-technical-terms.json"
LANGUAGES = {"de", "en-us", "en-gb"}


class PhonemeLimitError(ValueError):
    pass


def validate_runs(text, runs):
    if not isinstance(runs, list) or not 1 <= len(runs) <= 512:
        raise ValueError("each clip requires explicit language runs; export with explainery narration --json")
    for run in runs:
        if not isinstance(run, dict) or set(run) != {"text", "lang"}:
            raise ValueError("each language run must contain exactly text and lang")
        if not isinstance(run["text"], str) or not run["text"]:
            raise ValueError("language run text must be nonempty")
        if not isinstance(run["lang"], str) or run["lang"] not in LANGUAGES:
            raise ValueError("Martin supports only de, en-us and en-gb language runs")
    if "".join(run["text"] for run in runs) != text:
        raise ValueError("language runs must join exactly to clip text")
    lexicon = json.loads(LEXICON.read_text(encoding="utf-8"))
    terms = sorted(set(lexicon) | set(lexicon.values()), key=len, reverse=True)
    pattern = re.compile(r"(?<![^\W_])(?:" + "|".join(re.escape(term) for term in terms) + r")(?![^\W_])")
    # ADR 0015: inspect the joined text, so splitting Engine across runs cannot evade the rule.
    for match in pattern.finditer(text):
        offset = 0
        for run in runs:
            end = offset + len(run["text"])
            if offset < match.end() and end > match.start() and not run["lang"].startswith("en-"):
                raise ValueError(f"English technical term {match[0]!r} requires English language runs")
            offset = end


def validate_request(request):
    if not isinstance(request, dict) or set(request) != {"speed", "clips"}:
        raise ValueError("request must contain exactly speed and clips")
    speed = request["speed"]
    if type(speed) not in (int, float) or not math.isfinite(speed) or not 0.5 <= speed <= 2:
        raise ValueError("speed must be a finite number between 0.5 and 2")
    clips = request["clips"]
    if not isinstance(clips, list) or not 1 <= len(clips) <= 64:
        raise ValueError("request must contain 1–64 clips")
    seen = set()
    for clip in clips:
        if not isinstance(clip, dict) or set(clip) != {"id", "text", "runs"}:
            raise ValueError("each clip must contain exactly id, text and runs; export with explainery narration --json")
        clip_id, text = clip["id"], clip["text"]
        if not isinstance(clip_id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", clip_id) or len(clip_id) > 80:
            raise ValueError("clip id must be a lowercase slug of at most 80 characters")
        if clip_id in seen:
            raise ValueError(f"duplicate clip id: {clip_id}")
        seen.add(clip_id)
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError(f"{clip_id}: text must contain 1–2000 characters")
        validate_runs(text, clip["runs"])
    return request


def read_request(path):
    with path.open("rb") as source:
        data = source.read(128 * 1024 + 1)
    if len(data) > 128 * 1024:
        raise ValueError("request exceeds 128 KiB")
    return validate_request(json.loads(data))


def phonemize_runs(runs, frontends, vocabulary):
    parts = []
    for run in runs:
        if not run["text"].strip():
            continue
        phones, _ = frontends[run["lang"]](run["text"])
        # kikiri-tts a12d041, TRAINING_GUIDE.md §2 specifies this correction for German G2P.
        if run["lang"] == "de":
            phones = phones.replace("ʏ", "y")
        parts.append(phones)
    phones = " ".join(" ".join(parts).split())
    if not phones:
        raise ValueError("each passage must produce nonempty phonemes")
    unknown = sorted(set(phones) - set(vocabulary))
    if unknown:
        symbols = ", ".join(f"{symbol!r} U+{ord(symbol):04X}" for symbol in unknown)
        raise ValueError(f"unknown phonemes (nothing was discarded): {symbols}")
    if len(phones) > 510:
        raise PhonemeLimitError(f"phoneme limit exceeded: {len(phones)} > 510")
    return phones


def phonemize(text, g2p, vocabulary):
    return phonemize_runs([{"text": text, "lang": "de"}], {"de": g2p}, vocabulary)


def file_identity(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return {"path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def prepare_pcm_audio(audio):
    import numpy as np

    if audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
        raise ValueError("model returned invalid mono audio")
    peak = float(np.max(np.abs(audio)))
    if peak == 0:
        raise ValueError("model returned silent audio")
    # Martin auditions on 2026-11-04 exceeded unity; PCM16 writing would clip them.
    gain = min(1.0, 0.98 / peak)
    return (audio * gain if gain < 1 else audio), peak, gain


def create_frontend(language="de"):
    from misaki import espeak
    from phonemizer.backend.espeak.wrapper import EspeakWrapper

    library = os.environ.get("PHONEMIZER_ESPEAK_LIBRARY") or ctypes.util.find_library("espeak-ng")
    if not library:
        raise ValueError("install native espeak-ng or set PHONEMIZER_ESPEAK_LIBRARY")
    data_path = os.environ.get("ESPEAK_DATA_PATH")
    # Misaki 0.9.4 overrides the library at import; restore the selected native installation.
    EspeakWrapper.set_library(library)
    EspeakWrapper.set_data_path(data_path)
    frontend = espeak.EspeakG2P(language=language)
    wrapper = EspeakWrapper()
    # Phonemizer 3.4.0 resolves its alternate environment variable and the library's default data here.
    return frontend, str(wrapper.library_path.resolve()), str(wrapper.data_path.resolve()), wrapper.version


def runtime_identity(model_path, voices_path):
    versions = {name: importlib.metadata.version(name) for name in (
        "kokoro-onnx", "misaki", "phonemizer", "espeakng-loader", "onnxruntime", "numpy", "soundfile"
    )}
    if versions["misaki"] != "0.9.4" or versions["kokoro-onnx"] != "0.6.1":
        raise ValueError("audition frontend requires misaki==0.9.4 and kokoro-onnx==0.6.1")
    _, library, data_path, espeak_version = create_frontend()
    inputs = {"model": file_identity(model_path), "voices": file_identity(voices_path), "runner": file_identity(Path(__file__)), "technicalLexicon": file_identity(LEXICON)}
    inputs["espeakLibrary"] = file_identity(Path(library))
    inputs["espeakData"] = [file_identity(path) for path in sorted(Path(data_path).rglob("*")) if path.is_file()]
    return {
        "frontend": "per-run misaki.EspeakG2P(lang); German ʏ→y; English technical-term guard; strict vocabulary validation",
        "runtime": {**versions, "python": platform.python_version(), "platform": platform.platform(), "espeak": espeak_version},
        "inputs": inputs,
        "espeakLibrary": library,
        "espeakData": data_path,
    }


def run(model_path, voices_path, request_path, out):
    request = read_request(request_path)
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise ValueError("output directory must be absent or empty")
    identity = runtime_identity(model_path, voices_path)

    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import EspeakConfig

    g2p, library, data_path, espeak_version = create_frontend()
    frontends = {"de": g2p}
    for language in sorted({run["lang"] for clip in request["clips"] for run in clip["runs"]} - {"de"}):
        frontends[language] = create_frontend(language)[0]
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    engine = Kokoro.from_session(session, str(voices_path), espeak_config=EspeakConfig(lib_path=library, data_path=data_path))
    voices = engine.get_voices()
    if len(voices) != 1:
        raise ValueError("Martin audition requires a voice pack with exactly one voice")
    speed_input = next(item for item in session.get_inputs() if item.name == "speed")
    if "int" in speed_input.type and request["speed"] != int(request["speed"]):
        raise ValueError("this model accepts only integer speed; refusing implicit rounding")
    prepared = [{**clip, "phonemes": phonemize_runs(clip["runs"], frontends, engine.tokenizer.vocab)} for clip in request["clips"]]
    manifest = {
        "schemaVersion": 1,
        "frontend": identity["frontend"],
        "runtime": identity["runtime"],
        "inputs": {**identity["inputs"], "request": file_identity(request_path)},
        "settings": {"voice": voices[0], "language": "de", "speed": request["speed"], "provider": "CPUExecutionProvider", "intraOpThreads": 2, "interOpThreads": 1, "sampleRate": 24000, "channels": 1, "subtype": "PCM_16", "trim": True, "sentencePause": 0.25, "clausePause": 0.1, "espeakLibrary": library, "espeakData": data_path},
        "clips": [],
    }
    out.mkdir(parents=True, exist_ok=True)
    for clip in prepared:
        print(f"Synthesizing {clip['id']} ({len(clip['phonemes'])} phonemes)", flush=True)
        audio, rate = engine.create(clip["phonemes"], voice=voices[0], speed=request["speed"], lang="de", is_phonemes=True, trim=True, sentence_pause=0.25, clause_pause=0.1)
        if rate != 24000:
            raise ValueError(f"{clip['id']}: model returned an invalid sample rate")
        audio, peak, gain = prepare_pcm_audio(audio)
        wav = out / f"{clip['id']}.wav"
        sf.write(wav, audio, rate, subtype="PCM_16")
        manifest["clips"].append({**clip, "audio": file_identity(wav), "frames": len(audio), "durationSeconds": len(audio) / rate, "sourcePeak": peak, "appliedGain": gain})
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("model", "voices"):
        parser.add_argument(f"--{flag}", required=True, type=Path)
    for flag in ("request", "out"):
        parser.add_argument(f"--{flag}", type=Path)
    parser.add_argument("--identity", action="store_true", help="print local synthesis identity without loading the model")
    args = parser.parse_args()
    if args.identity and (args.request or args.out):
        parser.error("--identity cannot be combined with --request or --out")
    if not args.identity and (not args.request or not args.out):
        parser.error("--request and --out are required for synthesis")
    try:
        if args.identity:
            print(json.dumps(runtime_identity(args.model, args.voices), ensure_ascii=False))
        else:
            run(args.model, args.voices, args.request, args.out)
    except (ValueError, OSError, importlib.metadata.PackageNotFoundError) as error:
        parser.exit(1, f"martin-tts: {error}\n")


if __name__ == "__main__":
    main()
