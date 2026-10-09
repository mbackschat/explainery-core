---
type: Playbook
title: Authoring
description: How to declare scene groups and work on a selected scene or consecutive range.
---
# Authoring

The scene grouping contract extends `story.scenes` with one explicit grouping level. A legacy flat entry is an editorial scene containing one composition, with the same ID. Existing composition paths, narration markers, and `timing.scenes` keys continue to work.

```ts
type Composition = {
  id: string;
  copy: { category?: string; headline: string; support?: string };
  narration: string;
  hold?: number;
  overlap?: number;
};

type Scene = {
  id: string;
  title: string;
  compositions: Composition[];
};
```

These are the exported `Composition` and `Scene` types; `Story.scenes` is `(Composition | Scene)[]`. Every group contains at least one composition. Composition IDs are unique across the film; editorial scene IDs are unique across its scene entries. Flattening groups preserves composition order for narration, alignment, assembly, and film playback. Explainer pages use one section per editorial scene with combined narration. See [Scene](scene.md) and [Timeline](timeline.md) for identity and range semantics.

The public [story helpers](../../src/story.ts) are `storyScenes(story): Scene[]`, `storyCompositions(story): Composition[]`, and `sceneRange(scene, timing): { start: number; duration: number }`. They normalize flat entries, flatten compositions, and derive editorial ranges without adding timing entries.

The scene-targeted commands use editorial scene IDs:

```sh
explainery preview <project-dir> --scene <scene-id>
explainery render <project-dir> --scene <scene-id>
explainery preview <project-dir> --scene <first-id>,<next-id>
explainery render <project-dir> --scene <first-id>,<next-id>
```

A comma-separated selection must be consecutive and in film order. The command derives its range, includes global shared layers, and trims continuous audio to that range. Preview uses a disposable project view refreshed from source on each preview/render invocation; only dependencies remain linked. Never edit `.explainery/scenes/`. Rerun preview after any source edit, including animation, artwork, styles, story copy, or timing. Use `explainery assemble <project-dir>` to refresh the original root after copy or timing changes.

These commands do not infer semantic boundaries or orchestrate separately encoded scene caches. See the [CLI](../../bin/explainery.ts) and [story schema](../../schemas/story.schema.json).

`explainery focus <project-dir> --scene <id-or-title>` stores the active scene locally until changed; `--film` returns to the whole film. Without options, `focus` reports it. Subsequent preview/render commands use that target and print it. Explicit `--scene` or `--film` on a command overrides it once. Agents apply the same focus to conversational edits. Focus lives in ignored `.explainery/focus.json`, not in the story schema, and does not scope validation, alignment, assembly, or page export.
