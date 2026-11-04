# German voice preparation

Set the pronunciation language in the story before exporting spoken input:

```yaml
voice:
  lang: de
pronunciations:
  JSON: Dschejssen
```

The JSON reading is an example to audition, not a universal default or a listening-verified recommendation. With Misaki 0.9.4 and native eSpeak NG 1.52.0, `Dschejssen` produces `ʤˈɛjsən`; `Dschäison` produces `ʤˈɛːiːzˌoːn` (inspected 4 November 2026). This phoneme comparison supports an audition candidate, not a listening judgment. Put the author's chosen readings in the story's glossary and `pronunciations` mapping. Keep canonical terms in narration and captions. `explainery narration` applies substitutions only to voice input; spoken alignment recovers canonical text. Core supplies German letter-name defaults for common acronyms such as API and KI. Product names, identifiers and their spoken numbers belong in the story. Follow the [pronunciation guidance](authoring.md#pronunciation-and-voice-direction) and [language contract](adr/0014-language-aware-pronunciation.md).

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

The [Martin runner](../scripts/martin-tts.py) accepts explicit local assets and spoken input. It does not download assets or connect to services, and it is separate from `explainery voice`. Use Python 3.11 with the inspected dependency versions:

```bash
uv pip install --python "$HOME/.venvs/kokoro/bin/python" \
  kokoro-onnx==0.6.1 misaki==0.9.4 phonemizer==3.4.0 \
  espeakng-loader==0.2.4 onnxruntime==1.30.0 numpy==2.4.6 soundfile==0.14.0
```

Use native eSpeak NG (`brew install espeak-ng` on macOS). The bundled library failed to load on the inspected Apple Silicon machine; specify `PHONEMIZER_ESPEAK_LIBRARY=/opt/homebrew/lib/libespeak-ng.dylib` there. Other platforms can set their native library path or use system library discovery. `ESPEAK_DATA_PATH` optionally selects matching eSpeak data; otherwise the native library uses its installation's default data for German G2P.

Create a UTF-8 request with exactly `speed` and `clips`; each clip contains exactly `id` and `text`. Text is already-prepared spoken input: the runner applies no story pronunciation substitutions. For acronym auditions, `A-P-I`, `K-I` and `M-C-P` produce German letter names in this frontend; `A-P-Is` preserves the plural suffix, whereas `A-P-I-s` spells a separate S. Keep canonical text and candidate readings in story-owned notes.

```json
{"speed": 1, "clips": [{"id": "umlauts", "text": "fünf, München"}]}
```

Run from the core checkout, with generated audio in a story-owned ignored directory:

```bash
PHONEMIZER_ESPEAK_LIBRARY=/opt/homebrew/lib/libespeak-ng.dylib \
  "$HOME/.venvs/kokoro/bin/python" scripts/martin-tts.py \
  --model "$HOME/.cache/hyperframes/tts/martin/a1cba7fbf0e72fbae38f0a3a48ce0dc8e6077804/kokoro-martin.onnx" \
  --voices "$HOME/.cache/hyperframes/tts/martin/a1cba7fbf0e72fbae38f0a3a48ce0dc8e6077804/voices-martin.npz" \
  --request /path/to/request.json --out /path/to/story/renders/martin-audition
```

The output directory must be absent or empty. One CPU ONNX session synthesizes clips serially as mono 24 kHz PCM16 WAV files. Audio above a peak amplitude of 0.98 is attenuated to 0.98 before PCM conversion; quieter audio is unchanged. Empty, silent or nonfinite audio fails. `manifest.json` records spoken text, resulting phonemes, durations, source peaks, applied gains, runtime versions, settings, and SHA-256 identities for the model, voice pack, request, runner and audio files. It appears only after every clip succeeds; a failed synthesis can leave partial WAVs without a manifest. Preserve the manifest alongside audition evidence. It establishes provenance, not a production cache key or listening approval.

Requests are limited to 128 KiB, 64 clips, 2,000 text characters per clip, and 510 resulting phonemes per clip. IDs are lowercase alphanumeric slugs with optional hyphens, at most 80 characters. Speed must be finite and between 0.5 and 2; models with integer speed inputs reject fractional speeds. Unknown phonemes fail before inference rather than being filtered out. The runner requires Misaki 0.9.4 and kokoro-onnx 0.6.1, applies the training guide's `ʏ → y` correction, and preserves Misaki's `I`, `W`, `ʦ` and `ʧ` tokens for German diphthongs and affricates.

Run the [regression suite](../tests/test_martin_tts.py) with `PYTHONDONTWRITEBYTECODE=1 "$HOME/.venvs/kokoro/bin/python" -m unittest discover -s tests -p test_martin_tts.py`; audio conversion tests require NumPy, but no test loads a model. With `PHONEMIZER_ESPEAK_LIBRARY` set, the same command also checks real German G2P for “fünf”, “München”, and diphthongs/affricates. Full synthesis and listening remain separate checks.
