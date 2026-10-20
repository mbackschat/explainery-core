# 0012: Selectable themes share layout and declare visual tokens

Status: accepted.

## Decision

`story.theme` selects a bundled slug or an explicit film-local `./themes/<name>/theme.css` through an opt-in `data-story-theme` stylesheet link. Assembly manages its href, just as it manages composition variables. A local file never silently shadows a bundled slug: explicit source selection preserves pure, deterministic assembly. Existing unmarked links retain their authored selection. Validation checks the selected stylesheet exists; assembly accepts a stale href so it can update it. Full-film preview, render and exports reject stale managed selection, while isolated scene preparation assembles it in memory.

Dark and light themes import a shared base for font declarations, geometry and reusable copy/card styles. The dark entry point and its asset paths remain compatible with existing consumers. Palettes, surfaces, stroke/fill roles, typography treatment and effect decisions are CSS tokens. Story overlays map domain roles to generic tokens; composition geometry and animation stay in their owners. Films may extend a bundled theme using ordinary CSS imports and overrides, or supply their own theme against the shared base. This implements the theme → project customization already described in [ADR 0001](0001-explainery-architecture.md#themes), without a configuration inheritance graph, runtime registry or new CLI flags.

Scene-specific SVG filters remain scene-owned. The dark theme leaves `--glow-filter` guaranteed-invalid using `initial`, allowing `filter: var(--glow-filter, url(#local-filter))` to use the composition's filter. Light sets `none`. Putting the fallback at the consumer matters because a root variable resolves before descendant variables are available.

## Export and evidence

The folder exporter already traverses local CSS imports. The single-file exporter now flattens local imports and embeds each file's relative resources before HyperFrames bundles root stylesheets; missing imports fail delivery. HyperFrames 0.8.142 otherwise leaves imports across a package symlink relative to an inlined parent stylesheet, losing their base. A temporary sibling entry preserves the project's asset base and is removed after bundling; authored `index.html` stays untouched. Plain imports and media queries are supported, while conditional layer/support imports fail explicitly. This closes the gap where a theme could preview correctly but lose fonts or shared styles after offline export.

[Selection and import tests](../../tests/themes.test.ts) guard assembly, explicit local selection, compatibility and stale selection. [Browser export tests](../../tests/explainer-browser.test.ts) exercise both bundled themes and a film-local theme extending light through the linked source, served folder and offline single file, checking shared typography, flat external SVG fills and local filter references. The existing [dark fixture](../../tests/hyperframes.test.ts) guards legacy colours and the linked-package path. The [authoring contract](../authoring.md#author-for-both-themes) defines the tokens and the SVG inheritance boundary.
