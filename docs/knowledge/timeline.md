---
type: Domain Concept
title: Timeline
description: The placement and animation of compositions and elements in time.
---
# Timeline

Film timing places each [composition](composition.md) by its global `start` and `duration`. Inside it, a paused animation timeline controls [elements](element.md) in local seconds and anchors actions to named [beats](beat.md). The film clock and local animation clocks are related by the composition start.

The persisted field `timing.scenes` keeps its existing name for compatibility, but its keys remain composition IDs. Editorial scene IDs add no timing entries. A scene’s range starts at the earliest start of its compositions and ends at their latest `start + duration`; selecting consecutive scenes derives the enclosing range the same way. Overlaps remain part of the authored composition timing.

Playback must produce the same visible state for direct, forward, and backward seeks to one timestamp. Motion is constructed synchronously and does not depend on wall-clock timers or completion-only mutations. Media playback belongs to HyperFrames. The [runtime](../../runtime/scene.ts) checks the local duration bound; the [timing schema](../../schemas/timing.schema.json) and [validator](../../src/validate.ts) govern persisted placement.
