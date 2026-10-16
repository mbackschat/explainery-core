# 0007 HTML chapter navigation and optional subtitles

Accepted 2026-10-16.

## Decision

The shared [explainer page](../../src/explainer.ts) supplies chapter navigation and optional subtitle playback for both the folder and single-file exports. Every film has a chapter menu derived by the same [editorial chapter function](../../src/chapters.ts) as MP4 output. Selecting a chapter preserves the playing or paused state. Existing silent scene players remain independent.

Export accepts `--subtitles <file.vtt>` or the API option `{ subtitles: string }`, resolved from the caller's working directory. The [input reader](../../src/export-subtitles.ts) accepts Explainery's plain-text WebVTT subset, validates ordered non-overlapping cue ranges against the film duration, and decodes escaped text once. Invalid input fails before the output is replaced. Export does not generate subtitles or discover them implicitly: the caller chooses the reviewed file belonging to the narration.

Cues are embedded as escaped JSON and displayed as text, never executable markup. This keeps folder and single-file behavior identical and allows offline playback without fetching a subtitle sidecar. The CC / Subtitles toggle appears only when cues are supplied and starts off on each page load. Captions occupy a separate area below the picture so they do not obscure diagrams. A single grid cell contains the visible cue and invisible, accessibility-hidden sizing copies of every cue. Its height accommodates the tallest cue at the current width, including wrapping; cue changes and gaps cannot resize the video or move its controls. Explicit content-box sizing and disabled flex shrinking keep theme resets and fullscreen flex layout from consuming that reserved space. Fullscreen includes the main player, captions and controls; its button is available only when the browser supports the standard fullscreen API.

## Playback controls

The page omits a repeated visible film title and bounds the chapter selector width. Both the custom toolbar and native playback/volume controls fade after three seconds without activity during playback. Movement or touch over the film, toolbar or composition iframe reveals them, as do keyboard interaction, pause and playback end. Pointer use and keyboard focus within controls prevent hiding; opacity changes retain the reserved layout and do not affect subtitles. The same idle state hides the cursor in the viewer, player shadow root and composition iframe; revealing controls restores the authored cursors.

HyperFrames 0.8.142 owns a separate native-control hide timer and exposes no coordination API. A scoped style in its open shadow root lets the export control the opacity and pointer handling of `.hfp-controls` alongside its own toolbar. Browser tests guard that pinned selector and both visibility states. No player dependency files are changed.

A separator and an **Individual scenes** heading distinguish the silent scene breakdown from the full film. A compact index uses editorial scene titles and section anchors, keeping navigation available without JavaScript. Each silent scene starts paused at its entrance, with the slider at the left and scene-local time at zero; after a scrub or pause, play resumes from that position, and replay at the end returns to the entrance. A shared handler owns the visible Play/Pause button and picture click, with HyperFrames’ implicit click handler disabled to prevent double toggles. The position slider, local elapsed time and playback status follow the player clock; dragging pauses playback for inspection. Control text changes only when its value changes: replacing a button’s unchanged text node on animation frames cancels pointer clicks in WebKit 26.0. The browser regression guard preserves that node between pointer down and up.

The player owns time. The page reads `currentTime` on animation frames rather than maintaining a second clock. HyperFrames 0.8.142's `seek()` changes that property without always dispatching `timeupdate`, so polling also covers paused scrubs without patching the player or depending on its shadow controls. Cue intervals include their start and exclude their end; gaps clear the displayed text.

## Output location

The single-file CLI defaults to `renders/<story-id>-full.html` relative to the working directory, matching the MP4 and subtitle output convention. `--out` remains an explicit override. The exporter creates missing parent directories, and story repositories ignore `renders/*.html`. Earlier root-level files are not moved or removed automatically.

## Scope and verification

There is one optional subtitle track. Styled WebVTT, cue positioning, metadata blocks, SRT input, Studio controls and subtitles for the silent scene players are excluded. The existing [subtitle sidecar command](0005-optional-subtitles.md) remains independent of export.

[Input tests](../../tests/export-subtitles.test.ts) and [export tests](../../tests/explainer.test.ts) cover cue fidelity, escaping, range validation, chapter markup, optional controls and CLI input handling. [Headless browser tests](../../tests/explainer-browser.test.ts) exercise the pinned player in both export formats: keyboard toggling, forward/backward paused seeks, cue gaps, playback/pause, chapter jumps, return from the end and fullscreen controls. Layout assertions use the real theme and compare video, caption and toolbar bounds across one-line cues, two-line cues and gaps at desktop and mobile widths, including fullscreen. The single-file test uses `file://` and blocks HTTP requests to prove playback needs no network.
