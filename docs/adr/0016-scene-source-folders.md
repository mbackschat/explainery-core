# 0016 Scene source folders

Accepted on 5 November 2026. The reviewed [source-folder contract](../proposals/scene-source-folders.md) defines input and resolved types, path rules and the compatibility boundary.

## Decision

A film may keep its existing inline scenes or reference one source file per editorial scene. Referenced scenes own their definitions, narration, copy, visual HTML and authoring README in one folder. The film retains shared settings, authored root hosts and resolved/imported timing. Mixing inline entries and references is rejected.

`loadStory` resolves both formats into the existing canonical story plus explicit mode and composition source metadata. Composition IDs remain global within the film; paths are explicit for referenced sources. This refines the unchanged-path convention in [ADR 0003](0003-editorial-scenes.md) for referenced films only. There is no new animation runtime, scene wrapper or timing clock. Assembly fills existing hosts with resolved HTML paths and existing variables while retaining authored stacking and ordering. Adding or removing a visual composition still requires film integration.

Film-root-relative resource URLs remain the authored HTML convention, enforced for referenced projects by rejecting parent-relative references and sibling-path ambiguity. HyperFrames 0.8.142's bundler/compiler can prefer sibling assets while runtime loading does not; the guard prevents disagreement with dependency traversal and render fingerprints. External CSS, SVG and JavaScript retain file-relative dependencies.

Source metadata participates in validation, label audits, verification and production fingerprints. Disposable scene views copy runtime files but omit scene definitions and documentation. Readmes explain intent and shared dependencies; they are an authoring convention, not a render prerequisite.

## Compatibility and verification

Inline projects retain their existing layout and host behavior. Their pre-existing sibling-asset resolution and obsolete-host issues are not silently changed by this decision. `overlap` describes scheduling; ordinary visual transitions remain authored in compositions, while the shared card layer derives fades from adjacent timing.

A path-only reorganization preserves the canonical script, audio, timing, chapters and subtitles. Root assembly changes only declared source attributes. Source paths change the render fingerprint, so equivalence is established by fresh rendering rather than reusing the previous delivery. Tests cover negative audit/cache cases, asset resolution in all three engine paths, seek determinism and overlapping joins. The [acceptance criteria](../proposals/scene-source-folders.md#acceptance-criteria) distinguish deterministic checks from rendered evidence.
