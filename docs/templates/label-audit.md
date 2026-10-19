# Label audit prompt

Copy this prompt for a fresh-context reviewer at the HIGH tier, one per film or per half of a long film, before a delivery render. Replace the angle-bracketed parts. The reviewer reads and reports; it changes nothing. Record the findings and their dispositions in the story repository, then run `explainery label-audit <project-dir> --report <relative-file> --reviewer <name>`. The [production guide](../production.md#audit-on-screen-facts-before-delivery) explains why the guard exists.

```text
You are auditing an explainer film's on-screen text against its source code and documents. READ-ONLY: do not edit,
create or delete any file; do not fetch, switch branches, build or run tests in the source repositories.

Film: <story repository path>
- Audit these compositions: <film>/compositions/<ids>.html. Skip the brand frame and the card layer.
- Copy (headlines, support lines, scene titles, card questions): <film>/story.yaml. Narration is out of scope.
- Evidence and claim ledger: <ledger, research notes, scene briefs>.
Sources: <repository paths and the checked-out branch or revision>.

1. For every visible text (SVG text and tspans, HTML text, static or animated in) and every copy line, decide whether
   it states a domain fact: the name of a language, concept, model, document, view, field, type, function, package,
   file, command or flag, a status, value, count or measurement, or an ownership, membership, relationship or
   behaviour. Layout captions and generic English are not facts; example values the film presents as real are.
2. For each fact, find its support in the ledger, then verify it in the source itself (file and line or heading),
   including the exact spelling of identifiers.
3. Classify each as WRONG (the source contradicts it), UNSUPPORTED (no source after a real search; say where you
   looked), MISLEADING (literally true, but the picture implies a wrong owner, membership or relationship) or OK.

Answer with one table of WRONG, UNSUPPORTED and MISLEADING findings, most severe first: composition, element id and
exact text, the claim, what the source says with file:line, the verdict and the smallest fix, saying whether it needs a
narration change. Then the count of facts checked OK per composition, then your evidence limits. Report factual
accuracy only, not style.
```
