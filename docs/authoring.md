# Author scenes independently, compose them into a film

Author one editorial scene at a time, using one or more self-contained HTML compositions. The film root combines those modules through shared copy, timing, assets, and theme conventions. The [schemas](../schemas/), [types](../src/types.ts), and [CLI](../bin/explainery.ts) define the implemented contracts.

- [Author one scene and integrate it](#author-one-scene-at-a-time).
- [Research content and prepare a proposal for review](#research-and-review-a-film-proposal).
- [Structure the film like a presentation](#structure-the-film-like-a-presentation), with [chapter and agenda cards](#open-scenes-with-cards).
- [Choose HyperFrames skills for the current task](#use-hyperframes-skills-in-scene-work).
- [Understand the concepts](#concepts) and [timing](#timing-and-playback).
- [Find the owning file](#where-a-scene-is-described) and [write a scene description](#write-a-useful-scene-description).
- [Declare a scene](#declare-the-scene), [select and preview it](#select-and-preview-a-scene), and [check a revision](#revise-and-check-a-scene).
- [Prepare pronunciation and voice direction](#pronunciation-and-voice-direction), using the [glossary template](templates/pronunciation.md).

## Research and review a film proposal

Plan the film's argument before implementing its scenes. Research and proposals may span the whole film; the implementation workflow below still authors one scene at a time. Keep these records in the story repository and link them from its README so work survives context compaction and can be reviewed without the conversation.

- **Brief and state:** preserve the user's required topics, audience and constraints; distinguish confirmed decisions from recommendations. Record open questions and the next concrete research step.
- **Sources and claims:** for each material factual claim and meaningful visual relationship, link the exact document heading, code symbol/test, slide or timestamp that supports it. Record repository revision or source date and inspection scope. Distinguish source inspection, test assertions read, tests actually run, historical evidence, illustrative examples and planned behavior. Respect source-selection restrictions such as named speakers or excluded material.
- **Editorial rationale:** explain why each scene, example, order and visual mechanism serves the viewer's understanding. Separate that judgment from evidence about the subject. Record material omissions and tradeoffs with their basis; do not invent reasons or repeat the same justification in several documents.
- **Film proposal:** state the viewer's takeaway, the promise made after the hook, scene sequence and joins, required/optional/excluded content, and any provisional audience, duration or language. Estimates are planning assumptions, not measured timings. Give reviewers one entry point to the scene briefs and evidence.
- **Scene briefs:** state the scene's opening question and closing takeaway, then describe the content to communicate and the visible starting state, change and settled state per beat; attach source references and rationale. Mark composition IDs as proposed until their files and story entries exist. Include questions a reviewer can answer from the evidence, not just requests for general impressions.
- **Review record:** when external review is requested, prepare a self-contained review brief with reading order, scope, evidence boundaries and requested finding format. Record actual findings and dispositions when received. Preparation is not review approval, and a source-backed plan is not verified rendering. Do not contact a reviewer unless instructed to send it.

Prefer concise claim IDs and links when several beats share evidence. Maintain one current statement of each decision; use research notes for discovery and unresolved discrepancies, the proposal for film-wide choices, and scene descriptions for their content. Proposed content summaries may live in briefs before implementation. Once narration and copy become executable, their owner is `story.yaml`; link to them rather than maintaining a second script. Resolve source disagreements explicitly or narrow the claim before using it.

## Structure the film like a presentation

A viewer cannot ask where they are, so the film signposts its structure the way a good presenter does. Plan this structure in the proposal and scene briefs, and check it in every review of the script.

- **Open with a hook, then the promise and the route.** Start on a concrete problem the viewer recognises. Then say what they will understand by the end, and show the route through the scenes, for example with an agenda card.
- **Open each scene with its question.** The question that motivates a scene belongs at its start, not at the end of the previous scene. MP4 and HTML chapter navigation seeks to a scene's first frame, so a question parked in the scene before is skipped. A chapter card asks it in one spoken sentence.
- **Close each scene with its takeaway.** End on the one statement the viewer should keep, spoken and visible on screen. Put qualifications, limits and status labels before it. Viewers remember the end of a section best, and a scene that ends on a caveat leaves the caveat as its message. A short bridge may follow; the next scene's opening asks the question.
- **Make scene changes visible.** A change of scene should look different from a change of composition within a scene. A chapter card marks the boundary; without one, use a deliberately different transition.
- **Close the film with a recap and a next step.** Return to the hook and restate the takeaways in the film's own structure, for example over a closing agenda card. Name one concrete next step only when the audience has a real destination; do not invent one. Give the recap its own closing scene, and add nothing after it. A summary spoken over the last content diagram does not replace the recap: the film still ends inside that scene's material, without its structure. Hold the final frame at least two seconds after the last word, so the film does not cut on a word.
- **Scale the signposting to the film.** Each card costs a few seconds. Keep its narration to one sentence and its whole slot to about three to six seconds. A short film needs a shorter question, not fewer rules. When scenes last only seconds, consider fewer, larger scenes rather than a card every few seconds.

### Frame the film

A film of more than three editorial scenes uses one frame. `explainery validate`, `explainery production` and `preflight`, and therefore `deliver`, enforce it; previews, snapshots and verification do not, so a film can be built before its frame exists:

- **The first scene orients.** It names the topic, says what the viewer will understand, and shows the route on an agenda card. A short hook problem may come first; the scene is unnumbered and has no chapter card.
- **Every scene in between opens with a chapter card** that asks the scene's question.
- **The last scene is the recap**, made of agenda cards alone, and nothing follows it.

```yaml
scenes:
  - id: introduction
    title: Introduction
    compositions:
      - id: route
        card: agenda
        copy: { headline: The three parts of this film }
        narration: "Requests reach the team through two inboxes. This film shows how one shared queue assigns each request an owner, in three parts."
        hold: 1.2
        overlap: 0.6
  - id: ownership
    title: Ownership
    compositions:
      - id: ownership-question
        card: chapter
        copy: { headline: Who owns a request? }
        narration: Who owns a request?
        hold: 1
        overlap: 0.6
      - id: ownership-queue
        copy: { headline: A shared queue assigns each request one owner }
        narration: "{assign} The queue assigns ..."
  # … two more scenes, each opening with a chapter card …
  - id: recap
    title: Recap
    compositions:
      - id: recap
        card: agenda
        copy: { headline: Recap of the three parts }
        narration: "Requests now wait in one queue, each has one owner, and a handover moves the owner, not the request."
        hold: 2
```

Adding the frame to an existing film changes no composition file: cards are story compositions without HTML, and the voice cache keeps the unchanged clips. Every later start shifts, so the film is realigned and rendered again.

### Write plain copy

Every word on screen and in the voice describes the subject and never sells it. The [plain wording guide](plain-wording.md) owns the rules and their good and bad examples, and applies to headlines, card text, support lines, scene titles, narration and delivery text. `explainery validate`, `explainery production` and `preflight` reject the recurring slogan forms that the [marketing slop detector](plain-wording.md#the-marketing-slop-detector) recognizes lexically; its review step applies to every draft before anyone sees it.

### Open scenes with cards

A chapter card shows the scene's number and title, its question and the roadmap, with the current scene marked. An agenda card shows its headline above the same roadmap, none marked, so it serves both as the route after the hook and as the recap at the end. The roadmap numbers the scenes that open with a chapter card; a hook before them and a recap after them frame the film and stay unnumbered. When a film's structure has a name, such as five pillars, give each chapter card that word as its `category` and keep the titles plain, so the number is not repeated in the title. Declare a card as a composition with `card: chapter` or `card: agenda`. Its narration, hold and overlap work like any composition's; its `copy.headline` is the question or agenda heading, and optional `category` and `support` are shown too. A card has no composition file and no root host. Every word comes from the story; the framework adds only digits.

```yaml
  - id: storage
    title: How data is stored
    compositions:
      - id: storage-question
        card: chapter
        copy:
          headline: Where does the state live?
        narration: Where does the state live?
        hold: 1
        overlap: 0.6
      - id: storage-tree
        copy:
          headline: An edit copies one tree path and shares the rest
        narration: "{tree} The state lives in a persistent tree."
```

A chapter card must be the first composition of its scene and be followed by content. A scene of agenda cards alone is allowed: a closing recap in its own scene gets its own MP4 and HTML chapter. A topic that needs two compositions, such as reading and then saving, stays one numbered scene; open its later composition with a spoken question instead of a second chapter card. Remember that YouTube chapters need at least ten seconds, so a short agenda card belongs inside the hook scene rather than in a scene of its own. A card fades in over the previous composition's overlap and out over its own. Mount the card layer once in the root, as described in [the README](../README.md#add-chapter-and-agenda-cards). [ADR 0010](adr/0010-presentation-structure-and-cards.md) records the decision.

### Write headlines that state the claim

A composition's `copy.headline` stays over its diagram for the whole composition, so it tells the viewer what the diagram shows. State the claim the diagram demonstrates, with its concrete subject and the names the diagram and narration use: “Save commits every changed record in one transaction”, not “One Save. One transaction.” Slogan fragments, rhetorical pairs and teasers such as “More than a shape.” sound like marketing and give the viewer nothing to check against the picture. Put qualifiers and evidence limits in the support line, and end a headline without a period. A chapter card's headline is the scene's question and keeps its question mark.

A headline fits on one line. The dark theme sets it at 65 px in a 1500 px copy block; on 18 October 2026 about 50 characters fit with the bundled font, and a long final word wraps sooner. A wrapped headline pushes the support line out of the copy block, so `explainery verify` fails a composition whose headline wraps. Shorten the claim or move a qualifier into the support line rather than shrinking the type.

## Show the mechanism and let motion tell it

A narrated film already speaks its explanation; the picture has to show it. Plan these rules in every scene brief and check them on the beat frames.

- **Show first, then label.** Draw the thing the narration talks about: the structure, the object that moves, the result that changes. Labels name what is drawn in one to three words. A card that holds only text, or a frame whose meaning depends on reading sentences, is a slide, not an explanation. Keep identifiers on screen only where the identifier itself is the point, such as a method the viewer will later use.
- **Motion carries the story.** When something changes, show it changing: an object travels from cause to effect, transforms into its next form, splits, merges, is replaced, or bounces back when it is refused. The motion should make the claim visible, so that a viewer with the sound off can still tell what happened. Fades bring context in and clear it away; they never carry the explanation on their own.
- **One change at a time.** Give each beat one change the eye can follow, anchored to the word that names it. Let earlier state stay put, so the change stands out against it.
- **Focus follows the voice.** A diagram that holds several parts must show which part the narration is talking about, or viewers search the frame while they listen. Let the referenced part move or draw on its word, and let the rest step back while the voice dwells elsewhere. Disclose a diagram progressively only where its parts are explained in order; if everything appears piece by piece, the motion itself becomes the noise.

The scene context's `motion` helpers cover the recurring moves, so compositions share one tested implementation instead of redeclaring it:

```js
defineScene({ window, document, gsap }, 'checkout', (tl, { beat, motion }) => {
  motion.draw('#co-link', beat('partial') + .4);                                    // stroke a hidden line to full length
  motion.rise('#co-holder', beat('materialize'));                                    // fade in while moving into place
  motion.travel('#co-token', [[150, 374], [900, 454]], beat('refuse') + .6, 1.3);    // show, move through waypoints, hide
  motion.pulse('#co-token-mark', '95 17', beat('retry') + 2.5);                      // scale an inner group about an origin
  motion.focus('#co-ledger', beat('merge'), beat('retry'), { within: '#co-diagram' });  // dim the rest of the diagram
});
```

`draw` needs the line hidden in the markup (`opacity="0"`) and holds a `marker-end` arrowhead back until the stroke reaches it; `rise` hides its target until its start because it is the target's first tween. `focus` dims the other children of its container, so give each part of a diagram its own wrapper group and leave that wrapper's opacity to focus: the scene fails when another tween animates it, or when two focus windows in one container overlap. Never tween `x`/`y` and `svgOrigin` scaling on the same group; pulse an inner group instead. Inside a sub-composition, a `fromTo` with `immediateRender: false` loses an opacity from-state in MP4 renders while snapshots show it, so `explainery validate` rejects that form; the helpers never use it.

## Author one scene at a time

1. **Define the scene boundary.** Give the scene a stable ID, title, and one idea to explain. Describe its starting state, visual beats, final state, and handoff to its neighbors. Map the description to its ordered composition IDs in `story.yaml`. Use one composition when it is sufficient; split only when separate HTML modules make the scene easier to author.
2. **Build the modules.** Keep each composition in `compositions/<id>.html`, with its own elements and local timeline. Initialize the state it needs so it can be sought and previewed without a previous composition having run. Anchor meaningful actions to its local beats, keep diagram labels and motion in that module, and reuse explicit shared assets and theme tokens. Do not reach into a neighboring composition's elements or depend on its animation callbacks.
3. **Wire the film.** For a new composition, author a matching host in the film's `index.html` with `data-composition-id` and `data-composition-src`. Keep its placement consistent with the story order and timing. Generate or update composition timing, then run `assemble` to fill the hosts' copy, beats, starts, and durations. Assembly updates existing hosts; it does not create missing HTML modules or hosts. Follow the [HTML wiring example](../README.md#write-a-scene) and [assembly contract](../README.md#assemble-the-root-composition).
4. **Iterate within the scene.** Select its editorial ID with `focus`, edit its story entries and composition sources, then rerun preview. Keep that scope through subsequent edits and draft renders. Edit shared theme, assets, timing, or root structure when the scene needs it, and identify which other scenes are affected. Edit original sources; `.explainery/scenes/` is disposable preview output.
5. **Check the joins, then the film.** Review the scene alone, then preview it with each affected adjacent scene. Check incoming and outgoing states, overlaps, narration continuity, and shared layers. Run full-project validation and assembly checks, then preview the whole film. Render the full film when a delivery is needed.

From a story repository, use the film directory as the command argument:

```sh
pnpm exec explainery scenes film-example
pnpm exec explainery focus film-example --scene introduction
pnpm exec explainery assemble film-example
pnpm exec explainery validate film-example
pnpm exec explainery preview film-example
pnpm exec explainery render film-example --quality draft
pnpm exec explainery preview film-example --scene <scene-id>,<next-scene-id>
pnpm exec explainery assemble film-example --check
pnpm exec explainery preview film-example --film
```

Replace the example directory and scene IDs with the story's own values. The adjacent IDs must be consecutive in film order. The `--scene` and `--film` flags above override focus for one command; use `focus film-example --film` to switch subsequent work to the full film. Validation and assembly always inspect the complete project.

Scenes compose through their source modules in the film root. Isolated preview uses the same sources with the selected time range, shared layers, and trimmed audio; there is no separate scene video to stitch back into the film. A scene is ready when its intended states work in isolation and its joins work in context.

## Use HyperFrames skills in scene work

The shared HyperFrames skills provide agent instructions, technical references, animation recipes, and helper scripts. Use their engine guidance within the scene workflow above. Start with the [entry skill](../.agents/skills/hyperframes/SKILL.md), then load the domain skills needed for the current task. The [shared setup](../README.md#shared-authoring-skills) explains discovery in Claude Code and Codex; no story-local installation is needed.

| Scene task | Skills to read | Use in Explainery |
| --- | --- | --- |
| Define the visual idea and beats | [hyperframes-creative](../.agents/skills/hyperframes-creative/SKILL.md) | Develop visual language, typography, and choreography within the story's theme; record intent in its scene description. |
| Build a composition and wire it into the film | [hyperframes-core](../.agents/skills/hyperframes-core/SKILL.md) | Read before writing composition HTML: structure, variables, module boundaries, media ownership, and deterministic playback. |
| Animate a composition or design a transition | [hyperframes-animation](../.agents/skills/hyperframes-animation/SKILL.md), [hyperframes-keyframes](../.agents/skills/hyperframes-keyframes/SKILL.md) | Adapt motion recipes and seek-safe GSAP guidance into the composition's `defineScene` callback; review transitions between neighboring scenes. |
| Inspect, diagnose, and review the scene | [hyperframes-cli](../.agents/skills/hyperframes-cli/SKILL.md), [hyperframes-studio](../.agents/skills/hyperframes-studio/SKILL.md) | Use lint, snapshots, diagnostics, and readable preview tracks while preserving Explainery's scene selection and source ownership. |
| Add a reusable visual or media asset | [hyperframes-registry](../.agents/skills/hyperframes-registry/SKILL.md), [media-use](../.agents/skills/media-use/SKILL.md) | Load when the scene needs components, images, icons, footage, or audio assets; adapt them to the existing theme and module structure. Follow the project's local-media and service constraints. |
| Mix audio already placed in the film | [hyperframes-audio](../.agents/skills/hyperframes-audio/SKILL.md) | Load for fades, gain, ducking, or effects. Keep narration timing and shared audio placement consistent with the film. |
| Plan a broader production task | [hyperframes](../.agents/skills/hyperframes/SKILL.md), [general-video](../.agents/skills/general-video/SKILL.md) | Use routing and production references selectively. Explainery continues to own scene authoring and film assembly. |

Apply these integration rules when borrowing examples or helper scripts:

- **Use the existing composition timeline.** Add recipe tweens to the `tl` supplied by `defineScene`; the runtime creates and registers the composition's paused timeline. Preserve local beat anchors and deterministic seeking instead of copying a second timeline-registration skeleton. Follow the [HTML wiring example](../README.md#write-a-scene).
- **Keep each value in its owning file.** Copy, narration, and beat markers belong in `story.yaml`; cue seconds belong in `timing.json`. Keep the existing root hosts and assembly structure. Generic scaffolding and Studio edits must respect the [file ownership table](#where-a-scene-is-described).
- **Keep scene focus effective.** Use Explainery's preview and render commands above. Direct HyperFrames lint, snapshot, and check commands use the supplied project and do not consult Explainery focus; do not describe them as selected-scene checks. Prefer `explainery snapshot` for stills: it resolves beat addresses on the full-film clock and keeps frames local. Review joins and run film-wide validation and assembly checks before completion.
- **Check examples against the pinned CLI.** Use package scripts or `pnpm exec hyperframes`, and verify unfamiliar commands with its local help. The shared skill snapshot can describe capabilities beyond the pinned engine. The entry skill's automatic upgrade advice and workflow installation steps do not apply during scene work; review CLI and skill upgrades separately, with shared skill changes made in core.
- **Resolve helpers from the shared bundle.** Read references relative to their owning skill and invoke scripts by their core path, supplying the story or film path as required. Keep project commands in the story repository; do not copy helpers or skill bundles into it.

## Concepts

| Term | Meaning |
| --- | --- |
| Film | The complete story: an identity, title, theme, canvas dimensions and frame rate, ordered editorial scenes, and a shared playback clock. It can produce both a video and an explainer page. |
| Scene | A named editorial unit explaining one coherent idea. It contains one or more ordered compositions and is the unit a person edits, previews, and renders. |
| Composition | An executable HTML module combining text, graphics, media, layout, and motion. Story compositions render parts of a scene; the root composition places them and shared layers on the film clock. |
| Element | A visual or media layer within a composition, such as a text label, SVG path, image, or audio track. It has its own geometry, styling, and animation. |
| Beat | A named cue in a composition's narration, written `{beat-id}`. Timing assigns it a local second, and animation reads it with `beat('beat-id')`. |
| Timeline | The placement and animation of compositions and elements in time. Film timing uses global seconds; each composition's animation uses local seconds. |

An editorial scene can keep an introduction, moving diagram, and conclusion together without merging their HTML. Grouping is explicit, with one level: scenes contain compositions, never other editorial scenes. Boundaries are not inferred from headlines, narration, visual changes, or composition counts, and there is no separate shot entity.

A composition's ID names `compositions/<id>.html`, its `data-composition-id`, and its registered animation timeline. Animated compositions own one paused, seekable timeline; static compositions explicitly declare `data-no-timeline`. The historical helper name `defineScene` operates on compositions: it fills `data-copy` slots, resolves beats, and rejects missing beats or timelines that exceed the composition duration. Duration and beats arrive through composition variables. See the [runtime](../runtime/scene.ts).

Assets are reusable resources, such as SVGs, fonts, or audio files, used by elements. When the same subject persists across beats, keep its element alive and animate its properties. Use composition-prefixed element IDs to keep them unique in the assembled film. Elements and assets add no editorial grouping level or story entry.

The project directory passed to CLI commands contains the film's authored files and runtime assets. It may be the repository root or a film subdirectory. The root `index.html` combines compositions with shared layers such as continuous narration; see the [assembler](../src/assemble.ts) and [exporter](../src/explainer.ts).

## Timing and playback

`timing.json` places compositions with global `start` and `duration` values. Its historical `scenes` keys are composition IDs; editorial scenes have no separate timing entries or beat clock. A scene's range begins at its earliest composition start and ends at the latest `start + duration`. Consecutive scene selections use the same enclosing-range rule, preserving authored overlaps and gaps.

Beat IDs are local to a composition and may recur in others. Film time is composition start plus local beat time. Beats must exist, follow narration order, and lie within the composition duration. Read current seconds from timing rather than duplicating them in scene descriptions. See the [timing schema](../schemas/timing.schema.json), [narration parser](../src/narration.ts), and [validator](../src/validate.ts).

Tween durations and offsets remain authored seconds. Moving a beat changes an anchored start; it does not shorten the tween or reflow copy. Use numerical motion choices in a plan only when deliberate, and recheck them when narration changes.

Direct, forward, and backward seeks to the same timestamp must produce the same visible state. Construct motion synchronously, without wall-clock timers or completion-only mutations. HyperFrames owns media playback.

## Where a scene is described

| To find or change | Source of truth |
| --- | --- |
| Scene purpose, visual sequence, transitions, and evidence behind claims | The story's scene descriptions or story proposal, linked from its README. |
| Editorial IDs, titles, grouping, composition copy, narration, and beat markers | The film's `story.yaml`, following the [story schema](../schemas/story.schema.json). |
| Composition starts, durations, and local beat seconds | The film's `timing.json`, following the [timing schema](../schemas/timing.schema.json). Scene ranges are derived from these values. |
| Actual diagrams, diagram labels, layout, and motion | `compositions/<composition-id>.html` and its linked assets. `defineScene` operates on a composition despite its historical name. |
| Shared visual language | The story's design guide and theme overlay. |
| Pronunciation decisions, voice direction, and listening evidence | A glossary in the story repository, or its explicitly chosen domain owner; link it from the story README. Executable draft-voice substitutions belong in `story.yaml`'s `pronunciations`. |
| Root placement and shared layers | The film's `index.html`; assembly refreshes its story copy and timing attributes. |

The visual plan records intent; the composition determines what renders. When they disagree, inspect the implementation and evidence before deciding which to change. Link to executable copy and timing rather than maintaining duplicate transcripts or cue-second tables in the plan. Reference-video observations may retain source-global timestamps, clearly labelled as evidence rather than executable timing.

## Write a useful scene description

Start with the idea the viewer should understand, then describe what they will see at each beat. A scene is that editorial unit; its compositions are the HTML modules that execute it. A scene description is a visual plan kept in the story repository's Markdown documentation. Explainery does not read that prose or generate animation from it.

Use the story's existing scene document or proposal. Give each editorial scene a heading with its stable ID and title, and link it from the story README's scene map. Keep the description sufficient to implement and review:

- **Purpose:** the question that opens the scene, the one idea the viewer should take away, and why this scene follows the previous one.
- **Sources:** links to the claim's evidence or reference frames; distinguish observations, intended changes, and approximations.
- **Rationale:** why the example and visual sequence explain the intended idea; link shared decisions from the film proposal instead of repeating them.
- **Composition mapping:** ordered composition IDs with links to their HTML files; point to `story.yaml` for spoken and on-screen copy.
- **Visual beats:** for each composition and beat ID, describe the visible starting state, what changes, and the settled state the viewer must be able to read. Name any diagram labels that matter to understanding the claim.
- **Transitions:** what enters from the previous composition, what persists, and what remains at the handoff to the next one. Identify shared assets when a change affects other scenes.
- **Review criteria:** the frames and transitions that prove the intended idea is visible and agrees with the source. Separate planned behaviour from verified rendering.

For example, an `introduction` scene could contain `problem` and `solution` compositions. Its purpose is to show how one shared queue replaces competing inboxes. The visual plan might include:

| Composition / beat | Visible state and change | Review criterion |
| --- | --- | --- |
| `problem` / `arrive` | Three requests enter separate inboxes; two carry the same task label. | The duplicated task is visible before the next beat. |
| `solution` / `route` | The inboxes converge into one queue; the duplicate merges into the existing item. | One item remains per task, and the shared queue stays readable through the closing hold. |

## Declare the scene

The scene grouping contract extends `story.scenes` with one explicit grouping level. A legacy flat entry is an editorial scene containing one composition, with the same ID. Existing composition paths, narration markers, and `timing.scenes` keys continue to work.

This complete story example declares the scene above; it still needs composition HTML, timing, and a root composition to render:

```yaml
id: shared-queue
title: One shared queue
theme: dark
canvas: { width: 1920, height: 1080, fps: 30 }
scenes:
  - id: introduction
    title: Introduction
    compositions:
      - id: problem
        copy:
          headline: Separate inboxes let two people take one task
        narration: "{arrive} Requests arrive in separate inboxes."
        hold: 1
      - id: solution
        copy:
          headline: One shared queue gives each task one owner
        narration: "{route} Route each task through one shared queue."
        hold: 1
```

`introduction` is the focus and selection ID; `problem` and `solution` name the HTML files and the keys in `timing.scenes`. The title is for human selection and need not equal an on-screen headline. Keep purpose, evidence, and visual-plan prose in Markdown; those are not fields in the story schema.

The exported [types](../src/types.ts) define `Composition` and `Scene`; `Story.scenes` is `(Composition | Scene)[]`. Every group contains at least one composition. Composition IDs are unique across the film; editorial scene IDs are unique across its scene entries. Flattening groups preserves composition order for narration, alignment, assembly, and film playback. Explainer pages use one section per editorial scene with combined narration. A legacy flat entry uses its composition ID and `copy.headline` as the editorial ID and title.

The public [story helpers](../src/story.ts) are `storyScenes(story): Scene[]`, `storyCompositions(story): Composition[]`, and `sceneRange(scene, timing): { start: number; duration: number }`. They normalize flat entries, flatten compositions, and derive editorial ranges without adding timing entries.

## Select and preview a scene

List the current editorial IDs, titles, and derived ranges with `explainery scenes <project-dir>`. The scene-targeted commands use editorial scene IDs:

```sh
explainery preview <project-dir> --scene <scene-id>
explainery render <project-dir> --scene <scene-id>
explainery preview <project-dir> --scene <first-id>,<next-id>
explainery render <project-dir> --scene <first-id>,<next-id>
```

A comma-separated selection must be consecutive and in film order. The command derives its range, includes global shared layers, and trims continuous audio to that range. Preview uses a disposable project view refreshed from source on each preview/render invocation; only dependencies remain linked. Never edit `.explainery/scenes/`. Rerun preview after any source edit, including animation, artwork, styles, story copy, or timing. Use `explainery assemble <project-dir>` to refresh the original root after copy or timing changes.

These commands do not infer semantic boundaries or orchestrate separately encoded scene caches. See the [CLI](../bin/explainery.ts) and [story schema](../schemas/story.schema.json).

### Select compositions inside a scene

To review new or changed compositions inside a long scene without rendering all of it, select them by composition ID:

```sh
explainery preview <project-dir> --composition <composition-id>
explainery render <project-dir> --composition <composition-id>,<next-composition-id>
```

The IDs must be consecutive compositions of one editorial scene, in story order; IDs from different scenes, a gap, a reversed order or an unknown ID fail before HyperFrames starts, naming the IDs and their scenes. The selection uses the scene clock rule: its range encloses the selected compositions, including their overlaps with each other, and starts at zero; neighbouring compositions are left out even where they overlap it. Shared layers and the trimmed narration stay, as in a scene preview; a chapter or agenda card appears only when it is itself one of the selected compositions. `--composition` is a separate flag because a flat scene's ID equals its composition's ID, so `--scene` could not tell the two apart. It cannot be combined with `--scene` or `--film`.

Like `--scene`, the flag overrides focus for one command and never changes it. The disposable view is `.explainery/scenes/<story-id>--<scene-id>.<composition-ids>` and the default render is `renders/<story-id>-<scene-id>.<composition-ids>.mp4`, with composition IDs joined by `--`; IDs never contain a dot, so these names cannot collide with a scene selection's. The render carries no chapters, because it lies inside one scene, and Explainery still checks its duration against the selected range. With `render --quality delivery --reuse`, the composition IDs are part of the fingerprint, so a composition render and a scene render are never mistaken for each other.

`explainery focus <project-dir> --scene <id-or-title>` stores the active scene locally until changed; `--film` returns to the whole film. Without options, `focus` reports it. Subsequent preview/render commands use that target and print it. Explicit `--scene` or `--film` on a command overrides it once. Agents apply the same focus to conversational edits. Focus lives in ignored `.explainery/focus.json`, not in the story schema, and does not scope validation, alignment, assembly, or page export.

## Revise and check a scene

1. Read the description, evidence, current story entry, and mapped compositions. Select the scene with `focus` before editing its sources.
2. Update the owner of the change from the table above. A changed claim or visual sequence also needs a matching description; a narration change needs a matching voice and timing before delivery.
3. After copy or timing changes, run `explainery assemble <project-dir>`. Run `explainery validate <project-dir>` and `explainery assemble <project-dir> --check` to check source consistency.
4. Rerun preview to refresh the scene view. Inspect each beat's settled state and the transitions, including adjacent scenes when the handoff changes. Address still frames by beat with `explainery snapshot <project-dir> --at <composition>:<beat>+<seconds>`, or review every beat of one composition beside its narration with `explainery verify <project-dir> --scene <scene-id> --composition <composition-id> --quick`. Check direct, forward, and backward seeks to the same timestamp; full `verify` compares them.
5. Use the story's visual verification workflow to compare the result with the plan or reference evidence. Validation proves structural consistency; it does not prove visual fidelity, legibility, or claim accuracy.

See the [composition implementation walkthrough](../README.md#write-a-scene) for HTML and runtime wiring, and [preview and render](../README.md#preview-and-render) for command details.

## Read narration in a silent preview

`explainery preview <project-dir> --narration` adds script captions to the disposable preview. The overlay follows the selected scene clock and survives forward/backward seeks. Wording stays in `story.yaml`; cue timing is an approximation between beat anchors, with the authored hold excluded. The overlay identifies itself as draft narration with estimated timing, even when the scene timing was imported or voice-aligned.

This mode does not change composition sources, timing, rendered video or exports. Rerun preview after script changes; render prepares a clean view without the overlay. For the whole film, use `--film --narration`, including when checking status or stopping its preview. See [the decision and limits](adr/0008-preview-narration.md).

## Pronunciation and voice direction

Keep a reusable glossary of spoken forms before recording or generating narration. Start from the [pronunciation template](templates/pronunciation.md) in the story repository, or link to an existing domain-owned glossary when the user chooses that owner. Keep one authoritative entry per term; record only film-specific overrides locally. Project terms, names and readings belong outside this public framework. The glossary records decisions and evidence, not another copy of the script.

Record the narration language and locale, narrator or synthetic voice, and intended delivery: conversational or formal, pace, emphasis and pauses. Mark each term's reading **confirmed** when the user or a cited authoritative source settles it; otherwise mark it **proposed**, with a recommendation and its reason. Preserve who or what established the reading and when. A confirmed reading is not evidence that a particular voice pronounced it correctly; listening verification is a separate record.

Keep canonical spelling in `story.yaml` narration, diagram labels, captions and exported text. Record a separate spoken form for pronunciation, including how to read letter names, numbers and punctuation where they matter. Apply these policies consistently:

- **Acronyms and abbreviations:** decide whether to spell the letters, say a word, or expand the phrase. Do not infer the preferred reading from capitalization alone; letter names can depend on locale. Core voices common acronyms the same in every film (`COMMON_PRONUNCIATIONS` in [src/narration.ts](../src/narration.ts): AI, API, CLI, ID, I/O, SPI); a story's own entry overrides one. For the local voice, hyphenate spelled letters into one token and write the letter I as `eye` (`C-L-eye`): a separate `I` is read as the unstressed pronoun before a verb, and a lone `A` as the article, so `explainery validate` rejects both.
- **Code identifiers:** preserve their case and separators in writing. Record how their parts are spoken; do not assume CamelCase or a hyphen reliably creates the intended pronunciation or pause. Read syntax aloud only when the explanation needs that syntax.
- **Filenames, paths and commands:** prefer a short descriptive reference in narration when the exact spelling is already visible. If an exact string must be spoken, specify treatment of extensions, separators, flags and numbers in the glossary.
- **Names and unfamiliar terms:** use the owner's preference or a cited pronunciation source when available. Keep an inferred reading proposed until it is settled; resolve material ambiguity with a recommendation rather than silently choosing a new convention.

For cached local synthesis, measured composition segments, alignment reports and checked delivery, follow the [production workflow](production.md). Put confirmed substitutions in the story's `pronunciations` mapping and generate input with `explainery narration`; see [draft a voice](../README.md#draft-a-voice). Matching is case-sensitive, with no adjacent letter or digit, and longer keys take precedence. Check the emitted input, including plurals, compounds and punctuation, rather than assuming a mapping covers every occurrence. The [narration implementation](../src/narration.ts) applies those spellings only to voice input; reader-facing text and alignment retain the canonical words. A glossary entry alone changes no audio.

Use an engine's pronunciation lexicon, phoneme notation, alias or speech markup only after verifying that the selected engine and version support it. Record the mechanism and settings alongside the listening evidence. Do not put unsupported engine syntax into canonical narration or assume another voice will honor the same spelling. If the available path cannot express the intended reading, retain that limitation and choose a supported voice-input treatment or a human recording within the task's authorized scope. Voice preparation follows the project's local-media constraints.

Before producing the full voice, make and listen to a short representative sample containing the difficult terms in ordinary sentences. Check pronunciation, intelligibility, pace, pauses and transitions between technical and ordinary language. Record the sample, voice/settings, date and findings; a phoneme inspection can help diagnose a problem but does not replace listening. Apply the project's existing review or approval requirements, and do not label an unheard sample verified.

After the accepted reading or voice changes, regenerate or rerecord the affected audio, then [align timing to the actual recording](../README.md#align-timing-to-a-recorded-voice) and assemble the film. Inspect alignment near substituted terms: a spoken expansion may tokenize differently from its canonical identifier. Recheck beat placement, tween bounds, readable holds and adjacent joins; alignment does not resize animation or reflow text. Refresh transcripts and subtitles when the audio changes. Silent preview and estimated timing cannot verify pronunciation or final voice pacing.
