# 0013 Studio review overlays

Accepted 25 October 2026. The [small proposal](../proposals/studio-review-overlays.md) owns the public contract for presenter plans and reviewed subtitles in Studio previews.

Preview preparation already isolates a scene and its narration without changing authored inputs. Add the review layers only to that disposable project, using the same scene clock and deterministic composition playback. Keep presenter plans separate from story/timing schemas because an experimental appearance is not a delivered-film requirement. Explicit option files make the review reproducible without media generation or implicit discovery.

Reuse the HTML exporter's plain-text WebVTT parser rather than defining another subtitle dialect. Recorded subtitle timing remains distinct from the estimated captions in [ADR 0008](0008-preview-narration.md); the two modes are mutually exclusive. Render rejects review options and ordinary preparation removes their generated layer. A retained portrait tests placement and presence, not the quality of a future talking performance.
