# Local voice and delivery

Use this workflow after the story's [pronunciation and sample review](authoring.md#pronunciation-and-voice-direction). Keep the glossary, canonical script and listening evidence in the story repository. The [production decision](adr/0009-production-provenance.md) defines provenance and reuse limits.

## Generate and align

The installed HyperFrames Kokoro models and Python runtime are prerequisites. Set `HYPERFRAMES_PYTHON` to that runtime when it is not the shell's `python3`. No model or dependency installation is performed by `voice`.

```bash
pnpm exec explainery voice film --sample opening --voice af_heart --speed 0.9
# Listen and record the result in the story's glossary before generating the full voice.
pnpm exec explainery voice film --voice af_heart --speed 0.9 --out assets/narration.wav
pnpm exec explainery align film --audio assets/narration.wav --transcript drafts/recognition.json --transcript-mode spoken --segments film/.explainery/voice/film/manifest.json
pnpm exec explainery assemble film
```

`--sample` selects a composition ID. Cached audio lives under the project's ignored `.explainery/voice/cache`; only compositions whose spoken inputs or synthesis settings changed are regenerated. `--gap` adds silence after each composition's required hold minus overlap. The returned manifest contains measured segment boundaries, hashes and settings. Copy a production manifest to a tracked story-owned path if it is needed to reproduce later alignment.

Recognition is a separate step: `--transcript` reads a JSON array of `{text,start,end}` word records; omitting it invokes the pinned HyperFrames transcriber. Preserve raw recognition output when available. `--transcript-mode spoken` matches pronunciation-expanded voice input and returns canonical caption words. Default `canonical` retains the existing transcript contract. `--segments` accepts either an array of `{id,start,end}` or a voice manifest; all compositions must be covered in order. The default alignment report is `film/.explainery/alignment.json`; `--report` chooses another path. Review every inferred beat and the affected animations and joins.

## Record and verify

```bash
pnpm exec explainery production film --transcript drafts/transcript.json --transcript-mode spoken --segments assets/voice-manifest.json
pnpm exec explainery preflight film
pnpm exec explainery verify film --scene opening --out renders/verification/opening
pnpm exec explainery verify film --film --out renders/verification/full
```

Paths passed to `production` are relative to the project directory; other CLI input/output paths are relative to the current working directory unless explicitly described otherwise. Record only after reviewing the actual audio, transcript and timing. The root must contain one `audio[data-story-audio][data-story-span]` narration track starting at zero and bound to `timing.audio`; other audio tracks may coexist. Check in `production.json` and its source inputs. Imported recordings can be recorded without synthesis or realignment. A failed preflight names stale inputs; inspect the cause before explicitly recording a new snapshot.

Verification writes JSON receipts and an HTML contact sheet. Isolated/full comparisons default to a maximum difference of one channel level; `--pixel-tolerance 2` is an explicit, recorded override for investigated raster rounding, not a substitute for review. Inspect the frames as part of scene review; automated pixel comparisons cannot judge visual intent. `verify` uses its explicit scene selection, ignores sticky focus and never changes it.

## Deliver and reuse

```bash
pnpm exec explainery deliver film --out renders/film
```

The command produces MP4, standalone HTML with captions, SRT, VTT, checksums and delivery metadata. It checks provenance before starting, verifies the video and offline HTML, and refuses to finish a successful delivery report if checks fail. Repeating it reuses the verified MP4 when inputs and output bytes match, while rebuilding inexpensive sidecars and HTML. Output remains local; nothing is uploaded or published.

For scene or full-film delivery rendering, `render --quality delivery --reuse` opts into verified MP4 reuse. `--workers 2` explicitly chooses two capture workers; the default remains one. A changed worker count invalidates the cache. Stage progress includes elapsed time and a stage-local ETA when counters support it. No speedup is promised for a particular machine.

Keep `renders/` and `.explainery/` ignored. Render cache receipts sit beside MP4s as `.mp4.render.json`; deleting a receipt simply requires a fresh render. An existing video without a receipt cannot be safely inferred to match current sources from its duration alone.

## Prepare YouTube text

```bash
pnpm exec explainery youtube film --metadata docs/delivery/youtube.json --out renders/youtube
```

This generates `renders/youtube-title.txt` and `renders/youtube-description.txt` without rendering or contacting YouTube. Paths are relative to the working directory. The command always uses the full film, ignores sticky focus and requires aligned or imported timing. Use the story and timing associated with the video being uploaded; this text export does not inspect an MP4 or establish delivery provenance.

Keep the editorial title and description in tracked story-local JSON, following the [metadata template](templates/youtube.json). An optional `{chapters}` marker expands to editorial scene titles and start times, rounded down to whole seconds. Omitting the marker produces a description without chapters. Additional JSON fields are ignored, so an existing publication-settings record can remain in the same file; this command does not apply those settings or produce an upload API payload. Edit the source JSON and regenerate rather than editing the output files.

The exporter checks the [YouTube title and description limits](https://developers.google.com/youtube/v3/docs/videos#snippet) and the [manual chapter requirements](https://support.google.com/youtube/answer/9884579): at least three chapters, starting at zero, each at least ten seconds after whole-second rounding. These checks do not guarantee that a channel has access to chapter features. Title and summary are authored editorially; generation keeps the copy-ready files and chapter timestamps synchronized with their sources.
