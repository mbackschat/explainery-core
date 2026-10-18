# 0010 Presentation structure and story cards

Accepted 2026-10-18.

## Context

Films assembled scene after scene had no visible chapter boundary. Every composition change looked alike, a scene's motivating question was usually spoken at the end of the previous scene, and nothing showed the viewer the route through the film. Chapter navigation in MP4 and HTML seeks to a scene's first frame, so a viewer who jumps to a chapter skips the question parked before it. A narrated film cannot rely on a presenter to signpost, so the structure has to be authored.

## Decision

The [authoring guide](../authoring.md#structure-the-film-like-a-presentation) states the presentation rules that every story follows: hook, promise and route; a question at the start of each scene and a takeaway at its end; visible scene changes; a closing recap; signposting scaled to the film's length.

The framework supports the two structural devices that recur in every film: a **chapter card** that opens a scene with its number, title and question beside the roadmap of all scenes, and an **agenda card** that lists the scenes. A composition declares one with `card: chapter | agenda`. A card remains a story composition, so narration, voice, estimate, alignment, subtitles and chapters treat it like any other. It has no composition file or root host. Assembly writes all cards and every scene title into the single root element marked `data-story-cards`, and scene previews rebase that list to their selection. A chapter card must open its scene and be followed by content. A scene of agenda cards alone, such as a closing recap, is allowed so that it gets its own chapter. The roadmap numbers only the scenes that open with a chapter card, so the hook and the recap frame the route instead of shifting its numbers; a story without chapter cards lists every scene with content.

`defineCards` in the browser runtime draws the cards, and the theme's `explainery-card` classes style them; the prefix keeps them from matching a story's own markup. Each story keeps a layer file of a few lines inside its own project that calls `defineCards`. Crossfades into and out of a card follow the neighbouring compositions' timing, so a card fades exactly where the film's ordinary overlap would.

## Alternatives rejected

- **One composition file per card.** Every card would repeat the same markup and script, and scene titles would be copied into each one.
- **A card layer file inside core, mounted through `node_modules`.** HyperFrames 0.8.142 compiles a render without sub-compositions whose real path leaves the project, which the `node_modules` link does, while snapshots still show them. The cards would preview but disappear from renders. Assembly therefore rejects a card layer loaded from `node_modules`.
- **Cards drawn over a scene's first composition.** This needs no new composition, but the card and the content would share one timeline and one narration. Chapter navigation would land mid-composition, and every first composition would have to make room for the card.
- **Takeaway, roadmap grouping and recap as schema fields.** Their wording and form are editorial and differ by film. They stay authoring rules in the guide rather than contract fields.

## Consequences

Adding a card changes narration, so a voiced film needs new audio and realignment, like any narration change. A story without cards needs no layer and is unaffected. Restyling cards goes through theme tokens and project overrides, as other copy does. Card wording is never framework text: the number is digits, and every word comes from the story.
