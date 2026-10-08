# explainery-core

Open-source visual storytelling on HyperFrames, with themes.

A story is written once in `story.yaml`: on-screen copy and narration per scene, with beat markers in the narration. Scenes are HyperFrames compositions whose tweens are anchored to those beats rather than to absolute seconds, so replacing the voiceover never requires editing a composition. The same story feeds the rendered video and, later, a static explainer page.

The design and its contracts are recorded in [ADR 0001](docs/adr/0001-explainery-architecture.md).

## How it fits together

1. **Script.** `story.yaml` lists the scenes with their copy and narration. Markers such as `{publish-setup}` name the beats the animation reacts to.
2. **Time.** `timing.json` gives each scene its start and length and each beat its second. Its `source` records where the seconds came from: `estimate`, `aligned` to a recorded voiceover, or `imported` from an existing film.
3. **Assemble.** `explainery assemble` writes that timing and copy into the project's hand-authored `index.html` as HyperFrames composition variables.
4. **Animate.** Each scene in `compositions/<id>.html` builds its timeline with `defineScene` and anchors tweens to `beat('…')`.
5. **Verify and publish.** `explainery validate` and `hyperframes check` guard the contracts, `hyperframes render` produces the MP4, and `explainery export` produces the explainer page.

| Path | Contents |
| --- | --- |
| [`schemas/`](schemas/) | JSON Schemas for `story.yaml` and `timing.json`, also usable for editor validation. |
| [`src/`](src/), [`bin/explainery.mjs`](bin/explainery.mjs) | The validator, the assembler, the explainer export, and the `explainery` command. |
| [`runtime/scene.js`](runtime/scene.js) | `defineScene`, the browser runtime that scenes call. |
| [`themes/dark/`](themes/dark/) | The default theme: tokens, Roboto, texture, and the brand-frame slot. |
| [`components/`](components/) | Shared SVG components that take colour only from tokens. |
| [`tests/`](tests/) | `node:test` suites, plus HyperFrames fixture projects that prove rendering behaviour. |

## Use in a project

Nothing is published yet. Check this repository out next to your project and link it:

```json
{ "dependencies": { "explainery-core": "link:../explainery-core" } }
```

Run `pnpm install` in this checkout as well, because a linked package resolves its own dependencies from its own `node_modules`.

## Validate a project

```bash
pnpm exec explainery validate
```

This checks `story.yaml` and `timing.json` against [their](schemas/story.schema.json) [schemas](schemas/timing.schema.json), then checks that they agree with each other. Every scene must have timing that starts in story order and ends within the story. Every `{beat}` marked in the narration must have a time, in narration order and within its scene. Every scene must also have a `compositions/<id>.html` that declares `data-composition-id="<id>"`. The command prints each error and exits with status 1.

## Assemble the root composition

```bash
pnpm exec explainery assemble          # write story timing and copy into index.html
pnpm exec explainery assemble --check  # exit 1 when index.html is out of date
```

`index.html` stays hand-authored. `assemble` validates the project and then rewrites only the attributes it manages:

- **Scene hosts:** the element with `data-composition-src` and the scene's `data-composition-id` gets `data-start`, `data-duration`, and `data-variable-values` holding `{copy, beats, duration}`.
- **Story duration:** the root composition and every element marked `data-story-span` get the story duration.
- **Narration track:** the element marked `data-story-audio` gets `timing.audio` as its `src`.

Everything else in the file is left byte for byte, so `story.yaml` and `timing.json` remain the only place to change copy and timing.

## Export the explainer page

```bash
pnpm exec explainery export                    # writes ./explainer
pnpm exec explainery export --out ../site      # or any folder that is empty or an earlier export
```

The export writes a static folder with three parts:

- **`index.html`:** the page. The whole film plays at the top with its audio. Below it, each scene gets a silent player beside its category, headline, support line, and narration (with the beat markers removed).
- **`player/`:** HyperFrames' player and runtime (Apache-2.0).
- **`film/`:** every file the root composition references, copied as real files.

Each scene player is the whole film limited to the scene's window with `range-start` and `range-end`, so no per-scene build is needed. It opens on the scene's middle frame, and a scrubber below it steps frame by frame within the scene. The page links the film's own stylesheets, so it inherits the theme. Serve the folder over http(s), for example with `npx serve explainer`. Opened as a `file://` page, the player ignores the bundled runtime and fetches one from a CDN.

## Write a scene

Load GSAP and the runtime once in the project's `index.html`:

```html
<script src="node_modules/gsap/dist/gsap.min.js"></script>
<script src="node_modules/explainery-core/runtime/scene.js"></script>
```

Each scene host passes its copy, beats, and duration as HyperFrames composition variables:

```html
<div id="registry" data-composition-id="registry" data-composition-src="compositions/registry.html" data-start="0" data-duration="8.9"
  data-variable-values='{"copy":{"headline":"Team Registry"},"beats":{"publish-setup":2.45},"duration":8.9}' …></div>
```

Inside the scene, mark copy slots with `data-copy` and anchor tweens to beats:

```html
<h1 data-copy="headline">Team Registry</h1>
<script>
  defineScene({ window, document, gsap }, 'registry', (tl, { beat, duration, enterCopy }) => {
    enterCopy(0.4);
    tl.fromTo('#publish-marker', { opacity: 0 }, { opacity: 1, duration: 0.4 }, beat('publish-setup'));
  });
</script>
```

The scene passes `{ window, document, gsap }` because HyperFrames scopes those per sub-composition, and a function loaded globally could otherwise read neither the instance's variables nor its own elements. `enterCopy(at, timing)` reveals the theme's copy block from second `at`: the accent rule, the category, a left-to-right headline wipe, then the support line. Pass `{ headline: { at, duration }, support: { at, duration } }` to retime one scene; the offsets are relative to `at`, and slots without copy are skipped.

`defineScene` fills each `data-copy` slot from the story and removes slots whose copy the story leaves out. It then registers the paused timeline under the scene id. An unknown beat, or a timeline that runs past the scene's duration, throws instead. `hyperframes check` reports that as a runtime error and fails, so run it together with `explainery validate`.

## Themes and components

Load a theme before the project's own styles, then override its tokens. The cascade runs core → theme → project:

```html
<link rel="stylesheet" href="node_modules/explainery-core/themes/dark/theme.css">
<style>
  :root { --sandbox: var(--hue-lime); }
</style>
```

[`themes/dark`](themes/dark/theme.css) is the default theme. It provides a black canvas with a sparse square texture (`.background`), a generic hue palette (`--hue-pale-blue`, `--hue-lime`, `--hue-gold`, `--hue-cyan`), text colours, and a type scale set in bundled Roboto 2.137 (© 2011 Google Inc., Apache-2.0). It also provides the low-left copy block (`.copy`, `.accent-rule`, `.category`, `h1`, `.support`), diagram labels, and an empty [brand-frame slot](themes/dark/brand-frame.html). A project brands the video by pointing its `brand-frame` host at its own composition. [`scripts/build-texture.mjs`](scripts/build-texture.mjs) regenerates the texture.

Components such as the [isometric cube](components/isometric.svg) take colour only from tokens (`--cube-top`, `--cube-left`, `--cube-right`, `--cube-edge`). Recolour a single cube by overriding the tokens on its element. Keep every SVG well-formed XML: Chrome silently draws nothing from a malformed sprite or texture, and a `--` inside an XML comment is already enough.

## Develop

```bash
pnpm install
pnpm test
```

The tests include real HyperFrames snapshots and checks of fixture projects, so they need FFmpeg; HyperFrames manages its own headless browser. The SVG well-formedness test needs `xmllint`. Changes follow red/green TDD: a contract change starts with a failing test.

## Licence

Apache-2.0, see [LICENSE](LICENSE). GSAP is a peer dependency and is never redistributed here, because its standard licence is not OSI-approved.
