---
okf_version: "0.2"
---
# Explainery domain

The domain separates the scene a person works on from the HTML compositions that render it. These documents describe that authoring contract; the [schemas](../../schemas/), [types](../../src/types.ts), and [CLI](../../bin/explainery.ts) identify implemented behaviour.

This bundle uses [Open Knowledge Format v0.2](https://raw.githubusercontent.com/GoogleCloudPlatform/open-knowledge-format/main/SPEC.md), with Markdown links between concepts and minimal frontmatter.

- [Film](film.md) — The complete story, with ordered editorial scenes and a shared playback clock.
- [Scene](scene.md) — A coherent human authoring unit containing one or more compositions.
- [Composition](composition.md) — A renderable HTML module containing elements and an animation timeline.
- [Element](element.md) — A primitive visual or media layer controlled within a composition.
- [Beat](beat.md) — A named cue measured in a composition’s local seconds.
- [Timeline](timeline.md) — The placement and animation of compositions and elements in time.
- [Authoring](authoring.md) — How to declare scene groups and work on a selected scene or consecutive range.
