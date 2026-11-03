# Source evidence note template

Adapt this structure to the requested scope. This is a recommended handoff format, not an executable schema. Replace bracketed descriptions with actual evidence; omit unused sections rather than inventing values.

## Scope and source

- Task stage: source analysis, proposed adaptation, or implementation review.
- Requested range and actual inspected range, both in source-global seconds; inspection date and source date/origin when known.
- Relative links to untouched video and SRT, checksum record, probe metadata, extracted cues, transcript and exact requested-time frame index.
- Extraction command/tool versions, overview sampling coverage, readable stills and targeted transition time lists. State whether audio was actually heard and which intervals were played.
- Evidence limits, including uninspected intervals, illegible text, uncertain source dates and unsupported factual claims.

## Navigation index

| Window ID | Source range `[start, end)` | Observed state | Temporally overlapping cue IDs | Evidence |
| --- | --- | --- | --- | --- |
| [stable navigation ID] | [seconds] | [short description] | [original cue IDs, including empty cues] | [links to timestamped frames and detail section] |

Window IDs organize analysis; they do not declare executable scenes or compositions. Explain any intentional navigation gaps/overlaps and keep semantic cue associations separate from interval overlap. List zero-duration cues separately if the overlap convention excludes them.

## Window detail

### [Navigation ID and source range]

**Visible copy:** exact legible wording by role or element, with visible line breaks recorded unambiguously. Mark illegible, cropped or transient content; do not fill gaps from narration.

**Visible relationships:** layout, connected elements, ordering, containment and recurring identities established by the cited images. Distinguish a transient pose from a settled state.

**Narration:** cue IDs and links to extracted/source text. Record visible-copy/SRT discrepancies separately; add audio findings only for intervals actually heard.

| Requested source time | Linked image | Observed state or change |
| --- | --- | --- |
| [exact seconds from the frame index] | [relative image link] | [what this image establishes] |

**Transition:** ordered before/during/after observations, what persists and what overlaps. State the sampled bracket and unmeasured details. If a contact sheet is linked, state its tile order and point to the underlying requested-time index.

**Proposed reconstruction:** separate editable elements, reuse opportunities and missing artwork. Label approximations and intended departures. Do not describe these recommendations as recovered source implementation.

**Claims and evidence:** link each material domain claim or relationship to its source location and date. Mark whether the record is merely an assertion in the reference, independently corroborated evidence or an unresolved discrepancy. Keep editorial rationale separate from factual support.

**Open evidence questions:** the smallest additional inspection that would settle each consequential uncertainty. Record actual corrections to previous readings and their evidence without rewriting source bytes.

## Handoff status

State what has been inspected and what is proposed, implemented or verified, using only statuses supported by evidence. Link the owning proposal or executable files when they actually exist. Retain source-global observations here; link to executable narration and timing rather than duplicating their authority. List the next action within the requested scope.
