# Plain wording

An explainer film informs; it does not advertise. Every word a viewer reads or hears describes what the film shows, in the plainest form that stays exact. This guide applies to all viewer-facing text: headlines, chapter questions, agenda headings, support lines, diagram labels, scene titles, narration, and delivery text such as video titles and descriptions. It also applies to drafts of that text that an agent proposes to the author.

## Why it matters

A slogan makes the viewer decode what was meant before they can check it against the picture. It also signals marketing, which costs a technical audience's trust. Agents produce slogans by default when text must be short: symmetrical pairs, fragments and metaphors fit the space and sound finished. Plain text needs more care, so this guide is applied to every draft before anyone sees it.

## Rules

1. **Describe, do not sell.** Say what happens, what holds or what the viewer should conclude. Never say how good, new, powerful or elegant it is.
2. **A subject and a verb.** A headline is one sentence with a concrete subject from the diagram and a verb that states what it does: “A shared queue assigns each request one owner.” A list of nouns is acceptable only when the diagram is that list.
3. **The diagram's own names.** Use the terms that appear in the diagram and the narration, not a paraphrase or an image.
4. **No rhetorical symmetry.** No counted contrasts (“five pillars, one core”), no mirrored pairs (“state in, state out”), no triplets of slogans (“measure, share, apply”).
5. **No fragments.** A headline or title is one sentence, without a full stop. Questions keep their question mark.
6. **No metaphors.** Knowledge has no “home”, a runtime does not “travel”, and a module is not a “heart” or “backbone”.
7. **No teasers.** Do not withhold the point: no “More than a shape”, “Not just storage”, “Here is the twist”.
8. **No hype words.** Seamless, powerful, unlock, unleash, effortless, game-changing, revolutionary, next-level, cutting-edge, world-class, magic, journey, delightful, empower.
9. **Dull and exact beats clever.** If a plain phrasing feels flat, it is usually right. “The three parts of this film” is a good agenda heading.
10. **Qualifiers go in the support line.** The headline states the claim; limits, status and evidence go in the support line or the narration.

## Examples

Each bad example was written for a real film and rejected by its author.

### Headlines over a diagram

| Bad | Pattern | Good |
| --- | --- | --- |
| Change one path. Share the rest. | fragments, symmetry | An edit copies one tree path and shares the rest |
| State in, state out. | mirrored pair | Operations run synchronously; I/O stays outside |
| One core, many hosts. | counted contrast | The same core runs in the browser, Node and GraalJS |
| More than a shape. | teaser | Shape, identity, rules, scopes and operations |
| Generate. Check. Package. | fragments | The build generates models and checks the package |
| A cursor into the data. | metaphor, no verb | A node handle reads documents without copying them |
| Give domain knowledge a shared home. | metaphor | The library language holds the cross-record rule |
| The agent decides. The CLI executes. | fragments, symmetry | Language operations become CLI verbs for agents |
| One Save. One transaction. | fragments, counted | Save commits every changed record in one transaction |
| Shared knowledge, from definition to application. | slogan arc | Save sends one transaction through the storage interface |

### Cards

| Bad | Pattern | Good |
| --- | --- | --- |
| Built for the browser, ready to travel. | metaphor, slogan pair | The five parts of this film |
| Domain languages: one home for domain knowledge | metaphor | The eight parts of this film |
| Five pillars, one core. | counted contrast | Recap: the five pillars of the browser runtime |
| Recap: one language, eight steps | counted contrast | Recap of the eight parts |
| Ready for the next step? | teaser, no content | How does the graph reach storage? |

A chapter question is a real question that the scene answers, in the viewer's terms.

### Support lines and narration

| Bad | Pattern | Good |
| --- | --- | --- |
| The framework gives this knowledge an explicit home: a language. | metaphor | The framework records this rule in a language, where tools can read it. |
| Five pillars make this runtime fit the browser and ready to travel. | metaphor | The runtime rests on five design decisions; this film explains each. |
| Unlock a powerful modelling workflow. | hype | Tools and agents read the same definitions. |
| Authored once, registered once, used everywhere. | triplet slogan | The author registers each building block once; callers look it up. |

### Delivery text

| Bad | Pattern | Good |
| --- | --- | --- |
| Discover how X seamlessly empowers your team. | hype | How X assigns each request to one owner, step by step. |
| Your journey into graph runtimes starts here. | metaphor, hype | A technical introduction to the graph runtime and its storage interface. |

## How it is enforced

1. **Lexical check.** `explainery validate`, `explainery production` and `preflight`, and therefore `deliver`, reject the recurring forms that [the wording check](../src/wording.ts) recognizes: several sentences or a full stop in a headline or title, teaser openings, counted contrasts, and the hype words and metaphors listed above. The check cannot judge meaning, so it is a floor, not the review.
2. **Review before showing.** An agent that drafts viewer-facing text checks every line against this guide before presenting it, including proposals in a table or a chat message. The review is done with a fresh context: a reviewer receives this guide and the draft lines, nothing else, and returns each line that breaks a rule with the rule's number. The agent revises until the reviewer returns nothing, then presents the text.
3. **New patterns.** When the author rejects wording as slop that passed both steps, add it to the examples here with its pattern, and to the lexical check if the form can be recognized from its words.
