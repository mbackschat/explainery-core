# 0011 Scene revision loop

Accepted 2026-10-18.

## Context

One working session revised two story films in parallel: it added four compositions, reworked eight for motion, re-voiced both films and realigned them about five times. Scene focus helped little. A changed sentence shifted every later start, so snapshot times were recomputed by hand. Review needed frames per beat together with the words spoken in that beat, which existed only after a full verification run and only per editorial scene. Per-segment recognition, the manifest copy and each film's voice settings lived in shell scripts outside core. Several compositions re-declared the same animation helpers and repeated the same defects, and one defect appeared only in MP4 renders, never in snapshots.

## Decision

- **Beat addresses.** `explainery snapshot --at` accepts `composition:beat[±seconds]` on the full-film clock, resolved through `timing.json`. It runs HyperFrames with software capture and `--describe false`, because HyperFrames 0.8.142 otherwise sends frames to Gemini whenever `GEMINI_API_KEY` is set. `verify --quick` captures only beat and closing frames, captions each with the words spoken in its beat, and `--composition` narrows it to one composition.
- **Motion helpers.** `defineScene` offers `motion.draw`, `rise`, `travel`, `pulse` and `focus`, documented in the [authoring guide](../authoring.md#show-the-mechanism-and-let-motion-tell-it). Helpers never emit a deferred `fromTo` with opacity in its from-state, and an MP4 fixture guards them. `explainery validate` rejects that form in every composition file, including core's card layer, because HyperFrames 0.8.142 ignores it in renders while snapshots apply it.
- **Voice in the story.** `story.yaml` carries `voice: { name, speed, gap }`. `voice --out` writes its manifest beside the audio as `<out>.voice.json`. `explainery transcribe --segments` recognizes each clip separately and caches it by clip hash, so re-voicing one composition re-recognizes one clip.
- **Word cues.** `align` writes composition-local word times, each with its beat and offset, into `.explainery/alignment.json`.
- **Composition selection.** `preview` and `render` accept `--composition <id>[,<id>]` for consecutive compositions inside one editorial scene, on that scene's clock and without chapters.

The [production guide](../production.md) and [README](../../README.md) document the commands.

## Alternatives rejected

- **A scene-local voice loop.** `voice` already re-synthesizes only changed clips and alignment is pure computation; the slow step was whole-film recognition, which per-clip caching removes. A second, scene-local timing model would gain nothing.
- **A word-cue API inside timelines.** Recognition spells some terms differently from the script. Beats stay the authored contract, and word cues remain a reading aid.
- **A lexical lint for beats whose only change is a fade.** A text scan cannot map tweens to beats, and the runtime has no channel to report through.
- **Automatic retry after a synthesizer crash.** A retry would also hide real failures; the observed onnxruntime abort reran cleanly from the cache.
- **Loudness normalization inside `voice`.** It would let segments survive into the delivery file but adds encoding to the voice contract.
- **Overloading `--scene` with composition ids.** A flat scene's id equals its composition id, so the selection would be ambiguous.

## Consequences

Snapshots cannot prove that a render shows the same thing. The [motion fixture](../../tests/fixtures/motion/) keeps a minimal reproduction of the deferred-opacity render defect for an upstream report. A post-processed delivery track has another hash than the audio `voice` wrote, so `production` records it without `--segments`.
