# Repository Guidelines

## Project Structure & Module Organization

`explainery-core` is the open-source Explainery framework: visual storytelling on HyperFrames, with themes. It is one plain package (`explainery-core`, Apache-2.0) that projects consume as `"explainery-core": "link:../explainery-core"`. Read the [architecture decisions](docs/adr/0001-explainery-architecture.md) before changing contracts; record new decisions as further ADRs in `docs/adr/`.

Keep this repository independent of any client or product: no client logo, brand colours, artwork, narration, or copy. Those belong in a project's theme overlay or assets.

Projects live in their own repositories next to this checkout; no pnpm workspace spans them. Change framework code here, never through a project's `node_modules/explainery-core` symlink, and start agent sessions inside the repository you are changing so its own `CLAUDE.md` and HyperFrames skills apply. GSAP stays a peer dependency and is never vendored, because its standard licence is not OSI-approved and an Apache-2.0 repository must not redistribute it. Render only locally with the HyperFrames CLI; no paid cloud rendering or generated-media services.

## Build, Test, and Development Commands

- `pnpm install`: install the pinned dependencies. Projects resolve this package's dependencies through the `link:` symlink, so this checkout needs its own install.
- `pnpm test`: type-check with `tsc` (both the Node project and `runtime/`), then run all tests with `node --test`. The HyperFrames fixture tests need FFmpeg and use the browser HyperFrames manages; the SVG guard needs `xmllint`.
- `pnpm build:runtime`: regenerate `runtime/scene.js` from `runtime/scene.ts`; commit both. A test fails while they disagree.

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
