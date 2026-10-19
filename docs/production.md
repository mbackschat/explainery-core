# Local voice and delivery

Use this workflow after the story's [pronunciation and sample review](authoring.md#pronunciation-and-voice-direction). Keep the glossary, canonical script and listening evidence in the story repository. The [production decision](adr/0009-production-provenance.md) defines provenance and reuse limits.

## Generate and align

The installed HyperFrames Kokoro models and Python runtime are prerequisites. Set `HYPERFRAMES_PYTHON` to that runtime when it is not the shell's `python3`. `explainery voice` checks that runtime first and names a missing interpreter or package together with this variable. No model or dependency installation is performed by `voice`.

Keep the film's voice settings in `story.yaml`, so every run of `voice` keeps the same pacing:

```yaml
voice:
  name: af_heart   # Kokoro voice; its first letter selects the language
  speed: 0.9
  gap: 0.6         # seconds of silence after each composition's hold minus overlap
```

```bash
pnpm exec explainery voice film --sample opening
# Listen and record the result in the story's glossary before generating the full voice.
pnpm exec explainery voice film --out assets/narration.wav
pnpm exec explainery transcribe film --segments film/assets/narration.wav.voice.json --out film/drafts/transcript.json
pnpm exec explainery align film --audio assets/narration.wav --transcript film/drafts/transcript.json --transcript-mode spoken --segments film/assets/narration.wav.voice.json
pnpm exec explainery assemble film
```

`voice` takes each setting from its option when given (`--voice`, `--speed`, `--gap`), otherwise from the story's `voice`, otherwise from the defaults `af_heart`, 1 and 0.4 s. The language follows from the Kokoro voice name's first letter, which the [voice module](../src/voice.ts) maps to a locale, for example `a` to `en-us` and `b` to `en-gb`; `--lang` overrides it for one command and is deliberately no story setting, because a stored language could only contradict the voice. `--sample` selects a composition ID. Cached audio lives under the project's ignored `.explainery/voice/cache`; only compositions whose spoken inputs or synthesis settings changed are regenerated. `--gap` adds silence after each composition's required hold minus overlap.

The manifest records measured segment boundaries, each composition's clip and its hash, and the settings. With `--out`, `voice` writes it beside the audio as `<out>.voice.json`, for example `assets/narration.wav.voice.json`, so the audio and the segments that describe it are tracked together without a copy. Without `--out`, audio and manifest stay in the ignored `.explainery/voice/film/`, or `.explainery/voice/samples/<id>/` for a sample. Running `voice` again replaces the manifest; when its content changes, `preflight` reports a recorded production as stale until it is recorded again.

`transcribe` recognizes each clip in the manifest separately with the pinned `hyperframes transcribe` defaults and shifts its words by the clip's segment start, so the words fall on the clock of the audio `voice` wrote. It writes the JSON array of `{text,start,end}` word records that `align --transcript` and `production --transcript` read; the default output is `film/.explainery/transcribe/transcript.json`, and `--out` chooses another path. Each clip's recognition is cached under the ignored `.explainery/transcribe/cache` by the clip's hash and the HyperFrames version, so after re-voicing one composition only its clip is recognized again. A clip is recognized only while its bytes match the manifest. The cache does not record which engine the pinned CLI chose; delete it after installing or removing a recognition engine. For an explicit engine, model or language, run `hyperframes transcribe` on the full audio yourself as before.

Recognition stays a separate step from alignment: `--transcript` reads a JSON array of `{text,start,end}` word records; omitting it invokes the pinned HyperFrames transcriber on the full audio. Preserve raw recognition output when available. `--transcript-mode spoken` matches pronunciation-expanded voice input and returns canonical caption words. Default `canonical` retains the existing transcript contract. `--segments` accepts either an array of `{id,start,end}` or a voice manifest; all compositions must be covered in order. The default alignment report is `film/.explainery/alignment.json`; `--report` chooses another path. Review every inferred beat and the affected animations and joins.

The report is one object. `diagnostics` lists the beats whose anchor word was inferred rather than recognized, each as `{compositionId, beat, time, reason}`. `compositions` maps each composition ID to its script words in narration order, on that composition's clock:

```json
{ "text": "retries", "start": 4.12, "end": 4.58, "beat": "retry", "offset": 0.86 }
```

`start` and `end` are composition-local seconds, like the beats in `timing.json`. `beat` is the last marker before the word and `offset` the seconds from that beat to the word's start, so the word reads as `beat('retry') + 0.86` in a timeline or `checkout:retry+0.86` as a snapshot address; words before the first marker carry neither. `"inferred": true` marks a word the transcript did not contain, whose time is interpolated. Words keep the script's spelling, not the recognizer's. The cues are a reading aid for authoring: they change with every alignment, so anchor animation to beats and treat offsets as authored seconds that need rechecking after a re-voice.

## Record and verify

```bash
pnpm exec explainery production film --transcript drafts/transcript.json --transcript-mode spoken --segments assets/narration.wav.voice.json
pnpm exec explainery preflight film
pnpm exec explainery verify film --scene opening --out renders/verification/opening
pnpm exec explainery verify film --film --out renders/verification/full
pnpm exec explainery verify film --scene payments --composition checkout --quick --out renders/verification/checkout
```

Paths passed to `production` are relative to the project directory; other CLI input/output paths are relative to the current working directory unless explicitly described otherwise. Record only after reviewing the actual audio, transcript and timing. The root must contain one `audio[data-story-audio][data-story-span]` narration track starting at zero and bound to `timing.audio`; other audio tracks may coexist. Check in `production.json` and its source inputs. Imported recordings can be recorded without synthesis or realignment. Segments describe the audio `voice` wrote: a post-processed file, such as a loudness-normalized delivery track, has another hash, so `production --segments` rejects the manifest for it. Record such audio with `production` without `--segments`. A failed preflight names stale inputs; inspect the cause before explicitly recording a new snapshot.

Verification writes JSON receipts and an HTML contact sheet. Isolated/full comparisons default to a maximum difference of one channel level; `--pixel-tolerance 2` is an explicit, recorded override for investigated raster rounding, not a substitute for review. Inspect the frames as part of scene review; automated pixel comparisons cannot judge visual intent. `verify` uses its explicit scene selection, ignores sticky focus and never changes it.

Each beat frame is captured 0.3 s after its beat, and its caption on the contact sheet carries the narration words written between that beat's marker and the next. `--composition <id>` limits every capture to one composition; it must belong to a selected scene (any scene when `--scene` is omitted), and verification then opens only that scene. `--quick` captures only beat and closing frames: it skips the seek-history and isolation comparisons and the join frames, records `"quick": true` in the receipt, and so rejects `--pixel-tolerance`. Use it while revising a scene; run full verification before recording or delivery. Both modes read each composition's headline and support line at its closing frame and fail a headline that wraps onto a second line or a support line that runs past two, and fail a card whose title wraps or whose roadmap entry is cut off; [the authoring guide](authoring.md#write-headlines-that-state-the-claim) explains the one-line rule. Both modes also warn about a static stretch: at least 6 seconds inside one beat in which nothing new starts or finishes moving in the composition's timeline. A tween longer than 6 seconds, such as a camera drift, counts only where it starts, because a slow drift does not change what the viewer reads. The CLI prints each one, the receipt lists them under `staticBeats` and the contact sheet names them; they do not fail verification, because a deliberate hold on a settled diagram is legitimate. Check each against the [motion rule](authoring.md#show-the-mechanism-and-let-motion-tell-it) and either add motion on the spoken words or keep the hold on purpose.

## Deliver and reuse

```bash
pnpm exec explainery deliver film --out renders/film
```

The command produces MP4, standalone HTML with captions, SRT, VTT, checksums and delivery metadata. It checks provenance before starting, verifies the video and offline HTML, and refuses to finish a successful delivery report if checks fail. Repeating it reuses the verified MP4 when inputs and output bytes match, while rebuilding inexpensive sidecars and HTML. Output remains local; nothing is uploaded or published.

For scene, composition or full-film delivery rendering, `render --quality delivery --reuse` opts into verified MP4 reuse; a composition render is verified without chapters. `--workers 2` explicitly chooses two capture workers; the default remains one. A changed worker count invalidates the cache. Stage progress includes elapsed time and a stage-local ETA when counters support it. No speedup is promised for a particular machine.

Keep `renders/` and `.explainery/` ignored. Render cache receipts sit beside MP4s as `.mp4.render.json`; deleting a receipt simply requires a fresh render. An existing video without a receipt cannot be safely inferred to match current sources from its duration alone.

## Prepare YouTube text

```bash
pnpm exec explainery youtube film --metadata docs/delivery/youtube.json --out renders/youtube
```

This generates `renders/youtube-title.txt` and `renders/youtube-description.txt` without rendering or contacting YouTube. Paths are relative to the working directory. The command always uses the full film, ignores sticky focus and requires aligned or imported timing. Use the story and timing associated with the video being uploaded; this text export does not inspect an MP4 or establish delivery provenance.

Keep the editorial title and description in tracked story-local JSON, following the [metadata template](templates/youtube.json). An optional `{chapters}` marker expands to editorial scene titles and start times, rounded down to whole seconds. Omitting the marker produces a description without chapters. Additional JSON fields are ignored, so an existing publication-settings record can remain in the same file; this command does not apply those settings or produce an upload API payload. Edit the source JSON and regenerate rather than editing the output files.

The exporter checks the [YouTube title and description limits](https://developers.google.com/youtube/v3/docs/videos#snippet) and the [manual chapter requirements](https://support.google.com/youtube/answer/9884579): at least three chapters, starting at zero, each at least ten seconds after whole-second rounding. These checks do not guarantee that a channel has access to chapter features. Title and summary are authored editorially; generation keeps the copy-ready files and chapter timestamps synchronized with their sources.
