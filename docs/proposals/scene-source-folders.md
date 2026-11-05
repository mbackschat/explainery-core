# Scene source folders

Status: proposed for review, 5 November 2026. This changes authoring and source resolution, not the animation runtime. It extends [editorial scenes](../adr/0003-editorial-scenes.md) and the [scene authoring contract](../authoring.md#author-one-scene-at-a-time); none of the new source syntax below is implemented yet.

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

`story.yaml` owns film identity, canvas, theme, voice, pronunciation rules and ordered scene references. Each `scene.yaml` owns one scene's ID, title and ordered compositions, including their copy, narration, beat markers, hold and overlap. Its README describes purpose, evidence, visual beats, incoming/outgoing states, review criteria and shared dependencies; it links to executable sources instead of duplicating script or timing. HTML remains authored visual source. Scene-specific assets may live beside it; genuinely shared resources remain film-owned.

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
- Scene IDs and composition IDs retain their existing, separate film-wide uniqueness rules. Repeated references to the same scene are rejected; this proposal does not add reusable scene instances or rename IDs from folder names. Each referenced visual file belongs to one composition; shared implementation belongs in explicit dependencies.
- HTML runtime resource URLs continue to resolve from the film root. External CSS, SVG and JavaScript references retain their existing file-relative behavior. This follows the [runtime dependency contract](../../src/film-files.ts); relocating HTML must not silently reinterpret its URLs. A scene asset can therefore be referenced as `scenes/example/assets/shape.svg` from composition HTML.
- Diagnostics identify the actual source file and scene/composition ID. Referenced inputs must never be presented as editable generated copies.

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

Validate referenced source files before producing output, with the existing schema, beat, timing and runtime guard coverage. Checks that currently assume a flat `compositions/` directory must follow resolved composition paths and shared runtime dependencies, including the deferred-opacity render guard. Reject unknown fields, malformed references, invalid card/source combinations, duplicate identities and unresolved hosts without falling back to stale generated output.

Production and verification records must account for referenced scene definitions and runtime dependencies, not only root files. Render reuse must become invalid when effective scene inputs change. Narration and pronunciation hashes must use the resolved canonical script, so a path-only reorganization does not itself require new audio. Moving sources can invalidate path-sensitive audit or delivery receipts; those receipts need explicit revalidation, not a claim that previous hashes still describe the reorganized project. README edits do not change runtime output.

## Optional and excluded

Optional: scene-specific asset folders and additional linked evidence documents. Shared assets need not be copied into each scene.

Excluded: automatic root-host generation, scene host fragments, nested scene clocks, a new transition engine, scene-local voice/timing pipelines, per-scene rendered-video concatenation, automatic HTML URL rewriting, cross-film scene packages, repeated scene instances, a migration command and changes to existing film content. Those are separate contracts, not prerequisites for scene-owned source folders.

## Acceptance criteria

- Existing inline projects retain their current loading, validation, assembly and delivery behavior. Equivalent folder-based inputs resolve to the same composition identities, order, copy, narration and timing.
- Ordinary content edits are made in the owning scene folder; changing scene order or shared settings is a film edit, and adding/removing visual compositions still requires root integration. Errors point back to the correct authored file.
- Reorganization preserves host ordering, shared layers, actual audio bytes and offsets, chapters, subtitle timing and the effective runtime dependency closure, allowing for relocated paths.
- Before/after comparisons cover settled scene frames and every join: immediately before the boundary, during each overlap, and after the outgoing composition ends. Include cuts, internal overlaps, cross-scene overlaps and recap-over-held-diagram behavior. Use the same renderer/settings and a declared pixel tolerance; file relocation alone must not alter the rendered result.
- Direct, forward and backward seeks agree. Check isolated scenes, adjacent scenes and full-film playback, including shared cards and retained presenters. Rendered video and offline HTML must also preserve media playback and resource loading; snapshots alone are insufficient.
- Changing a referenced definition or visual invalidates the appropriate validation/provenance/cache result. Preserved script and audio do not trigger synthesis merely because source files moved.

## Review request

Review this as a proposed source contract, not an implemented feature. Start with [ADR 0003](../adr/0003-editorial-scenes.md), [assembly](../../src/assemble.ts), [scene preparation](../../src/scene-project.ts), [resource resolution](../../src/film-files.ts) and [production provenance](../adr/0009-production-provenance.md).

The recommendation is to accept scene-owned content with authored film integration, preserve root-relative HTML URLs, and retain one timing authority. Report any existing transition, shared-layer behavior or source workflow this contract cannot represent; distinguish a required correction from an optional expansion. Approval of this proposal would not establish that a migration has passed the acceptance criteria.
