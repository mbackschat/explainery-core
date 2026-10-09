---
type: Playbook
title: Authoring
description: How to describe, declare, and revise a scene, including its visual beats and source files.
---
# Authoring

Start with the idea the viewer should understand, then describe what they will see at each beat. A [scene](scene.md) is that editorial unit; its [compositions](composition.md) are the HTML modules that execute it. A scene description is a visual plan kept in the story repository's Markdown documentation. Explainery does not read that prose or generate animation from it.

## Where a scene is described

| To find or change | Source of truth |
| --- | --- |
| Scene purpose, visual sequence, transitions, and evidence behind claims | The story's scene descriptions or story proposal, linked from its README. |
| Editorial IDs, titles, grouping, composition copy, narration, and beat markers | The film's `story.yaml`, following the [story schema](../../schemas/story.schema.json). |
| Composition starts, durations, and local beat seconds | The film's `timing.json`, following the [timing schema](../../schemas/timing.schema.json). Scene ranges are derived from these values. |
| Actual diagrams, diagram labels, layout, and motion | `compositions/<composition-id>.html` and its linked assets. `defineScene` operates on a composition despite its historical name. |
| Shared visual language | The story's design guide and theme overlay. |
| Root placement and shared layers | The film's `index.html`; assembly refreshes its story copy and timing attributes. |

The visual plan records intent; the composition determines what renders. When they disagree, inspect the implementation and evidence before deciding which to change. Link to executable copy and timing rather than maintaining duplicate transcripts or cue-second tables in the plan. Reference-video observations may retain source-global timestamps, clearly labelled as evidence rather than executable timing.

## Write a useful scene description

Use the story's existing scene document or proposal. Give each editorial scene a heading with its stable ID and title, and link it from the story README's scene map. Keep the description sufficient to implement and review:

- **Purpose:** the one idea the viewer should take away, and why this scene follows the previous one.
- **Sources:** links to the claim's evidence or reference frames; distinguish observations, intended changes, and approximations.
- **Composition mapping:** ordered composition IDs with links to their HTML files; point to `story.yaml` for spoken and on-screen copy.
- **Visual beats:** for each composition and beat ID, describe the visible starting state, what changes, and the settled state the viewer must be able to read. Name any diagram labels that matter to understanding the claim.
- **Transitions:** what enters from the previous composition, what persists, and what remains at the handoff to the next one. Identify shared assets when a change affects other scenes.
- **Review criteria:** the frames and transitions that prove the intended idea is visible and agrees with the source. Separate planned behaviour from verified rendering.

For example, an `introduction` scene could contain `problem` and `solution` compositions. Its purpose is to show how one shared queue replaces competing inboxes. The visual plan might include:

| Composition / beat | Visible state and change | Review criterion |
| --- | --- | --- |
| `problem` / `arrive` | Three requests enter separate inboxes; two carry the same task label. | The duplicated task is visible before the next beat. |
| `solution` / `route` | The inboxes converge into one queue; the duplicate merges into the existing item. | One item remains per task, and the shared queue stays readable through the closing hold. |

Beat IDs are local to a composition. Read their current seconds from `timing.json`; film time is composition start plus local beat time. Use numerical durations or offsets in a plan only where they express a deliberate motion choice, and recheck them when narration changes. A beat anchor moves a tween's start, but does not automatically resize its duration or reflow text.

## Declare the scene

The scene grouping contract extends `story.scenes` with one explicit grouping level. A legacy flat entry is an editorial scene containing one composition, with the same ID. Existing composition paths, narration markers, and `timing.scenes` keys continue to work.

This complete story example declares the scene above; it still needs composition HTML, timing, and a root composition to render:

```yaml
id: shared-queue
title: One shared queue
theme: dark
canvas: { width: 1920, height: 1080, fps: 30 }
scenes:
  - id: introduction
    title: Introduction
    compositions:
      - id: problem
        copy:
          headline: Separate inboxes duplicate work.
        narration: "{arrive} Requests arrive in separate inboxes."
        hold: 1
      - id: solution
        copy:
          headline: One queue keeps the work together.
        narration: "{route} Route each task through one shared queue."
        hold: 1
```

`introduction` is the focus and selection ID; `problem` and `solution` name the HTML files and the keys in `timing.scenes`. The title is for human selection and need not equal an on-screen headline. Keep purpose, evidence, and visual-plan prose in Markdown; those are not fields in the story schema.

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

## Select and preview a scene

List the current editorial IDs, titles, and derived ranges with `explainery scenes <project-dir>`. The scene-targeted commands use editorial scene IDs:

```sh
explainery preview <project-dir> --scene <scene-id>
explainery render <project-dir> --scene <scene-id>
explainery preview <project-dir> --scene <first-id>,<next-id>
explainery render <project-dir> --scene <first-id>,<next-id>
```

A comma-separated selection must be consecutive and in film order. The command derives its range, includes global shared layers, and trims continuous audio to that range. Preview uses a disposable project view refreshed from source on each preview/render invocation; only dependencies remain linked. Never edit `.explainery/scenes/`. Rerun preview after any source edit, including animation, artwork, styles, story copy, or timing. Use `explainery assemble <project-dir>` to refresh the original root after copy or timing changes.

These commands do not infer semantic boundaries or orchestrate separately encoded scene caches. See the [CLI](../../bin/explainery.ts) and [story schema](../../schemas/story.schema.json).

`explainery focus <project-dir> --scene <id-or-title>` stores the active scene locally until changed; `--film` returns to the whole film. Without options, `focus` reports it. Subsequent preview/render commands use that target and print it. Explicit `--scene` or `--film` on a command overrides it once. Agents apply the same focus to conversational edits. Focus lives in ignored `.explainery/focus.json`, not in the story schema, and does not scope validation, alignment, assembly, or page export.

## Revise and check a scene

1. Read the description, evidence, current story entry, and mapped compositions. Select the scene with `focus` before editing its sources.
2. Update the owner of the change from the table above. A changed claim or visual sequence also needs a matching description; a narration change needs a matching voice and timing before delivery.
3. After copy or timing changes, run `explainery assemble <project-dir>`. Run `explainery validate <project-dir>` and `explainery assemble <project-dir> --check` to check source consistency.
4. Rerun preview to refresh the scene view. Inspect each beat's settled state and the transitions, including adjacent scenes when the handoff changes. Check direct, forward, and backward seeks to the same timestamp.
5. Use the story's visual verification workflow to compare the result with the plan or reference evidence. Validation proves structural consistency; it does not prove visual fidelity, legibility, or claim accuracy.

See the [composition implementation walkthrough](../../README.md#write-a-scene) for HTML and runtime wiring, and [preview and render](../../README.md#preview-and-render) for command details.
