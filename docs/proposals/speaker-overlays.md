# Proposal: reusable speaker overlays

Status: proposal, updated 2026-10-23. A short HeyGen intro spike has been requested, using a fictional presenter and existing narration. Account access is pending; no footage has been generated or tested, and no subscription purchase is authorized. Applies across Explainery films.

## Intent and recommendation

Add an optional speaker at selected passages within a scene. The speaker should look appropriate to the film, preferably realistic, speak in sync with the narration, and retain the same identity across scenes and film projects. The initial spike uses a generated fictional person. The author's likeness and voice remain an optional later choice, not a requirement for this experiment.

Treat the presenter as a reusable character asset and each speaking passage as a separately generated video asset. Drive the performance with the exact approved narration audio, then keep the downloaded clip locally. Scene iteration and full-film assembly reuse approved clips without calling the generation provider or incurring further generation charges.

Use a short opening passage in one film's first editorial scene to assess HeyGen before selecting it for production or adding framework behavior. Keep the existing narration to preserve its delivery and timing. Start with a framed inset and restrained movement, because this tests the performance without making background removal a prerequisite. Local generation remains an alternative under the general policy.

## Proposed contract

| Scope | Behavior |
| --- | --- |
| Required | Speaker use is opt-in. Each appearance belongs to a composition within an editorial scene and has explicit placement and timing against its narration. |
| Required | A retained portrait/reference video or saved avatar identity anchors appearance across projects. Repeating a text prompt alone is not an identity guarantee. Preserve the approved look, framing and voice unless deliberately revised. |
| Required | Generate from the actual narration audio for the passage. The overlay is muted during playback; the film's existing narration remains the sole speech soundtrack. |
| Required | Generation is an explicit authoring action. Preview, seeking, scene rendering, export and film assembly consume local assets and never trigger paid generation. |
| Required | Preserve each approved clip with its source-audio identity, character reference, provider/model and settings. A changed performance input makes the clip stale and requires explicit regeneration before accepting it for delivery. |
| Required | The same approved clip and timing work in isolated scene review and the assembled film. Downloaded footage remains usable without a live provider connection. |
| Optional | Multiple appearances within one scene; transparent cutouts; deliberate changes of outfit or framing that preserve the approved identity. An explicitly chosen personal avatar and recorded or cloned voice may be evaluated separately. |
| Excluded | Live conversational avatars, automatic presenters in every scene, automatic paid retries, a character marketplace, and cloud rendering of the assembled film. Personal likeness and voice cloning are excluded from the initial spike. |

Core owns reusable timing and asset-use behavior. Story repositories own their chosen characters, footage and passage assignments. Reuse between projects must preserve an approved character reference without putting story-specific media into public core; this proposal does not introduce a shared asset service or prescribe a new schema or CLI.

## Scene iteration and reuse

Recommend one clip per speaking passage, rather than one video for the entire scene: revising a second appearance should not require regenerating the first.

| Change | Effect on the saved clip |
| --- | --- |
| Spoken wording, voice, delivery or the passage's audio timing | Regenerate the affected performance against the new audio. |
| Presenter identity, expression, gestures or generated clothing | Regenerate the affected clip. |
| Overlay position, display size, border or scene background | Reuse the clip; these are local composition changes. |
| Scene order or the scene's absolute start in the film | Reuse the clip; preserve its local relationship to the narration. |
| Another preview, scene render, export or full-film assembly | Reuse the clip; no generation charge. |

Regeneration is not needed for an audio packaging or level change that preserves the underlying performance and timing. Conversely, a narration edit may require both new footage and revised composition timing; existing beat anchoring does not automatically retime arbitrary video.

## Candidate generators

| Candidate | Evidence and limitation | Recommendation |
| --- | --- | --- |
| HeyGen | [Prompt to Avatar](https://developers.heygen.com/docs/avatar-from-prompt) supports fictional generated people and saved looks; [audio input](https://developers.heygen.com/audio-to-video) supports existing narration. Use a saved look's `avatar_id` as the visual reference: `avatar_group_id` alone is a storage grouping. [Transparent WebM](https://developers.heygen.com/transparent-background-videos) requires a look that supports matting; eligibility for the chosen fictional person must be checked. | First hosted candidate if paid generation is explicitly permitted. Its documented combination most closely matches the request; appearance and lip-sync quality remain untested. |
| MuseTalk | [Official project](https://github.com/TMElyralab/MuseTalk) accepts image/video references and audio, with reusable avatar preparation. It modifies the lip region rather than generating a complete natural head/body performance. CUDA-oriented setup; 256 × 256 face processing; documented detail loss and jitter. | First local candidate with suitable NVIDIA hardware, especially for a small inset. Its own model permits commercial use, but downloaded dependencies still need verification. |
| SadTalker | [Official project](https://github.com/OpenTalker/SadTalker) animates a portrait from audio. [Mac instructions](https://github.com/OpenTalker/SadTalker/blob/main/docs/install.md) exist, but the [standard inference path](https://github.com/OpenTalker/SadTalker/blob/main/inference.py) selects CUDA or CPU rather than Apple MPS acceleration. | A Mac feasibility experiment, not an established production solution. Speed, visual quality and third-party model terms remain unverified. |
| Synthesia | [Avatar Builder](https://help.synthesia.io/en/articles/8662981-how-do-i-create-an-avatar-with-avatar-builder) supports reusable realistic generated people. [External audio](https://help.synthesia.io/en/articles/6341873-how-do-i-upload-an-audio-file-to-synthesia) requires Enterprise; [transparent export](https://docs.synthesia.io/docs/avatar) is unavailable. | Defer: the narration-input restriction and export limitation make it a weaker fit. |

## HeyGen cost and resolution

Prices checked 2026-10-23 in USD; applicable tax, retries and optional extras are additional. These are estimates for generated speaker footage, not total film duration. The current [API pricing table](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained) supersedes older search snippets with different rates.

| Route | Ten minutes of generated footage |
| --- | --- |
| API, Avatar IV Photo Avatar | $2.31/minute × 10 = **$23.10**. One listed photo-avatar creation call adds $1.32, for **$24.42**, excluding extra look/image attempts. |
| API, Avatar III Photo Avatar | $0.99/minute × 10 = **$9.90**, excluding avatar creation. A cheaper comparison, not an established quality equivalent. |
| Web app, Creator | **$29 for one month**, including 600 credits. Avatar IV Photo uses 16 credits/minute, so ten minutes use 160 credits before other activity. |

API billing is separate from web subscriptions and needs no subscription. The [web credit guide](https://help.heygen.com/en/articles/15126059-how-to-use-credits-on-heygen) notes account/region variations and additional charges for custom expressive motion; check the displayed cost before generating. The Creator allowance corresponds to about 37.5 minutes of ordinary Avatar IV Photo generation before other usage. A provisional API allowance of $50–75 covers approximately two to three generated takes of ten minutes, not a promised acceptance rate or an approved budget.

For Avatar IV/V through the API, the avatar is rendered at 1080p; a 4K request upscales it without extra avatar detail or a separate 4K rate. No lower-resolution discount is listed for Avatar IV Photo. The [web plans](https://www.heygen.com/pricing) offer 1080p on Creator ($29/month) and 4K on Pro (from $49/month). Recommend 1080p source footage for the initial inset: display size can be reduced locally, including inside a 4K film. Shorter generated appearances save money; displaying the same footage smaller does not.

For repeated manual quality exploration, a Creator month can offer more iteration room if its export capabilities suit the selected look. For a single short spike, first check the connected account's allowance; pay-as-you-go avoids buying a month solely for seconds of footage. Prefer the API for later explicit generation from Explainery. Neither subscription nor credit purchase is authorized by this proposal.

## Voice and likeness are separate choices

HeyGen can animate an avatar against supplied audio, so the speaker's visual identity does not dictate the voice provider. A personal avatar can use the author's recording or a cloned voice; a fictional presenter can retain the existing local narration. Select a voice and appearance that feel coherent, rather than treating a technical pairing as evidence of a convincing performance.

| Voice option | Cost and consequence | Recommendation |
| --- | --- | --- |
| Existing local narration | No additional speech-generation service charge; preserves the current performance and timing. | Use for the initial spike so the experiment tests the presenter without also replacing the voice. |
| Author records the narration | No synthetic-speech generation charge; recording and editing take the author's time. | Suitable when the author wants their actual delivery and can record the required passages. |
| Instant cloned voice | Speech usage is billed separately from avatar video; clone availability and creation allowances depend on the account. | Economically plausible for a personal presenter, but compare a sample before replacing the film's narration. |
| Professional Voice Clone | [HeyGen's guide](https://help.heygen.com/en/articles/17589678-how-to-create-a-great-professional-voice-clone-pvc) lists a **$29/month per-voice add-on to a paid plan** and at least 20 minutes of source recordings. | Defer unless an instant clone fails the required resemblance or delivery quality. |

As checked on 2026-10-23, the [API pricing table](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained) lists instant-voice speech at $15 per million characters ($7.50 for Turbo), while the [HeyGen Voice product page](https://www.heygen.com/models/heygen-voice-1) advertises $30 per million characters. These pages do not establish one consistent rate for every voice route; verify the selected model and account before generating. Using the $15–30 figures as a planning range, an assumed 9,000-character, ten-minute script costs about **$0.14–$0.27 for speech usage alone**, excluding plan or clone charges. Character count, rather than duration, determines that estimate.

A ten-minute film with only 15 seconds of Avatar IV Photo footage therefore needs roughly **$0.58 of avatar-video generation**, plus avatar creation, independently of its full-length voice cost. Reusing downloaded narration and presenter footage incurs neither charge again. Full-length narration does not require full-length avatar video.

Replacing the film's voice requires generating or recording its narration, aligning the new audio and reviewing beats and scene joins; affected presenter clips must also be regenerated. For the initial spike, avoiding that additional timing work is the reason to retain the existing voice. A personal voice is not excluded on the assumption that speech usage would be prohibitively expensive.

## Existing support and evidence limits

The pinned HyperFrames engine already supports nested video, timing, source trimming and layering; the shared [media contract](../../.agents/skills/hyperframes-core/references/variables-and-media.md) and [background-removal guidance](../../.agents/skills/media-use/audio/references/remove-background.md) describe separate narration and transparent talking-head overlays. Explainery supplies [scene beat timing](../../runtime/scene.ts) and [single-file media embedding](../../src/explainer-file.ts). These are foundations for placement, not evidence of a finished presenter workflow.

This research inspected documentation and implementation; it did not generate footage or run presenter-specific renders. Material uncertainties are realistic expression, identity stability between clips, lip synchronization with the intended narration, clean cutout edges, seeking and scene joins, and transparent-video playback across supported browsers. Embedded footage also increases standalone HTML size. Provider updates may change future performances, so retaining approved media is necessary even when a saved identity remains available.

## Policy decision and acceptance

The current [repository guidance](../../CLAUDE.md#project-structure--module-organization) says: “Render only locally with the HyperFrames CLI; no paid cloud rendering or generated-media services.” The author's request to start the HeyGen spike is a task-scoped exception for that experiment, not a general policy change or authorization to purchase a subscription.

For ongoing use, recommend a narrow policy exception for explicitly requested, budgeted presenter generation through HeyGen, while retaining local film rendering and prohibiting generation during ordinary preview/render/export. The rationale is access to the strongest documented hosted fit without making assembly dependent on a paid service. A general exception and production budget remain undecided.

The first spike uses one short intro passage with the existing voice. Acceptance requires convincing lips and expression at the intended size, unobstructed content, correct seeking and joins, and matching behavior in isolated scene review and the assembled film. Reassembling approved footage must make no generation calls. If a cutout is requested, its edges and browser playback must also pass review. One clip cannot establish identity consistency: that claim requires a second, different passage using the same retained character reference and voice before production acceptance.

The author judges whether the performance improves the film. No presenter is a valid outcome if the sample distracts or fails the realism requirement. Production provider selection, a general paid-service exception and any production budget remain open; the recommendations above give the basis for those decisions. Keep the selected passage, prepared audio and generation results in the owning story repository.
