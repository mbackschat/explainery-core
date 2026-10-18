# Proposal: a shorter review loop

Status: proposal, 2026-10-18; not implemented. Evidence comes from revising two story films after [ADR 0011](../adr/0011-scene-revision-loop.md). Each review round still went through MP4 renders of about 45 minutes. Some compositions carried two topics under one headline. Delivery audio was normalized by scripts outside core.

## R1 — Headlines that change at a beat (required)

A composition's headline stays on screen for the whole composition. A composition that turns to a second topic, such as a 74-second module that first shows a rule and then the package that registers it, keeps a headline that no longer describes the diagram. Splitting it into two compositions would cost a re-voice and a retime.

`copy.headlines` maps a beat to the headline shown from that beat on:

```yaml
copy:
  headline: A rule blocks the write; an operation fixes both
  headlines:
    required-optional: A package registers its rules and operations
  support: The rule and operation share the loaded workspace.
```

Contract:

- `headline` stays required and is shown from the copy entrance until the first `headlines` beat. Each key must name a beat of the same composition, and validation rejects an unknown beat.
- At each beat the runtime wipes the current headline out and the new one in. The swap uses the entrance wipe's timing and stays deterministic under seeking.
- Verification applies the one-line check to every headline, each at its own beat.
- Chapters, cards and subtitles keep using `headline`.

Excluded: changing the support line or category at a beat, and an automated length limit for compositions. A long composition is not a defect by itself, so the [authoring guide](../authoring.md#write-headlines-that-state-the-claim) instead recommends a beat headline, or a split, where the topic changes.

Feasibility risk: the headline swap replaces text that `data-variable-values` supplies once per composition. The runtime must keep every variant in the DOM, or swap the text on a timeline callback that replays correctly on a backward seek.

## R2 — Review in the browser, render for delivery (required)

`explainery review` builds the explainer page for a selection into `.explainery/review/` and serves it locally until interrupted:

```sh
explainery review film --scene payments
```

- The page plays the selected scenes with the recorded narration, a scrubber and the scene's text, as the explainer export does today. It does not render an MP4.
- Selection follows `preview`: focus by default, with `--scene`, `--composition` and `--film` as one-command overrides.
- The command prints the URL and the path of the latest `verify --quick` sheet for the same selection, if one exists.

The authoring guide then names this page as the review step, with MP4 renders for delivery and verification only. R2 depends on `verify` comparing MP4 frames with snapshots at beat times: without that check, review in the browser would miss render-only defects.

Excluded: live reload, and narration captions in the review page; `preview --narration` already shows them in a silent draft.

Feasibility risk: real-time playback of heavy scenes, such as a large node field, may stutter in the browser even though renders are frame-exact. This needs a measurement on the heaviest current composition before the guide recommends the page.

## R3 — Delivery audio mastering in core (optional)

`explainery master` normalizes voiced audio for delivery and records how:

```sh
explainery master film --in .explainery/voice/narration.wav --out assets/narration.m4a
```

- It runs two-pass dynamic loudness normalization: −16 LUFS integrated, −1.5 dBTP true peak and 11 LU range by default, each overridable by an option. It encodes AAC at 128 kbit/s at the source's sample rate and channel count, with no speed change.
- It writes `<out>.master.json` with the input and output SHA-256, the targets and both FFmpeg measurements.
- `production --segments` accepts a mastered file when its sidecar names the voiced audio that the segment manifest describes. Mastering never changes timing, so the segments remain valid. This removes today's rule that a post-processed delivery track is recorded without segments.

Excluded: normalization inside `voice` (see [ADR 0011](../adr/0011-scene-revision-loop.md#alternatives-rejected)), mixing several audio tracks, and music or effects; the [sound proposal](background-sound.md) covers those.

Feasibility risk: the chain of custody holds only if `master` refuses an input whose hash differs from the manifest's `audioSha256`. A story that edits audio by hand must keep recording it without segments.
