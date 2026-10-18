# Proposal: a faster scene loop

Status: accepted for implementation on 2026-10-18, after a fresh-context review of this proposal against the code. The review changed P1–P5 and dropped P6; each section below states the reviewed design. Evidence comes from one working session that revised two story films in parallel. It added four compositions, reworked eight for motion, re-voiced both films and realigned them about five times. Fixed on the spot and therefore not proposed here:

- The card layer's unprefixed `.card` classes restyled a story's own SVG cards; they are now `explainery-card`, and a theme test guards the namespace.
- A deferred `fromTo` (`immediateRender: false`) that sets opacity in its from-state renders in snapshots but not in MP4s, so new connector lines were missing from a preview while every frame check showed them. `explainery validate` now rejects that form; the fix is `tl.set` at the tween start, then `to`.

## What held up

- One owner per fact: `story.yaml` for words, `timing.json` for seconds, compositions for pictures. Three re-voices changed almost no animation code, because timelines anchor to beats.
- Deterministic seeks plus the strict check found real defects: an element animated off target, overlapping labels, and the card collision above.
- Composition-level `defineScene` with local beats made new compositions cheap to add inside an existing editorial scene.

## Where the loop is slow

Scene focus helps most when you edit text inside one scene. It helped little in this session, for three reasons.

1. Narration couples the whole film. One changed sentence means re-voicing, realigning and shifting every later start. Each snapshot time then had to be recomputed by hand as start + beat + offset.
2. Review happens at a granularity the tools only partly offer. `explainery verify --scene` already captures one frame per beat, but without the words spoken in that beat, only after a full verification run, and only for a whole editorial scene. Ad-hoc snapshots take absolute seconds, and render accepts only editorial scenes. Showing two new compositions inside a long scene meant rendering the whole scene and cutting it with FFmpeg.
3. The voice pipeline has steps outside core. These lived in an agent's scratch directory:
   - per-segment recognition;
   - copying the manifest, which `voice` always writes to `.explainery/voice/film/manifest.json` whatever `--out` names;
   - the story-local narration provenance, which core does not own.
   Pacing also differed between films (`--gap 0.6` in one, `0` in the other) because voice settings live in a shell script, not in the story.

## Proposals

Implementation order: the two guard gaps under [Additional findings](#additional-findings), then P2, P1, P3, P5 and P4.

### P1 — Address time by beat (required)

Every snapshot time can be `composition:beat[+seconds]`, resolved through `timing.json`. A core wrapper runs HyperFrames with software capture and with `--describe false`, because HyperFrames 0.8.142 sends snapshot frames to Gemini by default whenever `GEMINI_API_KEY` is set:

```sh
explainery snapshot film --at checkout:merge+2,checkout:retry
explainery verify film --scene payments --composition checkout --quick
```

`verify` gains the review sheet instead of a new command: each beat frame's caption carries the words spoken in that beat, `--composition` narrows the sheet, and `--quick` skips the seek-history and isolation comparisons. Beat frames keep verify's existing +0.3 s offset.

### P2 — Shared motion helpers in `defineScene` (required)

Every new composition re-declared the same helpers. Some patterns caused the same defect twice: tweening `x`/`y` together with `svgOrigin` on one SVG group places it off target. The scene context offers them:

```ts
defineScene(scope, 'checkout', (tl, { beat, duration, enterCopy, motion }) => {
  motion.draw('#co-link', beat('partial') + .4);                     // length-based stroke draw
  motion.rise('#co-holder', beat('materialize'));                     // fade in while moving into place
  motion.travel('#co-token', [[150, 374], [900, 454]], beat('refuse') + .6, 1.3);  // waypoints, x/y only
  motion.pulse('#co-token-mark', '95 17', beat('retry') + 2.5);       // scale on an inner group, never with x/y
  motion.focus('#co-ledger', beat('merge'), beat('retry'), { within: '#co-diagram' });  // the rest of the diagram steps back
});
```

Contract:

- Helpers resolve elements in the composition's document, add tweens only to the scene timeline, and never emit a deferred `fromTo` with opacity in its from-state.
- A revealing helper (`draw`, `rise`) owns its target's appearance: either the markup hides the target, or the helper is the target's first tween.
- `focus` dims the other children of `within` and restores them at `until`, using `to` tweens on those wrapper groups only. Opacity multiplies, so dimming a wrapper never reveals a child that has not appeared yet. It throws when two focus windows overlap in one container or when `until` lies past the composition.
- An MP4 fixture guards the helpers, because the defect they avoid shows only in renders.

Excluded: a lint for beats whose only change is a fade. A lexical scan cannot map tweens to beats, and the runtime has no channel to report through.

### P3 — Voice settings and recognition in core (required)

- `story.yaml` gains `voice: { name, speed, gap }`, so `explainery voice <film>` needs no wrapper script and every film keeps its pacing.
- `voice` writes its manifest beside `--out`, so the tracked copy is no longer a manual step.
- `explainery transcribe <film> --segments <manifest>` recognizes each manifest clip separately, caches the result by clip hash, and writes the shifted transcript. Re-voicing one composition then re-recognizes one clip.
- Segments describe the audio `voice` wrote. Post-processed audio, such as a loudness-normalized delivery file, has another hash, so `production` records it without `--segments`, as today; `docs/production.md` states this.

Excluded: automatic retry after a synthesizer crash, because a retry would also hide real failures, and one onnxruntime abort reran fine from the cache. Also excluded: loudness normalization inside `voice`, which would let segments survive into a delivery file but adds encoding to the voice contract.

### P4 — Select compositions for preview and render (optional)

A separate `--composition <id>[,<id>]` flag selects consecutive compositions inside one editorial scene, on that scene's clock. Overloading `--scene` would be ambiguous, because a flat scene's id equals its composition id. A composition selection writes no chapters, so chapter validation and video verification accept an empty chapter list only for it. Focus is unaffected: the flag is a one-command override.

### P5 — Word cues in the alignment report (optional)

`align` already writes `.explainery/alignment.json`. It adds composition-local word times there, so in-beat offsets come from a file instead of reading the transcript by hand. A word-cue API inside timelines is excluded: recognition spells some terms differently from the script, and beats remain the authored contract.

### Dropped: a scene-local voice loop

`voice` already re-synthesizes only changed clips, and alignment is pure computation; the slow step was whole-film recognition, which P3's per-clip cache removes. Scene preview cuts its audio from the full track, and every later start shifts anyway, so a scene-local loop would add a second timing model for no remaining gain.

## Additional findings

- The card layer's fade-out uses the deferred `fromTo` opacity form that validate rejects. Its from value equals the state before the fade, so no render has shown a defect, but core must follow its own rule.
- Validate scans only story compositions, so shared layers such as `cards.html` escape the guard. It scans every composition file.

## Report upstream

The deferred-opacity render defect above, with a minimal fixture kept in core's tests: a snapshot and an MP4 of the same sub-composition disagree. Frame checks that rely on snapshots cannot catch render-only defects.

HyperFrames reports `connector_orphan` for lines whose endpoints sit inside filtered (glowing) groups, and `data-layout-allow-overlap` on a group does not cover its text children during an intentional crossfade. Both are informational, but they add noise to every strict check.
