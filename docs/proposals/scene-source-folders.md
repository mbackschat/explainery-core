# Scene source folders

Status: accepted for implementation on 5 November 2026 after external review; [ADR 0016](../adr/0016-scene-source-folders.md) records the decision. This contract changes authoring and source resolution, not the animation runtime. The [amended contracts](#contracts-amended-on-acceptance) identify the existing rules it refines. The acceptance criteria remain the required implementation and migration checks.

## Problem and recommendation

A scene can already be selected, previewed and rendered independently, but its source is distributed between the film's story, compositions and documentation. Authors reasonably expect a scene to have one place containing its definition, narration, visual modules and explanation.

Give each editorial scene a source folder. The film references those folders in order and retains shared settings, resolved timing and authored root assembly. Resolve the folders into the existing ordered scene/composition model. Preserve the current flat runtime, overlapping composition windows and continuous narration.

Independence means scene-owned content within a film with explicit shared dependencies. It does not mean a standalone HTML document or a portable package requiring no film integration. Editing existing narration or visuals stays within the scene folder; adding or removing a visual composition still requires a matching change to the film's root hosts.

## Evidence and constraints

Read-only inspection of existing films on 5 November 2026 found these materially different patterns. Project-specific evidence remains outside this public framework proposal. No hypothetical folder migration was rendered; these findings establish design constraints, not verified equivalence after relocation.

| Observed pattern | Required preservation |
| --- | --- |
| Editorial cuts with local entrance animations and outgoing preparation of matching imagery | Keep composition initialization, final states and local animation intact; do not infer a fade from the scene boundary. |
| Overlapping compositions, including joins across editorial scenes | Keep actual starts, durations and simultaneous rendering. Separately rendered scene videos cannot simply be concatenated. |
| A recap card fading over a held diagram, without an outgoing diagram fade | Preserve the shared card layer and its neighbor-derived fades; overlap is not a mandate for a symmetrical crossfade. |
| Host DOM order differing from narration order, with explicit tracks and stacking | Retain authored root order and unmanaged attributes. Do not sort hosts or insert scene wrappers. |
| Persistent backgrounds, branding and narration; presenter behavior inside a shared card layer | Keep these explicit film dependencies, including scene-specific behavior in shared layers. |
| A scene's initial style supplied by root CSS | Record this dependency; moving its HTML does not make that scene fully independent of the film shell. |

The existing [scene selector](../../src/story.ts) derives ranges from composition timing, [scene preparation](../../src/scene-project.ts) preserves shared layers and clips audio, and [card variables](../../src/cards.ts) derive fades from adjacent timing. These contracts provide the runtime behavior this proposal preserves. The current story schema's description of `overlap` as a crossfade is imprecise: ordinary compositions still author their own visual transition.

## Required source contract

```text
film/
  story.yaml
  index.html
  timing.json
  theme/
  assets/
  compositions/
    cards.html
  scenes/
    example/
      scene.yaml
      README.md
      diagram.html
      assets/
```

`story.yaml` owns film identity, canvas, theme, voice, pronunciation rules and ordered scene references. Each `scene.yaml` owns one scene's ID, title and ordered compositions, including their copy, narration, beat markers, hold and overlap. Its README describes purpose, evidence, visual beats, incoming/outgoing states, review criteria and shared dependencies; it links to executable sources instead of duplicating script or timing. The README is required by the authoring convention, not by runtime schema validation or a render gate. HTML remains authored visual source. Scene-specific assets may live beside it; genuinely shared resources remain film-owned.

The proposed source types reuse the existing [composition and story types](../../src/types.ts):

```ts
import type { Composition, Story } from '../../src/types.ts';

interface SceneReference {
  source: string;
}

type VisualSource = Omit<Composition, 'card'> & {
  source: string;
  card?: never;
};

type CardSource = Composition & {
  card: 'chapter' | 'agenda';
  source?: never;
};

interface SceneSource {
  id: string;
  title: string;
  compositions: Array<VisualSource | CardSource>;
}

type FilmSource = Story | (Omit<Story, 'scenes'> & {
  scenes: SceneReference[];
});
```

A film uses either the existing inline scene list or a list of references, never a mixture. Reference and composition lists must be nonempty. Referenced scene files cannot reference further scene files. Existing inline stories, including legacy flat composition entries, remain supported with their current path convention.

For example, a referenced film's scene list contains `- source: scenes/example/scene.yaml`. That file contains:

```yaml
id: example
title: Example
compositions:
  - id: example-diagram
    source: diagram.html
    copy:
      headline: Example
    narration: "{show} An example."
    hold: 1
    overlap: 0
```

These are illustrative labels, not proposed film copy. A card instead declares `card: chapter` or `card: agenda` and has no `source`. Its copy and narration belong to the scene, while the existing shared card renderer draws it. Card ordering and agenda-only scene rules remain unchanged.

### Paths and identity

- Scene references resolve relative to the film directory; visual `source` paths resolve relative to their owning `scene.yaml`. Paths must name existing local files inside the film's real directory boundary. Visual sources must remain inside their scene folder. No remote references or escaping symlinks are accepted.
- Scene IDs and composition IDs retain their existing, separate film-wide uniqueness rules. Repeated references to the same scene are rejected by resolved real-path identity, including aliases; this proposal does not add reusable scene instances or rename IDs from folder names. Each referenced visual file belongs to one composition, also checked by real path; shared implementation belongs in explicit dependencies.
- Film-root-relative URLs remain the authored convention for local resources in composition HTML, for example `scenes/example/assets/shape.svg`. This is a convention requiring validation, not an unconditional HyperFrames guarantee. External CSS, SVG and JavaScript references retain their existing file-relative behavior.
- Diagnostics identify the actual source file and scene/composition ID. Disposable preview views must omit referenced scene definitions, scene READMEs and other scene documentation while retaining HTML and runtime assets at their resolved paths. Refresh must remove any stale copies of those authoring inputs. The current recursive copying in [scene preparation](../../src/scene-project.ts) does not meet this requirement for a new `scenes/` directory.

HyperFrames 0.8.142's preview bundler and render compiler use `rewriteAssetPath` with an `assetExists` callback. For a plain relative resource reference inside a nested composition, they prefer an existing sibling path `<composition-directory>/<reference>` and otherwise retain the root-relative reference. Parent-relative `../` references are rebased against the composition directory. The runtime loader rebases parent-relative references but does not perform that sibling existence check; Explainery's current [dependency traversal](../../src/film-files.ts) treats HTML resources as film-root-relative. Thus `assets/logo.svg` can select different files across pipelines when both the film and scene have an `assets/logo.svg`.

For referenced films, validation must check local resource references in all nested runtime HTML, including shared layers, before assembly, dependency fingerprinting or delivery can rely on the root-relative convention. Reject parent-relative HTML resource references and any reference whose existing sibling resolution differs from its root resolution. Compare normalized resource paths without query/fragment suffixes; the error must identify the composition, original reference and competing paths. Cover resource attributes and inline/style-block CSS URLs handled by the engine, not only image `src`. Do not silently choose a file or rewrite authored URLs. A missing root resource still fails dependency validation. Referenced source paths in YAML are not runtime resource URLs and retain their distinct bases above.

These engine rules were checked in the pinned distribution: `rewriteAssetPath` in `dist/chunk-TQFG7HTI.js`, its `assetExists` callers in `dist/chunk-DPHJKWP5.js` and `dist/chunk-QGRFOOLE.js`, the parent-path fallback in `dist/hyperframe-runtime.js`, and the root-relative authoring advice in `dist/chunk-IW2CKH6A.js`. Equal resource selection across bundler, compiler and runtime loader for accepted depth-two composition paths, and path-insensitive script scoping, remain rendering-experiment requirements rather than established guarantees.

### Resolved output

[`loadStory`](../../src/validate.ts) is the single source-resolution point for both input modes. It returns the existing canonical `Story` plus explicit mode and source ownership:

```ts
interface CompositionSource {
  definition: string;
  html?: string;
}

interface ResolvedFilm {
  story: Story;
  mode: 'inline' | 'referenced';
  sources: Map<string, CompositionSource>;
}

type LoadStoryResult =
  | { value: Story; resolved: ResolvedFilm; errors: [] }
  | { value?: never; resolved?: never; errors: string[] };
```

The map has exactly one entry per composition ID, including cards. `definition` names `story.yaml` for inline entries or the owning scene file for referenced entries. `html` is absent for cards; it names `compositions/<id>.html` for inline visual entries or the resolved declared source for referenced visual entries. Both paths are normalized film-root-relative POSIX paths, with no leading slash, dot segments, query or fragment. Real paths establish containment and duplicate identity; serialization retains the normalized declared project path.

`html` is the exact attribute value assembly writes to `data-composition-src`, with ordinary HTML attribute escaping on output. Staleness compares the parsed attribute value byte-for-byte against this path; it does not accept an alternative spelling merely because it reaches the same file. On success, `value` is the same object as `resolved.story`, preserving existing consumers of `loadStory().value` without introducing a second editable model.

Assembly receives the resolved mode and source map explicitly alongside story and timing, so it stays pure and performs no filesystem resolution. Existing programmatic callers supplying only an inline `Story` retain their current behavior. Commands needing source paths, validation, dependency checks or provenance use the resolved metadata; script/timing operations consume its canonical story. A referenced mode must never be inferred from path spelling or a hidden global registry.

### Film integration and shared ownership

The authored root keeps composition hosts, shared layers, resource loading and film-wide styling. Assembly matches hosts by composition ID and, for referenced scenes, fills `data-composition-src` from the resolved visual source as well as the existing copy/timing variables. The scene declaration owns that path; a conflicting root value is stale assembly, not an alternative source. Existing inline projects keep their current assembly behavior.

Assembly must preserve host DOM order, IDs, classes, tracks, unmanaged attributes and root scripts. It does not create missing hosts, remove obsolete hosts or wrap scenes in additional timed elements. For films using referenced scene files, validation reports missing, duplicate or obsolete story hosts; non-story composition hosts must be explicit shared layers marked `data-story-span`, consistent with what the existing isolation contract retains. Removing a referenced scene requires removing its hosts rather than silently treating them as shared content. Existing inline films retain their current host-validation behavior.

Shared cards, branding, narration, subtitles and presenter resources retain their current owners. A folder's README must identify dependencies such as root-owned initial styles or scene-specific behavior in a shared renderer. A folder is not sufficient evidence that these dependencies have disappeared. This proposal adds no new dependency-manifest language or presenter API.

## Timing and transition guarantees

All commands consume the same resolved film: narration, estimate, alignment, subtitles, chapters, validation, assembly, preview, render and exports. Resolution preserves the existing scene/composition structure and a source map; authors do not maintain a second flattened story file.

`timing.json` remains the single resolved/imported timing authority. Composition IDs, starts, durations and local beat times retain their meaning; scene ranges remain derived. Source reorganization alone must not regenerate imported timing, revoice narration or introduce per-scene timing files. Later narration edits can still change alignment and require animation review, as they do today.

`hold` and `overlap` retain their current scheduling semantics, including across editorial boundaries. No additional transition-duration field is introduced. Composition code owns ordinary entrance/exit motion; the shared card layer owns card motion derived from neighboring timing. A directory move must not add fades, remove overlaps, trim outgoing preparation or restart shared media.

Existing `focus --scene`, `preview --scene`, `render --scene` and consecutive-scene selection continue to work. A single-scene preview retains its complete composition ranges and required shared context, but omits neighboring composition visuals. A consecutive-scene preview includes both contributions to their join. Boundary equivalence is assessed against that combined view and the full film, not against an isolated scene missing its neighbor.

## Validation and provenance

Validate referenced source files before producing output, with the existing schema, beat, timing and runtime guard coverage. In particular, the [composition checks](../../src/validate.ts) for file existence, matching `data-composition-id` and deferred-opacity animation must follow resolved visual paths and shared composition layers, including those retained under `compositions/`. The [label-audit hash](../../src/label-audit.ts) must likewise cover resolved visual HTML and shared layers, alongside the canonical on-screen story content. Editing a label in a scene folder must invalidate the recorded factual audit and block production preflight until re-audited. Merely resolving YAML without extending these guards is incomplete. Reject unknown fields, malformed references, invalid card/source combinations, duplicate identities, ambiguous runtime resources and unresolved hosts without falling back to stale generated output.

Production and verification records must account for referenced scene definitions and runtime dependencies, not only root files. Render reuse must become invalid when effective scene inputs change; the source resolver's behavior must also participate in adapter identity. Narration and pronunciation hashes must use the resolved canonical script, so a path-only reorganization does not itself require new audio. A move is expected to change `renderFingerprint` because source paths and dependency inputs change: the old render must not be reused as verification of the new layout. Moving sources can also invalidate path-sensitive audit or delivery receipts; those receipts need explicit revalidation, not a claim that previous hashes still describe the reorganized project. Scene READMEs remain outside runtime fingerprints. Verification receipts record evidence; they are not currently enforced as a delivery gate by themselves.

## Contracts amended on acceptance

Acceptance requires a new ADR recording the source-format and resolution decision and linking the superseded portions below. Existing ADRs retain their historical rationale; they must not be presented as unconditionally describing the new format.

| Existing contract | Required amendment |
| --- | --- |
| [ADR 0003](../adr/0003-editorial-scenes.md) | Preserve scene identity, focus and timing semantics, but limit its unchanged composition-file-path convention to inline films. |
| [Story schema](../../schemas/story.schema.json) and [types](../../src/types.ts) | Add the referenced source format and resolved metadata; retain ID-to-`compositions/<id>.html` meaning for inline entries only. Describe `overlap` as a scheduling interval, not automatic visual crossfade. |
| [Authoring guide](../authoring.md#author-one-scene-at-a-time) | Update module paths, source ownership, scene descriptions and root integration for both modes; require the referenced scene's README by convention. |
| [Assembly](../../src/assemble.ts) | For referenced films only, manage resolved source attributes and the stricter host contract, using explicit resolution metadata. |
| [Dependency traversal](../../src/film-files.ts), [scene preparation](../../src/scene-project.ts) and [production provenance](../adr/0009-production-provenance.md) | Enforce unambiguous resource paths for referenced films, exclude authoring inputs from disposable views, and cover referenced source files in audits and provenance. |

The sibling-resolution mismatch is also a pre-existing issue for inline projects with sibling asset directories. The inaccurate overlap wording and the difference between full-film retention and isolated removal of obsolete inline hosts are separate existing issues. This proposal does not fix those runtime behaviors or silently tighten inline validation; resolving them needs separately scoped changes.

## Optional and excluded

Optional: scene-specific asset folders and additional linked evidence documents. Shared assets need not be copied into each scene.

Excluded: automatic root-host generation, scene host fragments, nested scene clocks, a new transition engine, scene-local voice/timing pipelines, per-scene rendered-video concatenation, automatic HTML URL rewriting, cross-film scene packages, repeated scene instances, a migration command and changes to existing film content. Those are separate contracts, not prerequisites for scene-owned source folders.

## Acceptance criteria

- Existing inline projects retain their current loading, validation, assembly and delivery behavior. Equivalent folder-based inputs resolve to the same composition identities, order, copy, narration and timing.
- Ordinary content edits are made in the owning scene folder; changing scene order or shared settings is a film edit, and adding/removing visual compositions still requires root integration. Errors point back to the correct authored file.
- Before comparing frames for a pure source move, establish deterministic equivalence: assembled `index.html` differs only in the intended `data-composition-src` attribute values; `timing.json`, audio files, chapter metadata and subtitle sidecars are byte-identical; `narrationHash` and `voiceInputHash` are unchanged. A fixture needing authored asset-URL corrections is not a pure move and must account for those edits separately rather than weakening this oracle.
- Reorganization preserves host ordering, shared layers, actual audio offsets and the effective runtime dependency closure, allowing for relocated paths. `renderFingerprint` changes after the move and the previous cached render is not reused.
- A referenced-film fixture containing conflicting root and sibling assets in nested compositions fails validation with both paths reported. Accepted fixtures select identical resource bytes in bundled preview, render compiler output and runtime-loaded playback. Exercise resource attributes and CSS URLs as well as depth-two script scoping.
- Editing a referenced HTML label invalidates the label audit and fails production preflight; changes in shared layers remain covered too. Missing visual files, mismatched composition IDs and deferred-opacity violations are detected outside the old flat directory.
- Disposable preview views contain runtime HTML/assets but no referenced scene definitions, READMEs or scene documentation, including after refreshing a view that previously contained stale copies.
- Before/after comparisons cover settled scene frames and every join: immediately before the boundary, during each overlap, and after the outgoing composition ends. Include cuts, internal overlaps, cross-scene overlaps and recap-over-held-diagram behavior. Use the same renderer/settings and a declared pixel tolerance; file relocation alone must not alter the rendered result.
- Direct, forward and backward seeks agree. Check isolated scenes, adjacent scenes and full-film playback, including shared cards and retained presenters. Rendered video and offline HTML must also preserve media playback and resource loading; snapshots alone are insufficient.
- Changing a referenced definition or visual invalidates the appropriate validation/provenance/cache result. Preserved script and audio do not trigger synthesis merely because source files moved.

## Review request

Review this as a proposed source contract, not an implemented feature. Start with [ADR 0003](../adr/0003-editorial-scenes.md), [assembly](../../src/assemble.ts), [scene preparation](../../src/scene-project.ts), [resource resolution](../../src/film-files.ts) and [production provenance](../adr/0009-production-provenance.md).

The recommendation is to accept scene-owned content with authored film integration, preserve root-relative HTML URLs, and retain one timing authority. Report any existing transition, shared-layer behavior or source workflow this contract cannot represent; distinguish a required correction from an optional expansion. Approval of this proposal would not establish that a migration has passed the acceptance criteria.
