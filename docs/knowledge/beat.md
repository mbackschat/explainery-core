---
type: Domain Concept
title: Beat
description: A named cue measured in a composition’s local seconds.
---
# Beat

A beat names a meaningful moment inside a [composition](composition.md), such as releasing an item or applying tests. The narration marks it with `{beat-id}`; `timing.json` gives it a local second, and animation reads that value with `beat('beat-id')`.

Beat IDs are local to the composition and can recur in other compositions. The film second of a beat is the composition’s global start plus the beat’s local second. Grouping compositions into an editorial [scene](scene.md) does not change their IDs, cue clocks, or timing keys.

Beats must be present, follow their narration order, and lie within the composition’s duration. Tween lengths and offsets remain authored seconds: moving a cue does not automatically shorten motion or reflow copy. See the [timing schema](../../schemas/timing.schema.json), [narration parser](../../src/narration.ts), and [validator](../../src/validate.ts).
