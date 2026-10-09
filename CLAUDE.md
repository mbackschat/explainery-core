# Repository Guidelines

## Author one scene at a time

Use the [modular scene authoring workflow](docs/authoring.md#author-one-scene-at-a-time) as the default for film work. A scene is the editorial work unit; its composition HTML files are the modules the film root combines.

- Resolve and persist the requested editorial scene with `focus`; keep subsequent edits, preview, and draft render within that scene until the user changes scope.
- Keep each composition self-contained: its own elements, local beat clock, and seekable timeline, with explicit shared assets and theme dependencies. It must initialize correctly without a neighboring composition having run.
- When adding a composition, declare it in the story and author its HTML file and matching root host. Update timing and run assembly; assembly fills existing hosts and does not create them.
- Before completing a scene, verify it alone and with affected neighbors, then run film-wide validation and assembly checks. Review shared changes in every affected scene; use a full-film preview to check integration.

## Project Structure & Module Organization

`explainery-core` is the open-source Explainery framework: visual storytelling on HyperFrames, with themes. It is one plain package (`explainery-core`, Apache-2.0) that projects consume as `"explainery-core": "link:../explainery-core"`. Read the [architecture decisions](docs/adr/0001-explainery-architecture.md) before changing contracts; record new decisions as further ADRs in `docs/adr/`.

Keep this repository independent of any client or product: no client logo, brand colours, artwork, narration, or copy. Those belong in a project's theme overlay or assets.

Projects live in their own repositories next to this checkout; no pnpm workspace spans them. Change framework code here, never through a project's `node_modules/explainery-core` symlink, and start agent sessions inside the repository you are changing so its own `CLAUDE.md` applies; load the shared skills as described below. GSAP stays a peer dependency and is never vendored, because its standard licence is not OSI-approved and an Apache-2.0 repository must not redistribute it. Render only locally with the HyperFrames CLI; no paid cloud rendering or generated-media services.

## Shared HyperFrames skills

Before authoring compositions, read the [HyperFrames entry skill](.agents/skills/hyperframes/SKILL.md), then use the [scene task-to-skill guide and integration rules](docs/authoring.md#use-hyperframes-skills-in-scene-work) to select and apply the relevant domain skills. Read `hyperframes-core` before writing composition HTML; adapt animation recipes into the timeline supplied by `defineScene`. This repository owns the canonical [.agents/skills](.agents/skills/) bundles and [skills-lock.json](skills-lock.json); `.claude/skills` is a directory symlink to the same bundles. Keep all skill copies, symlinks, and lock files out of story repositories. Follow the [shared skill setup](README.md#shared-authoring-skills) for discovery from a story session.

Explainery's scene focus, file ownership, and assembly contracts remain authoritative. Use the project's pinned CLI; do not apply generic scaffolding or automatic upgrades during scene work. Resolve skill resources relative to the shared skill directory and run project commands from the story root. Keep upstream bundles unchanged except in a deliberate skill update, with their provenance lock updated together.

## Find the implementation and its guard

Read the [README workflow](README.md#the-workflow-at-a-glance) for authoring commands. Use the current schemas, source, and tests to verify implemented behaviour; the ADRs also record design goals and migration history.

| Change | Source | Guard |
| --- | --- | --- |
| Story or timing contract | [schemas](schemas/), [types](src/types.ts), [story model](src/story.ts), [validator](src/validate.ts) | [schema tests](tests/schemas.test.ts), [story tests](tests/story.test.ts), [validation tests](tests/validate.test.ts) |
| Narration or timing generation | [narration](src/narration.ts), [estimate](src/estimate.ts), [alignment](src/align.ts), [HyperFrames adapter](src/hyperframes.ts) | [narration tests](tests/narration.test.ts), [estimate tests](tests/estimate.test.ts), [alignment tests](tests/align.test.ts) |
| Root composition assembly | [assembler](src/assemble.ts) | [assembly tests](tests/assemble.test.ts) |
| Composition behaviour or theme integration | [runtime source](runtime/scene.ts), [dark theme](themes/dark/), [components](components/) | [runtime tests](tests/scene-runtime.test.ts), [build guard](tests/runtime-build.test.ts), [HyperFrames fixtures](tests/hyperframes.test.ts), [SVG guard](tests/svg.test.ts) |
| Explainer export | [page export](src/explainer.ts), [single-file export](src/explainer-file.ts), [file traversal](src/film-files.ts) | [export tests](tests/explainer.test.ts), [browser tests](tests/explainer-browser.test.ts), [file tests](tests/film-files.test.ts) |

Beat anchoring is an authoring convention, not a runtime restriction: compositions also use numeric starts, offsets, and tween durations. The runtime rejects missing beats and timelines longer than their composition; it does not automatically retime tweens or reflow changed copy. Do not describe replacing narration or wording as a guarantee that no composition edits are needed.

## Editorial scenes and session focus

Use the [scene authoring guideline](docs/authoring.md) when documenting or revising a scene. Keep visual intent and evidence in the story's scene descriptions, link them from its README, and keep executable copy and timing in their owning files.

Read the [scene concepts](docs/authoring.md#concepts) and [editorial scene decision](docs/adr/0003-editorial-scenes.md). A scene is the human work unit; a composition is an executable HTML module within it. `defineScene` and `timing.scenes` retain their historical names but operate on compositions. Use `storyScenes(story)` for editorial operations, `storyCompositions(story)` for narration, alignment, assembly, and composition files, and `sceneRange(scene, timing)` for the derived editorial range.

When a user says “work on <scene>”, resolve the ID or title, run `explainery focus <project-dir> --scene <name>`, and keep subsequent edits, previews, and renders within that scope. Read focus at session start. “Work on the full film” runs `focus --film`. Clarify ambiguous names with a recommended match; incidental mentions do not switch focus. Preview/render print and honor local focus, with `--scene`/`--film` as one-command overrides. Edit original sources, never `.explainery/scenes/` derivatives. The disposable scene view refreshes at each preview/render invocation; only dependencies are linked. Re-run preview after any source edit, including animation, assets, styles, copy, or timing. Shared assets can affect other scenes: explain that consequence when relevant. Full-project validation, timing generation, assembly, and explainer export ignore focus.

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

## Scope

Accessibility is out of scope for the produced animations and videos: do not raise, fix, or report accessibility findings (such as WCAG contrast) on scenes, themes, or renders, and run `hyperframes check` with `--no-contrast`. Any visual editor or authoring UI that Explainery provides must still be accessible.

## Coding Style & Naming Conventions

Strict TypeScript ES modules (`.ts`) that Node runs by type stripping, so there is no build step for Node code ([ADR 0002](docs/adr/0002-typescript.md)): use only erasable syntax (no `enum`, `namespace`, or parameter properties), `import type` for type-only imports, and `.ts` extensions in relative imports. The browser runtime is the one exception: `runtime/scene.ts` compiles to the classic script `runtime/scene.js`, because HyperFrames loads it with a plain `<script>` in the host page. Inline scripts in HTML compositions and fixtures stay JavaScript. Use two-space indentation, kebab-case file names, and stable, descriptive SVG IDs. Write Markdown paragraphs on single physical lines and link related documents normally.

## Testing Guidelines

Use red/green TDD with `node:test`. Contract changes need a test that fails before the change. Behaviour that only HyperFrames can prove (variable delivery, scoping, rendering) is covered by fixture projects under `tests/fixtures/` driven through the pinned `hyperframes` CLI.

## Delegation

Model tiers are symbolic (HIGH, MEDIUM); resolve them through the tier table in the global instructions rather than naming models here. Use MEDIUM-tier sub-agents for bounded tasks whose interface and acceptance check are already fixed: schema and validator code against failing tests, mechanical conversions guarded by pixel-identical renders, and read-only research into HyperFrames internals. Keep contract and design decisions at HIGH. Every delegated task names its oracle; at most one render runs at a time.

## Commit & Pull Request Guidelines

Follow Conventional Commits, for example `feat(runtime): anchor scene tweens to narration beats`. Add a concise rationale when the subject and diff cannot explain a decision. Commit without asking after each completed feature and at each checkpoint once its tests or oracle pass; never commit unverified or unrelated work. Do not push without authorization. A change that also touches a project is committed separately in each repository, framework first.
