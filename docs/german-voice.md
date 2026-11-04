# German voice preparation

Set the pronunciation language in the story before exporting spoken input:

```yaml
voice:
  lang: de
pronunciations:
  JSON: Dschäison
```

The JSON reading is an example to audition, not a universal default or a listening-verified recommendation. Put the author's chosen readings in the story's glossary and `pronunciations` mapping. Keep canonical terms in narration and captions. `explainery narration` applies substitutions only to voice input; spoken alignment recovers canonical text. Core supplies German letter-name defaults for common acronyms such as API and KI. Product names, identifiers and their spoken numbers belong in the story. Follow the [pronunciation guidance](authoring.md#pronunciation-and-voice-direction) and [language contract](adr/0014-language-aware-pronunciation.md).

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
