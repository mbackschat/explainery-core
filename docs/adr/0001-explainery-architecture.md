# 0001 Explainery architecture decisions

Agreed on 8 October 2026 before the split and moved here from the pilot project's repository when `explainery-core` was created. It is the source of truth for the restructure.

## Naming and repositories

**Explainery** — *Open-source visual storytelling on HyperFrames, with themes.* Chosen after screening npm, GitHub, and US trademark records; rejected candidates collided with existing marks or products (STORYWORKS, Story Maker®, STORYTELLING MACHINES, Story Prism, ExplainCraft, the `visual-explainer` npm package). The EU and German registers (TMview, DPMA) were deliberately not checked: for a non-commercial OSS project the realistic risk is a rename request, which stays cheap. Check them before any commercial use of the name.

```
~/Projects/explainery/            common folder, not a repository
  explainery-core/                framework repository: OSS, Apache-2.0, independent of any client
  <name>-story/                   story project repository (client product)
```

- `explainery-core` is one plain package (one `package.json`, package name `explainery-core`); nothing is published yet and there is no internal package split. The `-core` suffix leaves room for later sibling packages such as `explainery-themes`.
- Each project consumes it as `"explainery-core": "link:../explainery-core"`. Each repository keeps its own lockfile; no pnpm workspace spans repositories.
- The original prototype repository becomes the pilot project, with fresh framework history extracted out and a new `<name>-story` folder and package name. Its prototype moves from a nested folder to the repository root, next to `original-material/` and `docs/`.
- HyperFrames skills (`.agents/skills`) are installed per project and pinned by `skills-lock.json`, because agents work inside a project directory.
- GSAP is an npm dependency, never a vendored `gsap.min.js`: its standard no-charge license is not an OSI license, so an Apache-2.0 repository must not redistribute it.

## Themes

`explainery-core/themes/dark` is the default theme and contains nothing client-specific: black canvas, square texture, glow, a generic hue palette (`--hue-cyan`, `--hue-lime`, `--hue-gold`, …), type scale with bundled Roboto (Apache-2.0), copy-block layout, motion defaults, and an empty brand-frame slot.

The pilot project overlays it with its client's logo, an eight-colour brand strip, and role mappings such as `--sandbox: var(--hue-lime)`. This exercises both override kinds: tokens through the CSS cascade (core → theme → project) and structure by replacing the brand-frame composition. Components live in core and take colour only from tokens. Step 1 moved the cube symbol, which already used custom properties, and the texture generator into core. Step 2 converted the pilot project's role colours, inline styles, and brand strip to tokens. Tokens cannot reach everything, as measured on 8 October 2026 with HyperFrames 0.8.124 and CPU capture. Page custom properties do reach flat fills in an external `<use>` sprite, but not the gradient stops inside it, and an SVG loaded through `<image>` is an isolated document. The pilot project's gradient platforms and its generated illustrations therefore keep literal colours as project artwork. Making them themeable would mean inlining them, which is not worth it for a single-brand project. Glow stays in scene code, because each glow filter is tuned to its source scene. The motion default is `enterCopy`, the runtime's copy-block entrance, since every scene reveals the theme's copy block the same way.

## Contracts

```ts
type SceneId = string; type BeatId = string;

type Story = {
  id: string; title: string; theme: string;              // "dark"
  canvas: { width: number; height: number; fps: number };
  scenes: Array<{
    id: SceneId;                                          // → compositions/<id>.html
    copy: { category?: string; headline: string; support?: string };
    narration: string;  // "Publish it {publish-setup} and sandboxes pull it in {pull-setups}."
    hold?: number;      // seconds after the narration ends
    overlap?: number;   // crossfade into the next scene
  }>;
};

type Timing = {
  source: 'estimate' | 'aligned' | 'imported';
  audio?: string;
  duration: number;
  scenes: Record<SceneId, { start: number; duration: number; beats: Record<BeatId, number> }>; // beats scene-local
};
```

Scenes receive copy, beats, and duration as HyperFrames composition variables (`data-variable-values`) and anchor narration-driven actions to scene-local beats. Offsets and tween durations remain authored seconds:

```js
defineScene({ window, document, gsap }, 'registry', (tl, { beat, duration }) => {
  tl.fromTo('#publish-marker', { opacity: 0 }, { opacity: 1, duration: 0.4 }, beat('publish-setup'));
});
```

The scene passes its `{ window, document, gsap }` because HyperFrames runs each sub-composition script with these scoped to the composition: its `getVariables()` returns the instance's values, and its selectors match only inside it. A globally loaded `defineScene` cannot reach that scope on its own. Copy reaches the scene through `data-copy="<key>"` slots, which `defineScene` fills from the story; it removes a slot when the story has no copy for it.

Implementation clarification (9 October 2026): the original goal that replacing a voiceover never requires composition edits is not a runtime guarantee. [The runtime](../../runtime/scene.ts) resolves beat positions but does not resize tweens or reflow copy; shorter narration or longer wording can require composition changes. `explainery validate` fails when beats are out of order, unmarked, or outside their scene. `defineScene` throws when a scene's timeline overruns its duration, which `hyperframes check` reports as a runtime error; `hyperframes lint` does not execute scenes and cannot catch it. `story.yaml` owns narration and copy delivered through `data-copy` slots, so those values are shared by the video and explainer page. Labels authored directly in a composition remain that composition's responsibility; Studio text editing is not the edit path for story-owned copy.

## Stages

| Stage | Output | Tool |
| --- | --- | --- |
| 1 Script | `story.yaml` | person or agent |
| 2 Animate | compositions, silent animatic | word-count timing estimate, Studio |
| 3 Voice | `narration.wav` | recording, or local `hyperframes tts` (Kokoro) for drafts |
| 4 Align | `timing.json` (aligned) | `hyperframes transcribe` word timestamps matched to beat markers |
| 5a Video | MP4 | assembly + `hyperframes render` |
| 5b Explainer | static HTML folder | export; needs story, compositions, and any timing source |

The explainer page is a scroll page: per scene a silent, scrubbable player beside headline and narration, with an optional full-film player with audio at the top. Each scene player is the whole film limited by the player's `range-start` and `range-end`, so the page needs no per-scene build. The player's own scrubber always spans the whole film, so the page adds a per-scene scrubber that counts whole frames; a fractional step such as 1/30 s rounds, and the player then floors to the previous frame. Kokoro has no German voice. Optional later: captions from timing, a `hyperframes present` deck, PDF stills. Excluded: generating animation from the story, cloud rendering, theme inheritance deeper than theme → project, multi-language stories.

## Spike results (HyperFrames 0.8.124)

- Scenes and theme CSS reached through a `node_modules` symlink to a sibling directory pass lint, snapshot, render, and Studio preview. Studio refuses to edit them (`403 outside_project`), which is intended: the framework is edited in its own repository.
- `data-variable-values` delivers nested objects (`copy`, `beats`) intact to `getVariables()`.
- `<hyperframes-player runtime-src>` accepts a local runtime only on http(s) pages; on `file://` it falls back to the jsDelivr CDN. The explainer must therefore be served, not opened as a file.

## Migration order and oracle

1. Create `explainery-core` with the scene runtime, schemas, validator, and the `dark` theme.
2. Restructure the pilot project: flatten to the root, add `story.yaml`, `imported` timing that reproduces today's offsets, and its client overlay.
3. The migration is done when the existing seek tests and `verify:render` pass and frames are pixel-identical to the current render.
4. Build the explainer export.
