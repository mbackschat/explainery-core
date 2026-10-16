# 0008 Draft narration in preview

Accepted 2026-10-16.

Silent animatics need readable narration before a voice recording exists. The existing subtitle command derives timings from audio; creating pretend transcription would misrepresent the evidence.

`explainery preview [project-dir] --narration` optionally adds script captions to the disposable preview. It honors focused scenes and explicit scene/full-film selections. Caption wording comes from the narration without beat markers or voice-pronunciation substitutions. Words are distributed uniformly between beat anchors; the final interval excludes the authored hold and is capped at the next composition's entrance. Sentence endings, beat boundaries, an 84-character budget and a six-second budget split cues. These limits cannot shorten a single indivisible word. An interval containing words but no positive duration fails with a request to review beats and hold.

The overlay is labelled “Draft narration · estimated timing”. It is plain text in framework-timed clips, so seeking does not depend on playback history. The narrow lower-left band leaves the usual right-hand branding area free, but each story still needs a visual check because an optional overlay can cover authored content.

Only generated preview HTML receives the overlay. Source files, voice recordings, timing, renders and exported pages remain unchanged. Render rejects `--narration` and rebuilds the ordinary scene view, removing preview captions. A full-film narration preview uses a separate disposable project; start, status and stop must use the same `--film --narration` flags. No subtitle file, voice synthesis or editor control is introduced.

The guards cover cue wording and timing, text escaping, selected-clock rebasing, full-film preview, source preservation and caption removal before render. Browser checks must additionally confirm readable placement and the active caption after direct and reverse seeks in the pinned engine.
