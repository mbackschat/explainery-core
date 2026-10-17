# 0009 Local production provenance and reusable delivery

Accepted 17 October 2026. Voice generation, recognition, alignment, rendering and packaging are distinct operations with different costs. Replacing script text must not silently reuse obsolete speech, and regenerating HTML or captions must not force another video capture.

## Contract

`voice` generates local Kokoro audio through the pinned HyperFrames runtime. A composition cache includes the spoken input, voice, language, speed, chunking version and model/runtime identity; cached WAV bytes are checked before reuse. Measured PCM boundaries form a segment manifest. Sample generation has its own destination and never replaces the film manifest. Generation does not establish listening approval.

Alignment accepts canonical or spoken recognition tokens and optional composition audio segments. Pronunciation spans map expanded speech back to canonical words. Segment boundaries limit matching and interpolation to their composition; inferred beat timestamps are reported for review. Captions retain canonical script spelling. Imported timing remains protected by the existing explicit replacement rule.

`production` explicitly records the reviewed relationship between current narration, spoken input, audio, word transcript, optional segments and timing in project-local `production.json`. It accepts aligned or imported source recordings, rejects estimated timing and stale root assembly, and does not claim to prove semantic synchronization. `preflight` checks that association before delivery. Re-recording a stale snapshot is an editorial assertion, never an automatic repair.

`deliver` produces full-film MP4, HTML, SRT and VTT from one checked snapshot, with checksums and machine verification receipts. It reuses an MP4 only when its render receipt matches the current local shipping dependency closure, timing, script, renderer version and settings, and its bytes still match. A new render is recorded only after video checks pass and the source fingerprint remains unchanged. An older MP4 without that receipt is not adopted automatically. `render --quality delivery --reuse` makes the same cache available explicitly for scene or full-film work.

The dependency closure is the local static file contract of [filmFiles](../../src/film-files.ts). Strict cache traversal rejects remote resources, runtime fetches and unsupported imports: make them local explicit dependencies before relying on reuse. Relevant framework assembly, scene selection, chapter and CLI implementation bytes also contribute to the fingerprint. Rendering remains software browser capture with one worker by default; an explicit worker count is part of the cache identity. Progress reports stage counters and stage-local estimates, not a promised completion time.

## Evidence and limits

`verify` records cue and join frames, seek-history comparisons and isolated/full comparisons without changing focus. Video verification checks the delivered bytes and full decoding. HTML verification opens the standalone file with network access blocked and exercises its players. Receipts retain `humanReview: pending`: machine success is not a visual, editorial or listening sign-off.

Project glossaries, selected voices and listening decisions remain story-owned under the [voice guidance](../authoring.md#pronunciation-and-voice-direction). The framework contains generic mechanisms and fixtures only. A long production film is not a routine regression fixture; use short fixtures and a short story integration first.
