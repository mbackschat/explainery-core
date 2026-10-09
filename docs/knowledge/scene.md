---
type: Domain Concept
title: Scene
description: A coherent human authoring unit containing one or more compositions.
---
# Scene

An editorial scene explains one coherent idea and is the unit a person or agent edits, previews, and renders. It contains one or more ordered [compositions](composition.md). A scene can keep an introduction, a moving diagram, and its conclusion together even when each uses a separate HTML module.

A grouped scene has its own `id` and human-readable `title`; its compositions retain their own IDs. A legacy flat entry normalizes to a one-composition scene with the same ID and `copy.headline` as its title. The author declares grouping explicitly. There is one grouping level: a scene contains compositions, never other editorial scenes. See [Authoring](authoring.md) for the persisted shapes and legacy compatibility.

The scene’s playback range is derived from its compositions’ [timing](timeline.md). It has no separate persisted beat clock. The model introduces no shot entity and does not infer scene boundaries from headlines, narration, visual changes, or composition counts.
