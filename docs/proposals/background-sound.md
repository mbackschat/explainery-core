# Explainery background sound and dramatic support

Status: proposal for external review; no soundtrack, sound-effect system or generation service has been selected. Prepared 2026-10-16. Applies to all Explainery films.

## Recommendation

Explore an optional, very quiet musical bed with a few authored dramatic cues. Keep the existing narration-only mix as the reference and a supported delivery choice. Begin with a €0 audition using one openly licensed track and one simple locally generated texture. Test dramatic effects separately after a musical candidate proves useful. Commit to a full soundtrack only if listening demonstrates clearer pacing or engagement without greater effort to understand the voice.

The suggested experiment is bounded to 60–90 minutes of preparation and one short listening review. This is a proposed limit, not a budget supplied by the requester. No paid generation, subscription or cloud rendering is proposed; these would also conflict with the current [repository guidance](../../CLAUDE.md#project-structure--module-organization).

## Request and intent

The requester wants background music that is very subtle and fits the narration, the scene, and potentially the specific situation within a scene. Preferred sources are open-source or openly available music libraries, or generated music. They propose a feasibility study with limited, inexpensive experiments first. They see considerable potential for improving the film, while explicitly recognizing that poorly chosen or mixed sound will annoy the audience.

The follow-up request adds dramatic-effect support and asks for a Markdown proposal suitable for external review, preserving this input and presenting options, alternatives, recommendations and their rationales. The requester clarified that this is an Explainery capability for every film, not a custom feature of the current story. Optional SRT and WebVTT subtitles are a separate, earlier priority and must remain independent of soundtrack choices.

For music, “open source” needs a distinction: the software used to create audio, a model's weights, a sample library and the resulting recording can each have different licenses. The preference is interpreted as favoring reusable, auditable sources and low cost, without assuming that a publicly downloadable recording permits reuse.

## Context and scope

Explainery combines a script, narration recording, timed scenes and visual beats into a film. Its films may be technical explainers with dense speech and diagrams. Sound should help the listener follow those ideas. A successful treatment can also suit a slower, more atmospheric film; the framework must not impose one musical style or one soundtrack on every story.

| Scope | Proposed contract |
| --- | --- |
| Required | Sound is opt-in per film. Narration remains understandable. Music and effects are separately adjustable and removable. Sources and usage rights are recorded. The narration-only version remains reproducible. |
| Required when enabled | Authored cue placement follows the film's scene and beat timing. A scene preview plays the appropriate portion of continuous music and its own effects. Seeking and final rendering reproduce the same mix. |
| Optional | A continuous music bed, scene-level changes in texture, discrete effects at selected beats, and a restrained opening or ending flourish. Each film may use any subset. |
| Excluded from the first experiment | Automatic scoring of arbitrary stories, runtime AI generation, a music marketplace, paid services, automatic effects on every animation, and changes to narration, scene timing or picture editing solely to fit a track. |

The framework owns reusable sound controls and timing behavior. Each story owns its music, sound palette, chosen cues and credits. Core must remain free of client names, branded audio and story-specific media. This proposal sets the intended behavior; it does not yet prescribe a schema, editor or plugin architecture.

## Musical treatment options

| Option | Benefit | Cost or risk | Recommendation and rationale |
| --- | --- | --- | --- |
| Narration only | Maximum space for speech; no sourcing or musical fatigue | Less atmosphere or continuity | Retain as the baseline and a valid final choice. Added sound must earn its place. |
| One quiet ambient bed | Coherent mood with little editorial complexity | An obvious loop or sustained drone can become tiring | First musical candidate. Use restrained texture, slow change and little melodic activity. |
| One bed with scene-aware changes | Supports shifts between setup, explanation and resolution | More editing; changes can call attention to themselves | Preferred eventual treatment if the simple bed succeeds. Vary density or timbre gently while retaining one identity. |
| A different track for each scene | Strong local mood control | Frequent resets, more licensing and difficult joins | Defer. The short form usually benefits from continuity; use only when the story has deliberately contrasting chapters. |
| Effects without music | Highlights a few meaningful events while preserving quiet | Repeated cues can resemble notifications | Include as an alternative if continuous music feels tiring. Use only selected events with a clear editorial purpose. |

For dense narration, start with soft sustained texture and, if useful, a sparse pulse. Avoid prominent vocals, busy percussion and a melody that invites the audience to follow it. These are defaults for an audition, not restrictions on every future film.

## Dramatic effects: meaning and restraint

“Dramatic” means supporting anticipation, contrast and resolution in the explanation. It may be a deliberate moment of silence, a slight harmonic change, or a very short sound. A louder impact is not the default.

| Scene situation | Candidate treatment | Recommendation and rationale |
| --- | --- | --- |
| Opening or new idea | Gentle onset or small increase in texture | Optional: establish attention without competing with the first words. |
| A process moves toward an outcome | A sparse pulse or quiet movement in texture | Try only if it helps the viewer follow the process. Do not sonify every moving object. |
| One consequential change completes | One soft, short resolution cue | Suitable for an effect audition: it can connect the visible event to its consequence. |
| A request is rejected or state remains unchanged | Briefly reduce texture or leave silence | Prefer restraint. An alarm could imply a failure more serious than the narrated behavior. |
| Dense explanation or important qualification | Reduce or remove music | Recommended: give the terms and diagram room to be understood. |
| A transition between scenes | A small musical change or natural phrase boundary | Prefer musical continuity. Add a transition effect only if the picture needs it. |
| Planned, uncertain or unverified outcome | Neutral continuation or unresolved texture | Preserve the script's uncertainty; avoid a triumphant cue that implies delivery or proof. |
| Closing thought | Small resolution followed by a clean fade | Optional: provide closure without extending the film or covering its final qualification. |

Effects must remain understandable in mono and must not require a particular stereo position to communicate meaning. Every effect needs a reason tied to a scene or beat. Repetition is a reason to remove or vary it, not to turn it up.

## Sources and alternatives

| Source | Strength | Limitation | Recommendation and rationale |
| --- | --- | --- | --- |
| CC0 recording or sample | Straightforward reuse where the rights holder has made a valid dedication | Provenance and musical fit still need checking | Preferred if a suitable asset can be found quickly. CC0 permits copying and adaptation, including commercially. See [Creative Commons CC0](https://creativecommons.org/publicdomain/zero/1.0/). |
| CC BY recording | Large practical pool of reusable music | Requires appropriate credit, a license link and identification of changes | Equally viable if the track fits better. Preserve credits with the film's delivery material. See [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). |
| Free stock-library recording | Fast browsing and polished production | Custom terms can differ from an open license; some tracks carry automated claims | Fallback after checking the individual asset. Pixabay documents possible Content ID claims even for licensed tracks in its [FAQ](https://pixabay.com/service/faq/). |
| Original local synthesis | Precise duration and event placement; repeatable; no service fees | A simple procedural texture can sound sterile or become irritating | Recommended second candidate: a restrained texture or effect made with synthesis and owned or appropriately licensed samples. Compare it with an existing musical recording. |
| AI-generated music | Can target mood, duration and instrumentation | Musical quality, editability, repeatability, compute cost and output rights depend on the model or service | Defer until the basic audition identifies an unmet need. Local generation is an option; a service or model being free or open does not settle the output license. Review the exact tool and terms before selection. |
| Commissioned original music | Strong creative control and deliberate dramatic phrasing | Financial cost and a separate rights agreement | Outside the cheap feasibility study. Consider only if sound proves valuable and simpler sources cannot meet the brief. |

No asset has been auditioned or cleared by this proposal. Record the source URL, creator, exact license or generation terms, attribution and relevant modifications with each selected asset. Keep media in story repositories; make only the reusable authoring capability part of Explainery. License sources above were checked on 2026-10-16.

## Mix behavior and feasibility

Keep voice, music and effects separate until delivery. The soundtrack must fit the current voice's timbre, cadence and pauses. Reassess the mix if a human recording replaces a synthetic voice. A single fixed volume percentage cannot guarantee suitability across recordings.

Start music well below the voice, then assess audibility and masking on actual listening devices. Use gentle level reduction under speech when helpful, and shape the music's frequency balance if it masks consonants. The result must avoid audible pumping, sudden rises in pauses, clicks, clipping and distracting low-frequency energy. Effects receive the same scrutiny as music, even when brief. Preserve narration level across comparisons so a louder candidate does not win merely by sounding more impressive.

The existing local audio/rendering tools make an audition feasible without a new service or video rerender for every mix. Existing scene and beat timing offers anchors for dramatic cues. The material uncertainty is perceptual quality and repeatability across preview, isolated scenes, seeking and export. Those behaviors need verification before a reusable sound feature is declared complete. This proposal does not claim that a finished Explainery soundtrack API already exists.

## Bounded experiment and decision criteria

Use one 45–60-second excerpt with dense narration, a visible consequential event and a scene transition. Select material that represents the intended film; a dramatic intro alone is not enough to judge sustained listening.

1. Compare the existing narration-only excerpt with two candidates: a licensed ambient bed and a simple locally synthesized texture. Keep the picture and narration identical.
2. If one candidate is useful, compare it with and without at most two authored effects. If both music candidates fail, an effects-only version remains a cheap alternative. This separates the value of effects from the value of music.
3. Listen at a comfortable low level on headphones and laptop speakers, including mono playback. Compare without descriptive labels that favor one candidate. Ask whether any words became harder to follow, which sounds drew attention, and whether the pacing improved.
4. Give a promising version one full-film listen before accepting it. A short excerpt cannot establish freedom from fatigue, repetition or poor joins over the whole film.

Recommended budget: €0 in service or asset purchases and 60–90 minutes of preparation for the short audition. Stop at that boundary and report what was learned; do not expand into repeated generation attempts. Full-film integration is a separate decision after review.

Accept only if the listener can follow every narrated qualification as readily as in the baseline, the sound supports the intended scene meaning, transitions feel natural, and repeated listening remains comfortable. Reject or simplify if sound distracts, suggests an unintended emotional claim, audibly pumps, masks speech, or adds no clear benefit. Technical loudness checks support this judgment; they cannot replace listening. The requester is the final judge of annoyance and fit. Narration only is a successful outcome when it wins the comparison.

## Questions for external review

- Is the proposed meaning of dramatic support appropriate? Recommendation: start with quiet anticipation, space and resolution; require a specific scene-level reason for each discrete effect.
- Is one coherent bed with small changes sufficient? Recommendation: yes for the first experiment, because it tests the main benefit with few variables. Deliberately contrasting chapters would justify separate tracks.
- Is the experiment sufficiently bounded? Recommendation: keep the €0 and 60–90-minute limit, two musical candidates and at most two effects. Any additional search or generation should answer a specific failure observed in that audition.
- Are any reusable semantics missing? Recommendation: require independent layers, beat-relative cues, narration-only delivery and consistent scene/film playback before designing a public schema. Defer automatic composition and vendor integrations.
- What would justify proceeding? Recommendation: an audible improvement with no loss of intelligibility or comfort, confirmed over the full film. A preference for a particular tool or the novelty of generation is insufficient.
