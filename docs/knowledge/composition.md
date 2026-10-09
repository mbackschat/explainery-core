---
type: Domain Concept
title: Composition
description: A renderable HTML module containing elements and an animation timeline.
---
# Composition

A composition is an executable HTML module combining graphic, text, and media [elements](element.md), reusable assets, layout, and motion. Story compositions render parts of an editorial [scene](scene.md); the root composition places those modules and shared layers on the film clock. Editorial grouping does not require merging their HTML.

A story composition’s ID names `compositions/<id>.html`, the module’s `data-composition-id`, and its registered animation timeline. Copy and narration belong to its story entry; its local duration and [beats](beat.md) arrive through composition variables. An animated composition owns one paused, seekable timeline. A static composition explicitly declares `data-no-timeline`.

The existing helper name `defineScene` is retained for compatibility: it builds a composition timeline, fills `data-copy` slots, and resolves local beat cues. It rejects a missing beat or a timeline longer than the composition duration. See the [runtime](../../runtime/scene.ts) and [story schema](../../schemas/story.schema.json).
