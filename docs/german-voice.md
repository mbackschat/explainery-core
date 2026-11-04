# German voice preparation

**Golden rule: English technical terms retain English pronunciation inside German and every other non-English narration.** Set the surrounding narration language, then annotate additional English terms independently:

```yaml
voice:
  lang: de
pronunciations:
  Engine:
    text: Engine
    lang: en-us
```

Engine is already covered by the [shared technical dictionary](../data/english-technical-terms.json); the explicit entry illustrates how to annotate other terms and choose an English dialect. The dictionary also covers Engines, Agent Loop, Kernel, Workflow Engine, Data Service, Browser, Web-Stack, A2A and `Plattformcode → platform code`. English technical initialisms use English letter names; German KI uses separate German `K I`. JSON uses the English “Jason” reading through English phonemization, not a German spelling approximation. The previous German-only audition was rejected, so its aliases are not pronunciation recommendations.

Keep canonical terms in narration and captions. Product names, identifiers and their confirmed readings belong in the story glossary. The dictionary cannot detect every English term: inventory unfamiliar terms, plurals and compounds and add explicit language annotations. Export with `explainery narration --json` to preserve language runs; plain text export refuses mixed-language plans. Follow the [pronunciation guidance](authoring.md#pronunciation-and-voice-direction) and [mixed-language contract](adr/0015-english-terms-in-non-english-narration.md).

## Martin model and storage

Martin is a German-trained Kokoro-compatible model, requiring its own weights as well as its voice data. The [original model](https://huggingface.co/kikiri-tts/kikiri-german-martin) and [ONNX conversion](https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin) state Apache-2.0 licensing. The ONNX inference assets total **326,035,136 bytes**, approximately **326 MB / 311 MiB**; runtime dependencies and generated audio are additional. Training checkpoints are unnecessary for inference.

Recommended shared location: `~/.cache/hyperframes/tts/martin/<revision>/`. Keep model binaries outside core and story Git repositories, separate from the standard English model. Reuse this cache across stories; generated story audio and its provenance remain story-owned. This is a storage recommendation, not an automatic installer or a declaration that assets are installed.

Pinned [repository metadata](https://huggingface.co/api/models/Godelaune/Kokoro-82M-ONNX-German-Martin/tree/a1cba7fbf0e72fbae38f0a3a48ce0dc8e6077804?recursive=true), inspected on 4 November 2026:

| Asset | Bytes | SHA-256 from upstream metadata |
| --- | ---: | --- |
| `kokoro-martin.onnx` | 325,512,630 | `c302f1d8bc7adf40a842cb550e18c39a5026bdb1afdd29dbb700b501cb49276b` |
| `voices-martin.npz` | 522,506 | `5b9c8553398d7abf67498ce500c186cefaa7b68fed3e3d415da5380670105acd` |

Revision: `a1cba7fbf0e72fbae38f0a3a48ce0dc8e6077804`. Verify downloaded bytes against these hashes before use; metadata inspection is not local checksum verification.

## Runtime requirement

The [conversion's initialization](https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/blob/a1cba7fbf0e72fbae38f0a3a48ce0dc8e6077804/onnx-docker/main.py) uses ONNX Runtime and `kokoro-onnx`; Docker is service packaging, not an inference requirement. Its model and voice pack need no separate tokenizer/config asset. However, direct stock `create(text, lang="de")` does not reproduce the training frontend.

The [training guide](https://github.com/semidark/kikiri-tts/blob/a12d0410e89841e6f3c09958ae5c072f90ae1d49/docs/TRAINING_GUIDE.md#2-prepare-dataset) requires Misaki German G2P followed by `ʏ → y`. Inspection of `kokoro-onnx` 0.6.1 on 4 November 2026 reproduced the stock tokenizer silently removing `ʏ` from “fünf” and “München”. A Martin adapter must preserve the training frontend's phoneme transformations before vocabulary filtering, and include preprocessing/model identity in its cache key. Term substitutions alone cannot repair a dropped phoneme.

`explainery voice` currently rejects German through the stock HyperFrames adapter. First establish a matching local runtime and audition a representative sample with ordinary German, umlauts and the story's technical terms. Keep pronunciation choices separate from listening findings. Only then generate full narration, align the actual audio, and inspect the affected beats and joins.

## Local audition runner

The [Martin runner](../scripts/martin-tts.py) accepts explicit local assets and spoken input with language runs. It does not download assets or connect to services, and it is separate from `explainery voice`. Use Python 3.11 with the inspected dependency versions:

```bash
uv pip install --python "$HOME/.venvs/kokoro/bin/python" \
  kokoro-onnx==0.6.1 misaki==0.9.4 phonemizer==3.4.0 \
  espeakng-loader==0.2.4 onnxruntime==1.30.0 numpy==2.4.6 soundfile==0.14.0
```

Use native eSpeak NG (`brew install espeak-ng` on macOS). The bundled library failed to load on the inspected Apple Silicon machine; specify `PHONEMIZER_ESPEAK_LIBRARY=/opt/homebrew/lib/libespeak-ng.dylib` there. Other platforms can set their native library path or use system library discovery. `ESPEAK_DATA_PATH` optionally selects matching eSpeak data; otherwise the native library uses its installation's default data for German G2P.

Create a UTF-8 request with `explainery narration <project> --json`, selecting the desired clips for an audition. The request contains exactly `speed` and `clips`; every clip contains exactly `id`, `text` and `runs`. Each run contains `text` and `lang`, and their texts must join exactly to the clip text. The runner accepts `de`, `en-us` and `en-gb`; other languages fail explicitly. Existing text-only audition requests must be re-exported from canonical narration and the current glossary, since their language choices were discarded. Do not wrap old German approximations in an English run.

```json
{"speed":1,"clips":[{"id":"engine","text":"Die Engine nutzt K I.","runs":[{"text":"Die ","lang":"de"},{"text":"Engine","lang":"en-us"},{"text":" nutzt K I.","lang":"de"}]}]}
```

Run from the core checkout, with generated audio in a story-owned ignored directory:

```bash
PHONEMIZER_ESPEAK_LIBRARY=/opt/homebrew/lib/libespeak-ng.dylib \
  "$HOME/.venvs/kokoro/bin/python" scripts/martin-tts.py \
  --model "$HOME/.cache/hyperframes/tts/martin/a1cba7fbf0e72fbae38f0a3a48ce0dc8e6077804/kokoro-martin.onnx" \
  --voices "$HOME/.cache/hyperframes/tts/martin/a1cba7fbf0e72fbae38f0a3a48ce0dc8e6077804/voices-martin.npz" \
  --request /path/to/request.json --out /path/to/story/renders/martin-audition
```

The output directory must be absent or empty. English terms pass through English G2P, German prose through German G2P; their phonemes are joined for one Martin inference per clip. One CPU ONNX session synthesizes clips serially as mono 24 kHz PCM16 WAV files. Audio above a peak amplitude of 0.98 is attenuated to 0.98 before PCM conversion; quieter audio is unchanged. Empty, silent or nonfinite audio fails. `manifest.json` records spoken text, language runs, resulting phonemes, durations, source peaks, applied gains, runtime versions, settings, and SHA-256 identities for the model, voice pack, request, runner, shared dictionary and audio files. It appears only after every clip succeeds; a failed synthesis can leave partial WAVs without a manifest. Preserve the manifest alongside audition evidence. It establishes provenance, not listening approval.

Requests are limited to 128 KiB, 64 clips, 2,000 text characters and 512 language runs per clip, and 510 resulting phonemes per clip. IDs are lowercase alphanumeric slugs with optional hyphens, at most 80 characters. Speed must be finite and between 0.5 and 2; models with integer speed inputs reject fractional speeds. Known English terms assigned to German runs fail, including terms split across run boundaries. Unknown phonemes fail before inference rather than being filtered out. The runner requires Misaki 0.9.4 and kokoro-onnx 0.6.1, applies the training guide's `ʏ → y` correction only to German runs, and preserves Misaki's diphthong and affricate tokens. English phoneme routing must still be evaluated by listening: a German-trained model is not guaranteed to realize every supplied English sound intelligibly.

Run the [regression suite](../tests/test_martin_tts.py) with `PYTHONDONTWRITEBYTECODE=1 "$HOME/.venvs/kokoro/bin/python" -m unittest discover -s tests -p test_martin_tts.py`; audio conversion tests require NumPy, but no test loads a model. With `PHONEMIZER_ESPEAK_LIBRARY` set, the same command also checks real German G2P for “fünf”, “München”, and diphthongs/affricates. Full synthesis and listening remain separate checks.
