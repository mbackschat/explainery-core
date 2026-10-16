# 0006 Automatic MP4 scene chapters

Accepted 2026-10-16.

## Decision

Every MP4 produced through Explainery's render command receives chapters automatically, with no opt-out setting. Chapters provide navigation without changing ordinary playback, and the story already owns their titles and timing.

Each editorial scene is one chapter regardless of its number of compositions. Explicit scene titles are used; legacy flat scenes use their headline through the existing scene normalization. Full films begin their first chapter at zero, including any leading hold. Subsequent chapters start at the earliest composition entrance in each scene, including its incoming transition. Chapters form consecutive, non-overlapping intervals; the last ends at the actual video duration. Starts must be distinct at millisecond precision.

Selected-scene renders use the same consecutive selection and enclosing range as scene playback, and rebase chapter starts to that range. The [shared selection function](../../src/story.ts) owns range validation for both operations. This prevents the chapter clock from diverging from the rendered selection.

## Existing videos and preservation

`explainery chapters [project-dir] --video <file.mp4> [--scene <id,...> | --film]` refreshes an existing video in place. It defaults to the full film independently of sticky focus, because choosing a different active scene must not silently relabel a full-film file. An explicitly selected range must match the supplied video.

[Chapter writing](../../src/chapters.ts) probes the media duration and permits one frame plus 10 ms of container rounding relative to the expected range. A mismatch fails before modifying the file. The duration check cannot identify an unrelated video with the same length; callers must use the story and timing revision that produced the supplied video.

FFmpeg copies compressed video, audio and subtitle streams to a sibling temporary file, retains global metadata and replaces the old chapter track. It writes QuickTime and Nero chapter representations by default, as documented in the [MOV/MP4 muxer options](https://ffmpeg.org/ffmpeg-formats.html). The output's chapter count, titles and boundaries are checked before an atomic rename replaces the original. Failure retains the original. There is no picture or sound re-encoding, and no change to sidecar subtitles.

## Verification

[Chapter tests](../../tests/chapters.test.ts) cover grouped and legacy scenes, overlaps, selected ranges, invalid boundaries, escaped titles, repeated refresh and source retention on failure. A real MP4 fixture compares compressed packet hashes for video, audio and embedded subtitles before and after remuxing. [CLI tests](../../tests/scene-cli.test.ts) verify automatic chapters after render, full-film overrides, focused renders, explicit selected ranges and refresh behavior.
