---
type: Domain Concept
title: Element
description: A primitive visual or media layer controlled within a composition.
---
# Element

An element is a primitive visual or media layer inside a [composition](composition.md): a text label, SVG path, cube, counter, image, video, or audio track. Elements have geometry, styling, and independently controllable properties; the composition groups them into a meaningful diagram or interface.

An asset is the reusable resource an element references, such as an SVG illustration, font, or audio file. It is not an editorial scene. The same asset can back several elements while their positions and animation remain independent.

Element identity matters when the same subject moves or changes state across [beats](beat.md). Keep that subject’s element alive and animate its visible properties on the composition’s [timeline](timeline.md). IDs must stay unique when modules are assembled, so authored element IDs use a composition prefix. Elements do not introduce another level of editorial grouping or a new entry in `story.yaml`.
