# Explainery

Explainery turns a few plain text files into a narrated explainer film: animated diagrams, on-screen text, and a voice, rendered on your own computer to an MP4 video and to a web page. It is open source (Apache-2.0) and built on [HyperFrames](https://hyperframes.heygen.com), which renders HTML pages into video, and [GSAP](https://gsap.com), the animation library the scenes use.

This repository, `explainery-core`, is the framework. Each film lives in its own *story* repository next to it and uses the framework from there.

## Find what you need

- Start a story: [project setup](#use-in-a-project).
- Describe or revise a scene: [scene authoring guideline](docs/knowledge/authoring.md), covering file ownership, visual beats, a story example, and review criteria.
- Time narration: [estimate](#estimate-timing-before-a-voice-exists), [draft a voice](#draft-a-voice), or [align a recording](#align-timing-to-a-recorded-voice).
- Author visuals: [write a scene](#write-a-scene) and [themes and components](#themes-and-components).
- Check and watch the film: [validate](#validate-a-project), [assemble](#assemble-the-root-composition), and [preview and render](#preview-and-render).
- Share the page: [static folder](#export-the-explainer-page) or [single file](#export-a-single-file-to-send).
- Change the framework: [development](#develop), [repository guidelines](CLAUDE.md), and [architecture decisions](docs/adr/0001-explainery-architecture.md).

## Why Explainery?

Explainer videos are usually made in animation tools, where the wording, the voice, and the movement are welded together. Changing one sentence or recording a better voice means retiming the animation by hand, and the text is locked inside a binary project file that nobody can review.

Explainery keeps those three things apart:

- **The words** live in one text file, `story.yaml`: each composition's headline, support line, and narration.
- **The timing** lives in `timing.json`. It can be estimated from the narration before any voice exists, and aligned automatically to a recorded or synthetic voice afterwards.
- **The animation** can anchor movements to named moments in the narration, called *beats*, so their starts follow the voice. Tween durations and offsets still use seconds.

Copy changes belong in `story.yaml`, and a new voice normally changes `timing.json` through alignment. Beat anchors reduce manual retiming, but longer copy can need a layout adjustment and shorter narration can leave too little room for a tween. Recheck scenes after either change; the runtime rejects timelines that overrun their composition. Everything is plain text in git, so changes can be reviewed as diffs. One story produces both the video and an explainer web page.

## Key ideas

| Term | Meaning |
| --- | --- |
| **Story** | `story.yaml`: editorial scenes in order, with on-screen copy and narration in their compositions. |
| **Scene** | A named editorial unit explaining one idea, containing one or more compositions. This is the unit you select for editing, preview, and rendering. |
| **Beat** | A named moment in the narration, written as a marker such as `{publish-setup}`. Composition code can use it as an animation start or add a seconds-based offset. |
| **Timing** | `timing.json`: composition start, duration, and local beat seconds. Its legacy `scenes` keys remain composition IDs. |
| **Composition** | An executable HTML module containing text, graphics, media elements, and animation. The root composition places these modules and shared layers on the film timeline. |
| **Theme** | Colours, fonts, background, and the layout of the text block, shared by every scene. A story adds its own colours on top. |
| **Studio** | HyperFrames' local preview: a web page that plays the film and lets you scrub to any frame while you edit. |

The [domain knowledge bundle](docs/knowledge/index.md) defines film, scene, composition, element, beat, and timeline using Open Knowledge Format v0.2. [ADR 0003](docs/adr/0003-editorial-scenes.md) records the compatibility contract.

## Work on one scene

For the scene's purpose and visual sequence, start with the story repository's scene map and linked descriptions. For how to write those descriptions and which files to edit, use the [scene authoring guideline](docs/knowledge/authoring.md). `story.yaml` declares grouping, copy, and narration; the visual plan lives in story documentation and the executable animation lives in composition HTML.

```bash
pnpm exec explainery scenes film-example
pnpm exec explainery focus film-example --scene "Introduction"
pnpm exec explainery preview film-example
pnpm exec explainery render film-example
pnpm exec explainery focus film-example --film
```

Focus is local to the film and persists in ignored `.explainery/focus.json` until changed. Each preview or render prints its target. A conversational request such as “work on Introduction” sets this focus; subsequent edits apply to that scene’s source compositions, and previews and renders use the same selection. “Work on the full film” clears it. `focus` without options reports the current target. Exact IDs or case-insensitive scene titles are accepted; ambiguous names require clarification.

`--scene <id>` or `--film` on preview/render overrides focus for one command. Consecutive scene IDs separated by commas preview their transition; titles are resolved by `focus`. A scene preview starts at zero, retains shared layers, and trims narration to its derived range. Its disposable project view refreshes from source when preview or render runs; rerun preview after any source edit, including animation, assets, styles, copy, or timing. Edit source files, never `.explainery/scenes/`; only dependencies remain linked. Render defaults to local draft quality; use `--quality delivery` for delivery. `--out` chooses the output file. Focus does not limit validation, timing generation, assembly, or explainer export.

Scenes are explicit groups in `story.scenes`; a legacy flat entry is a one-composition scene. See [the typed authoring contract](docs/knowledge/authoring.md). Add `.explainery/` to project ignores. Keep dependencies at the repository root and runtime files in one film directory when desired; commands accept that directory.

## The workflow at a glance

```bash
# 1. Write story.yaml and create index.html plus compositions/<composition-id>.html shells.
pnpm exec explainery estimate        # 2. Estimate timing from the narration's word counts.
pnpm exec explainery assemble        #    Write copy and timing into index.html.
pnpm exec explainery preview         # 3. Open the printed Studio URL for the active target.
# 4. Voice the narration (a draft voice or a recording), then time the beats to it:
pnpm exec explainery align --audio assets/narration.wav
pnpm exec explainery assemble
pnpm exec explainery validate        # 5. Check that story, timing, and scenes agree,
pnpm exec hyperframes check --no-contrast --no-browser-gpu  # audit layout, motion, and runtime errors.
pnpm exec explainery render --film --quality delivery --out renders/film.mp4  # 6. Render the full MP4,
pnpm exec explainery export          #    or the explainer page when you need the page (--single-file to send it).
```

Rendering, synthesis, and transcription in this workflow run on your computer. Dependency, browser, and speech-model setup can require downloads; HyperFrames can also contact its update and telemetry services. The render command above selects software browser capture explicitly: HyperFrames otherwise auto-detects browser GPU support, and its separate `--gpu` flag enables GPU encoding. Work in Studio and render when you need the file.

The rest of this README explains each step in detail. The design decisions behind it are recorded in [ADR 0001](docs/adr/0001-explainery-architecture.md), and [ADR 0002](docs/adr/0002-typescript.md) explains why the code is TypeScript without a build step.

## What is in this repository

| Path | Contents |
| --- | --- |
| [`schemas/`](schemas/) | JSON Schemas for `story.yaml` and `timing.json`, also usable for editor validation. |
| [`src/`](src/), [`bin/explainery.ts`](bin/explainery.ts) | The validator, the assembler, the explainer export, and the `explainery` command, in TypeScript that Node runs directly. |
| [`runtime/scene.ts`](runtime/scene.ts) | `defineScene`, the browser runtime that scenes call. Browsers load the generated [`runtime/scene.js`](runtime/scene.js). |
| [`themes/dark/`](themes/dark/) | The default theme: tokens, Roboto, texture, and the brand-frame slot. |
| [`components/`](components/) | Shared SVG components that take colour only from tokens. |
| [`tests/`](tests/) | `node:test` suites, plus HyperFrames fixture projects that prove rendering behaviour. |

## Use in a project

You need Node 22.18 or later, pnpm, and FFmpeg (including `ffprobe`). Nothing is published to npm yet, so check this repository out next to your story project and link it. Install GSAP and HyperFrames in the story too; these are the versions this checkout tests:

```json
{
  "dependencies": {
    "explainery-core": "link:../explainery-core",
    "gsap": "3.14.2",
    "hyperframes": "0.8.142"
  }
}
```

Run `pnpm install` in this checkout as well, because a linked package resolves its own dependencies from its own `node_modules`. The quickest way to start a new story is to copy the layout of an existing story project: `story.yaml`, `timing.json`, `index.html`, `compositions/`, and a theme overlay.

Run the workflow commands from the story's root directory. Each `explainery` command also accepts a project directory after its subcommand, such as `pnpm exec explainery validate ../example-story`. Scenes and the root composition are hand-authored; Explainery does not generate animation from narration. See the [story schema](schemas/story.schema.json), [timing schema](schemas/timing.schema.json), and [runtime fixture](tests/fixtures/scene-runtime/index.html) for the implemented file shapes and scene wiring.

## Estimate timing before a voice exists

```bash
pnpm exec explainery estimate            # write timing.json from the narration, at 2.5 words per second
pnpm exec explainery estimate --wps 2.2  # a slower narrator
```

`estimate` gives each composition the length of its spoken words plus its `hold`, and puts each beat after the words spoken before its marker. Compositions follow in story order, and a composition’s `overlap` starts the next one that much earlier. It writes `timing.json` with `source: estimate`, so scenes can be animated and previewed before any narration is recorded; run `explainery assemble` afterwards. It replaces an earlier estimate, but refuses to replace `aligned` or `imported` timing unless you pass `--force`, because those come from a real voice.

## Draft a voice

A recorded voiceover is the goal, but a local synthetic voice lets you hear and time a story first. `hyperframes tts` uses the local Kokoro model. HyperFrames 0.8.142 supports several languages and has no German option; `pnpm exec hyperframes tts --help` lists the voices and languages. The example below uses an American English voice. One-time setup on macOS with Homebrew under `/opt/homebrew`, and the Python packages in their own uv environment:

```bash
brew install espeak-ng
uv venv ~/.venvs/kokoro
uv pip install --python ~/.venvs/kokoro/bin/python kokoro-onnx soundfile
export HYPERFRAMES_PYTHON=~/.venvs/kokoro/bin/python
export PHONEMIZER_ESPEAK_LIBRARY=/opt/homebrew/lib/libespeak-ng.dylib
```

The Homebrew eSpeak NG library is needed because the macOS library bundled with `espeakng-loader` 0.2.4 ignores the data path it is given and fails on `/Users/runner/…/phontab` (reproduced 2026-10-09). Then voice the story and time it to that voice:

```bash
pnpm exec explainery narration > narration.txt     # the spoken text, one composition per paragraph
pnpm exec hyperframes tts narration.txt --voice am_michael -o assets/narration.wav
pnpm exec explainery align --audio assets/narration.wav
pnpm exec explainery assemble
```

A synthetic voice mispronounces some terms, such as reading an acronym as a word. Give it spellings in `story.yaml`; `narration` speaks them, while the page, transcripts and alignment keep the written words. Keys match whole, case-sensitive words:

```yaml
pronunciations:
  SPI: S-P-I        # not "spy"
  GraalJS: Graal J-S
```

To check a spelling without listening, compare the phonemes eSpeak NG gives Kokoro: `espeak-ng -q --ipa -v en-us "the DG S-P-I"`.

The first TTS run downloads the Kokoro model into `~/.cache/hyperframes`. Transcription uses an installed compatible Parakeet engine when available, otherwise Whisper with the default `small.en` model, which is downloaded on first use. If that Whisper download stalls, fetch `ggml-small.en.bin` from `huggingface.co/ggerganov/whisper.cpp` into `~/.cache/hyperframes/whisper/models/` yourself.

## Align timing to a recorded voice

```bash
pnpm exec explainery align --audio assets/narration.wav    # transcribe locally, then align
pnpm exec explainery align --audio assets/narration.wav --transcript transcript.json  # use an existing transcript
```

`align` transcribes the narration with the project's `hyperframes transcribe` and its default engine selection, matches the story's narration words to the transcript in order, and writes `timing.json` with `source: aligned`, the audio as `audio`, and its length, read with FFmpeg's `ffprobe`, as `audioDuration`. With `--transcript`, it reads that JSON instead; the audio is still required for its duration and pauses. You can omit `--audio` only when the existing `timing.json` already names it.

A beat falls where the word after its marker starts, or where the composition's last word ends when the marker closes the narration. The first composition starts at 0; each ends its `hold` after its last word, and the next starts its `overlap` earlier, including across editorial scene boundaries. Misheard words are tolerated, and a missed word gets a share of the gap between its neighbours. Whisper often drifts the words before a pause into the pause, so `align` also finds the pauses in the audio (FFmpeg's `silencedetect`: below -40 dB for at least 0.5 s) and fits the words that reach into one back to end where the pause begins. The command fails when fewer than three quarters of the narration words are found, or when a `hold` is longer than the pause before the next composition's narration.

For another language or Whisper model, run `pnpm exec hyperframes transcribe assets/narration.wav --engine whisper --model large-v3 --language de` yourself and pass its `transcript.json`. The explicit engine makes the Whisper model choice take effect even when Parakeet is installed. Beats land on the spoken word, so anticipate a word in the composition's timeline with `beat('…') - 0.3` rather than by editing `timing.json`. `align` replaces an estimate or an earlier alignment, but refuses `imported` timing unless you pass `--force`.

## Validate a project

```bash
pnpm exec explainery validate
```

This checks `story.yaml` and `timing.json` against [their](schemas/story.schema.json) [schemas](schemas/timing.schema.json), then checks that they agree with each other. Editorial scene IDs and flattened composition IDs must each be unique. Every composition must have timing that starts in story order and ends within the film. Every `{beat}` marked in its narration must have a time, in narration order and within the composition. Each composition must also have a `compositions/<id>.html` declaring `data-composition-id="<id>"`; editorial scenes need no additional HTML file or timing entry. The command prints each error and exits with status 1.

## Assemble the root composition

```bash
pnpm exec explainery assemble          # write story timing and copy into index.html
pnpm exec explainery assemble --check  # exit 1 when index.html is out of date
```

`index.html` stays hand-authored. `assemble` validates the project and then rewrites only the attributes it manages:

- **Composition hosts:** the element with `data-composition-src` and the composition's `data-composition-id` gets `data-start`, `data-duration`, and `data-variable-values` holding `{copy, beats, duration}`.
- **Story duration:** the root composition and every element marked `data-story-span` get the story duration.
- **Narration track:** the element marked `data-story-audio` gets `timing.audio` as its `src`, and ends at `timing.audioDuration` when the audio is shorter than the film, as it is when the last composition holds after the final word.

Everything else in the file is left byte for byte. `story.yaml` and `timing.json` remain the authoritative inputs for composition copy, beat times, and composition duration.

## Preview and render

Run these from the story directory after assembly:

```bash
pnpm exec explainery preview
pnpm exec explainery preview --status
pnpm exec hyperframes check --no-contrast --no-browser-gpu
pnpm exec explainery render --quality delivery
pnpm exec explainery preview --stop
```

Open the Studio URL printed by `preview`; its default starting port is 3002. Explainery starts it in the background without opening a browser and honors the active focus. `--status` and `--stop` address that target's preview. Rendering uses one worker with software browser capture. Use `--film` to operate on the whole film regardless of focus; direct HyperFrames commands also bypass Explainery focus. The strict `check` above always audits the original full project.

`validate` checks project files without executing scenes. `check` also runs the scene scripts and samples layout and motion; it catches unknown beats and timeline overruns that `lint` cannot. Use `--no-contrast` because accessibility auditing of produced animations is outside this project's scope. Browser capture and video encoding are separate: `--no-browser-gpu` forces software capture, while GPU encoding requires `--gpu`.

## Export the explainer page

The explainer page presents the film for reading rather than watching: the whole film at the top, then each scene paused on its own, beside its text. Build it only when you need the page; nothing else depends on it.

```bash
pnpm exec explainery export                    # writes ./explainer
pnpm exec explainery export --out ../site      # or any folder that is empty or an earlier export
```

The export writes a static folder with three parts:

- **`index.html`:** the page. The whole film plays at the top with its audio. Each editorial scene gets a silent player beside its title and combined composition narration, with beat markers removed. A single-composition scene also retains its category and support line.
- **`player/`:** HyperFrames' player and runtime (Apache-2.0).
- **`film/`:** every file the root composition references, copied as real files.

Each scene player is the whole film limited to the scene's window with `range-start` and `range-end`, so no per-scene build is needed. It opens on the scene's middle frame, and a scrubber below it steps frame by frame within the scene. The page links the film's own stylesheets, so it inherits the theme. Serve the folder over http(s), for example with `pnpm dlx serve explainer`, which may download `serve`. Opened as a `file://` page, the player ignores the bundled runtime and fetches one from a CDN.

## Export a single file to send

```bash
pnpm exec explainery export --single-file                  # writes ./explainer.html
pnpm exec explainery export --single-file --out film.html  # or any .html path
```

This writes the same page as one HTML file that anyone can open by double-click, offline, with no web server and no developer tools. Send it by mail, chat, or a shared drive. The file embeds everything: the theme and its fonts, the HyperFrames player and runtime, and the film itself, bundled by HyperFrames into one document. The narration is the project's recorded audio file, converted to AAC (128 kbit/s) and embedded; nothing is synthesised in the browser. A film of about two minutes comes to roughly 7 MB.

How it works: the film is embedded once, as a string each player receives as inline HTML (`srcdoc`). Because that HTML already contains the HyperFrames runtime, the player loads none from its CDN. Scene players receive the film only when they scroll into view. HyperFrames' bundler leaves a few things as file references, which the export embeds itself: the symbols of `<use href="sprite.svg#id">`, files behind symlinks such as `node_modules/explainery-core`, and files over the bundler's 2 MB limit. If any reference cannot be embedded, the export fails and names it, rather than writing a page that breaks later.

The bundler is not part of HyperFrames' public interface: it lives in `dist/compiler-*.js`, and the export fails with a clear message if a HyperFrames upgrade moves it.

## Write a scene

Load GSAP and the runtime once in the project's `index.html`:

```html
<script src="node_modules/gsap/dist/gsap.min.js"></script>
<script src="node_modules/explainery-core/runtime/scene.js"></script>
```

Each HTML module is a composition within an editorial scene. Its host passes copy, beats, and duration as HyperFrames composition variables:

```html
<div id="registry" data-composition-id="registry" data-composition-src="compositions/registry.html" data-start="0" data-duration="8.9"
  data-variable-values='{"copy":{"headline":"Team Registry"},"beats":{"publish-setup":2.45},"duration":8.9}' …></div>
```

Inside the composition, mark copy slots with `data-copy` and anchor tweens to beats:

```html
<h1 data-copy="headline">Team Registry</h1>
<script>
  defineScene({ window, document, gsap }, 'registry', (tl, { beat, duration, enterCopy }) => {
    enterCopy(0.4);
    tl.fromTo('#publish-marker', { opacity: 0 }, { opacity: 1, duration: 0.4 }, beat('publish-setup'));
  });
</script>
```

The composition passes `{ window, document, gsap }` because HyperFrames scopes those per sub-composition, and a function loaded globally could otherwise read neither the instance's variables nor its own elements. `beat(name)` returns composition-local seconds; beat anchoring is an authoring convention, not a restriction enforced by the runtime. Numeric starts, offsets, and durations are supported.

`enterCopy(at, timing)` reveals the theme's copy block from second `at`: the accent rule, the category, a left-to-right headline wipe, then the support line. Pass `{ headline: { at, duration }, support: { at, duration } }` to retime one composition; the offsets are relative to `at`, and slots without copy are skipped.

The existing helper name `defineScene` is retained for compatibility. It fills each `data-copy` slot from the story, removes slots whose copy the story leaves out, and registers the paused timeline under the composition ID. An unknown beat, or a timeline that runs past the composition's duration, throws instead. The [preview and render checks](#preview-and-render) execute this guard after narration or copy changes.

## Themes and components

Load a theme before the project's own styles, then override its tokens. The cascade runs core → theme → project:

```html
<link rel="stylesheet" href="node_modules/explainery-core/themes/dark/theme.css">
<style>
  :root { --sandbox: var(--hue-lime); }
</style>
```

[`themes/dark`](themes/dark/theme.css) is the default theme. It provides a black canvas with a sparse square texture (`.background`), a generic hue palette (`--hue-pale-blue`, `--hue-lime`, `--hue-gold`, `--hue-cyan`), text colours, and a type scale set in bundled Roboto 2.137 (© 2011 Google Inc., Apache-2.0). It also provides the low-left copy block (`.copy`, `.accent-rule`, `.category`, `h1`, `.support`), diagram labels, and an empty [brand-frame slot](themes/dark/brand-frame.html). A project brands the video by pointing its `brand-frame` host at its own composition. [`scripts/build-texture.ts`](scripts/build-texture.ts) regenerates the texture.

Components such as the [isometric cube](components/isometric.svg) take colour only from tokens (`--cube-top`, `--cube-left`, `--cube-right`, `--cube-edge`). Recolour a single cube by overriding the tokens on its element. Keep every SVG well-formed XML: Chrome silently draws nothing from a malformed sprite or texture, and a `--` inside an XML comment is already enough.

## Develop

```bash
pnpm install
pnpm test             # type-checks, then runs the tests
pnpm build:runtime    # after editing runtime/scene.ts
```

Node 22.18 or later runs the TypeScript sources directly by stripping their types, so only the browser runtime has a build step; a test fails while `runtime/scene.js` differs from a fresh build. The tests include real HyperFrames snapshots and checks of fixture projects, so they need FFmpeg; HyperFrames manages its own headless browser. The SVG well-formedness test needs `xmllint`. Changes follow red/green TDD: a contract change starts with a failing test.

## Licence

Apache-2.0, see [LICENSE](LICENSE). GSAP is a peer dependency and is never redistributed here, because its standard licence is not OSI-approved.
