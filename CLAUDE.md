# Repository Guidelines

## Start with the task

- **Framework, CLI, or player:** start with the [implementation and guard map](#find-the-implementation-and-its-guard). Read design decisions when changing contracts; load composition skills or inspect scene focus only if authored scenes are involved.
- **Scene or narration:** work in the story repository and follow [editorial scenes and session focus](#editorial-scenes-and-session-focus), then load the composition skills needed for that task.
- **Research or proposal:** follow the [research and review guidance](docs/authoring.md#research-and-review-a-film-proposal); planning can cover the whole film.
- **Documentation:** inspect the owning source and relevant links; code tests, scene setup, and renders are unnecessary for prose-only changes.

## Project Structure & Module Organization

`explainery-core` is the open-source Explainery framework: visual storytelling on HyperFrames, with themes. It is one plain package (`explainery-core`, Apache-2.0) that projects consume as `"explainery-core": "link:../explainery-core"`. Read the [architecture decisions](docs/adr/0001-explainery-architecture.md) before changing contracts; record new decisions as further ADRs in `docs/adr/`.

Keep this repository independent of any client or product: no client logo, brand colours, artwork, narration, or copy. Those belong in a project's theme overlay or assets.

Projects live in their own repositories next to this checkout; no pnpm workspace spans them. Change framework code here, never through a project's `node_modules/explainery-core` symlink, and start agent sessions inside the repository you are changing so its own `CLAUDE.md` applies; load the shared skills as described below. GSAP stays a peer dependency and is never vendored, because its standard licence is not OSI-approved and an Apache-2.0 repository must not redistribute it. Render only locally with the HyperFrames CLI; no paid cloud rendering or generated-media services.

## Shared HyperFrames skills

Before authoring compositions, read the [HyperFrames entry skill](.agents/skills/hyperframes/SKILL.md), then use the [scene task-to-skill guide and integration rules](docs/authoring.md#use-hyperframes-skills-in-scene-work) to select and apply the relevant domain skills. Read `hyperframes-core` before writing composition HTML; adapt animation recipes into the timeline supplied by `defineScene`. This repository owns the canonical [.agents/skills](.agents/skills/) bundles and [skills-lock.json](skills-lock.json); `.claude/skills` is a directory symlink to the same bundles. A story carries only the relative link `.claude/skills -> ../../explainery-core/.agents/skills`; keep skill copies, other skill links, and lock files out of story repositories. Follow the [shared skill setup](README.md#shared-authoring-skills) for discovery from a story session.

Explainery's scene focus, file ownership, and assembly contracts remain authoritative, and so does the local-only rule above: the upstream bundles also describe HyperFrames cloud rendering and paid generation services (for example the HeyGen and Gemini scripts in `media-use`), which Explainery never uses. Use the project's pinned CLI; do not apply generic scaffolding or automatic upgrades during scene work. Resolve skill resources relative to the shared skill directory and run project commands from the story root. Keep upstream bundles unchanged except in a deliberate skill update, with their provenance lock updated together.

## Find the implementation and its guard

Read the [README workflow](README.md#the-workflow-at-a-glance) for authoring commands. Use the current schemas, source, and tests to verify implemented behaviour; the ADRs also record design goals and migration history.

| Change | Source | Guard |
| --- | --- | --- |
| Story or timing contract | [schemas](schemas/), [types](src/types.ts), [story model](src/story.ts), [validator](src/validate.ts) | [schema tests](tests/schemas.test.ts), [story tests](tests/story.test.ts), [validation tests](tests/validate.test.ts) |
| Narration or timing generation | [narration](src/narration.ts), [estimate](src/estimate.ts), [alignment](src/align.ts), [HyperFrames adapter](src/hyperframes.ts) | [narration tests](tests/narration.test.ts), [estimate tests](tests/estimate.test.ts), [alignment tests](tests/align.test.ts) |
| MP4 chapter generation and refresh | [chapters](src/chapters.ts), [scene selection](src/story.ts), [CLI](bin/explainery.ts) | [chapter tests](tests/chapters.test.ts), [CLI tests](tests/scene-cli.test.ts) |
| Optional subtitle sidecars | [subtitles](src/subtitles.ts), [shared word alignment](src/align.ts) | [subtitle tests](tests/subtitles.test.ts), [alignment tests](tests/align.test.ts) |
| Root composition assembly | [assembler](src/assemble.ts) | [assembly tests](tests/assemble.test.ts) |
| Composition behaviour or theme integration | [runtime source](runtime/scene.ts), [dark theme](themes/dark/), [components](components/) | [runtime tests](tests/scene-runtime.test.ts), [build guard](tests/runtime-build.test.ts), [HyperFrames fixtures](tests/hyperframes.test.ts), [SVG guard](tests/svg.test.ts) |
| Explainer export | [page export](src/explainer.ts), [single-file export](src/explainer-file.ts), [file traversal](src/film-files.ts), [HTML subtitle input](src/export-subtitles.ts) | [subtitle input tests](tests/export-subtitles.test.ts), [export tests](tests/explainer.test.ts), [browser tests](tests/explainer-browser.test.ts), [file tests](tests/film-files.test.ts) |

Beat anchoring is an authoring convention, not a runtime restriction: compositions also use numeric starts, offsets, and tween durations. The runtime rejects missing beats and timelines longer than their composition; it does not automatically retime tweens or reflow changed copy. Do not describe replacing narration or wording as a guarantee that no composition edits are needed.

## Editorial scenes and session focus

Author one editorial scene at a time using the [modular scene workflow](docs/authoring.md#author-one-scene-at-a-time): self-contained compositions, explicit shared dependencies, authored root hosts, and verification of the scene, its joins, and the full film. Assembly fills existing hosts; it does not create them. Review shared changes in every affected scene. Keep visual intent and evidence in the story's scene descriptions, link them from its README, and keep executable copy and timing in their owning files.

Apply the [research and proposal guidance](docs/authoring.md#research-and-review-a-film-proposal) before implementation: preserve sources, evidence limits and editorial rationale in story-local notes, and prepare film proposals and scene briefs that an external reviewer can assess without chat context. Planning may cover the whole film; composition authoring remains one scene at a time. Keep decisions and unresolved questions resumable after context compaction.

Read the [scene concepts](docs/authoring.md#concepts) and [editorial scene decision](docs/adr/0003-editorial-scenes.md). A scene is the human work unit; a composition is an executable HTML module within it. `defineScene` and `timing.scenes` retain their historical names but operate on compositions. Use `storyScenes(story)` for editorial operations, `storyCompositions(story)` for narration, alignment, assembly, and composition files, and `sceneRange(scene, timing)` for the derived editorial range.

When a user says “work on <scene>”, resolve the ID or title, run `explainery focus <project-dir> --scene <name>`, and keep subsequent edits, previews, and renders within that scope. Read focus when starting scene or narration work. “Work on the full film” runs `focus --film`. Clarify ambiguous names with a recommended match; incidental mentions do not switch focus. Preview/render print and honor local focus, with `--scene`/`--film` as one-command overrides. Edit original sources, never `.explainery/scenes/` derivatives. The disposable scene view refreshes at each preview/render invocation; only dependencies are linked. Re-run preview after any source edit, including animation, assets, styles, copy, or timing. Shared assets can affect other scenes: explain that consequence when relevant. Full-project validation, timing generation, assembly, and explainer export ignore focus.

## Build, Test, and Development Commands

- `pnpm install`: install the pinned dependencies. Projects resolve this package's dependencies through the `link:` symlink, so this checkout needs its own install.
- `pnpm test`: type-check with `tsc` (both the Node project and `runtime/`), then run all tests with `node --test`. The HyperFrames fixture tests need FFmpeg and use the browser HyperFrames manages; the SVG guard needs `xmllint`.
- `pnpm build:runtime`: regenerate `runtime/scene.js` from `runtime/scene.ts`; commit both. A test fails while they disagree.
- `pnpm typecheck`: check Node and browser TypeScript without running the browser fixtures.

The development dependency pins HyperFrames 0.8.142. Check commands against its local `pnpm exec hyperframes <command> --help` before changing examples; a peer dependency range is not evidence that every later version has been verified. Run story commands from the story directory:

```bash
pnpm exec explainery validate
pnpm exec explainery assemble --check
pnpm exec explainery preview
pnpm exec hyperframes check --no-contrast --no-browser-gpu
pnpm exec explainery render --quality delivery
pnpm exec explainery preview --stop
```

Explainery preview and render honor local focus; use `--film` to override it. Direct HyperFrames commands and the strict check always use their supplied project without consulting focus. Checks, fixture captures, and Explainery renders use software browser capture; this is separate from HyperFrames' optional `--gpu` video encoder. Local execution can still involve browser/model downloads and HyperFrames update or telemetry traffic; it does not imply an offline setup.

Standalone HTML deliveries default to `renders/<story-id>-full.html` in the working directory, alongside MP4s and subtitle sidecars. Keep generated HTML ignored in story repositories with `renders/*.html`; use `--out` for an explicit delivery filename.

## Scope

Accessibility is out of scope for the produced animations and videos: do not raise, fix, or report accessibility findings (such as WCAG contrast) on scenes, themes, or renders, and run `hyperframes check` with `--no-contrast`. Any visual editor or authoring UI that Explainery provides must still be accessible.

## Coding Style & Naming Conventions

Strict TypeScript ES modules (`.ts`) that Node runs by type stripping, so there is no build step for Node code ([ADR 0002](docs/adr/0002-typescript.md)): use only erasable syntax (no `enum`, `namespace`, or parameter properties), `import type` for type-only imports, and `.ts` extensions in relative imports. The browser runtime is the one exception: `runtime/scene.ts` compiles to the classic script `runtime/scene.js`, because HyperFrames loads it with a plain `<script>` in the host page. Inline scripts in HTML compositions and fixtures stay JavaScript. Use two-space indentation, kebab-case file names, and stable, descriptive SVG IDs. Write Markdown paragraphs on single physical lines and link related documents normally.

## Testing Guidelines

Use red/green TDD with `node:test`. Contract changes need a test that fails before the change. Behaviour that only HyperFrames can prove (variable delivery, scoping, rendering) is covered by fixture projects under `tests/fixtures/` driven through the pinned `hyperframes` CLI.

Run focused regression checks while iterating, then the relevant complete suite before completing a code change. Repeat checks only after changes, failures, or unresolved evidence justify it. For browser-specific failures, reproduce and verify in the affected engine (for example WebKit for Safari), and retain a regression guard for the mechanism. Report any engine or environment that could not be verified; a passing check in another engine is not equivalent.

## Delegation

Delegate independent, substantial subtasks or a fresh-context review when the benefit exceeds coordination and context-transfer costs. Keep short fixes, routine test commands, and small lookups in the main session. For a cold review, start a fresh agent without conversation history and provide the scope, files, and acceptance criteria; the reviewer should inspect the evidence independently.

Model tiers are symbolic (HIGH, MEDIUM, LOW). Resolve them through the tier table in your global instructions; report missing mappings or unavailable configurations rather than silently substituting. If delegation is unavailable, continue locally where possible and report that limitation. Report the model and effort used for delegated work. Contributors who want the maintainer's mapping can copy [Model tier mappings](https://github.com/mbackschat/coding-setup/blob/main/CLAUDE.md#model-tier-mappings) into their global instructions. Story repositories follow this section.

Choose the tier by what decides the outcome, not by the size of the task:

| Tier | Use when | Edits files | Examples |
| --- | --- | --- | --- |
| HIGH | The outcome is a judgment: a design, a contract, visual or editorial quality, or a root cause. | Yes | Scene design and composition authoring, schema and runtime API changes, ADRs, a fresh-context review of a design or diff, a failure that spans core and a story |
| MEDIUM | The interface and the acceptance check are already fixed; the work executes against them. | Yes, guarded by the check | Code against failing tests, refactors and renames guarded by byte-identical snapshots, docs aligned to the file that owns the facts, read-only research into HyperFrames internals |
| LOW | An oracle decides the outcome; the work runs it or looks something up. | No | Running tests, frame verification, validation, or assembly checks and reporting the verdict with failure output verbatim; inventorying references before a rename |

When a task fits two rows, choose the higher tier. Every delegated task names its oracle; a sub-agent that meets a decision its tier does not cover stops and reports it instead of deciding. Keep in the main session what needs the user or touches shared state: resolving which scene the user means, commits and pushes, and judging whether public files stay client-neutral. Scene focus is one state per checkout, so never run parallel sub-agents that focus scenes in the same story; parallel work is fine across repositories or when read-only. At most one render runs at a time, at any tier.

## Commit & Pull Request Guidelines

Follow Conventional Commits, for example `feat(runtime): anchor scene tweens to narration beats`. Add a concise rationale when the subject and diff cannot explain a decision. Commit without asking after each completed feature or meaningful checkpoint once its tests or oracle pass; never commit unverified or unrelated work. The global `F:` / `Fix:` rule takes precedence: leave small fixes for a grouped commit and propose that commit; commit a fix separately when it deserves its own coherent, independently reviewable change. Explicit requests to defer commits take precedence. Do not push without authorization. A change that also touches a project is committed separately in each repository, framework first.
