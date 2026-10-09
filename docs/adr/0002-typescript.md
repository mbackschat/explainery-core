# 0002 TypeScript without a build step

Decided on 9 October 2026, when the JavaScript in `explainery-core` and its pilot project moved to TypeScript.

## Decision

- **Node code is TypeScript that Node runs directly.** Sources, the CLI, scripts, and tests are `.ts` files executed by Node's built-in type stripping (Node 22.18 or later), with no compile step. `tsc` (TypeScript 7) only type-checks, in strict mode, as the first step of `pnpm test`.
- **Only erasable syntax.** Type stripping removes annotations but cannot compile `enum`, `namespace`, or parameter properties, so `erasableSyntaxOnly` forbids them; `verbatimModuleSyntax` keeps type-only imports explicit, and relative imports name the `.ts` file.
- **The package exports its `.ts` sources.** `exports` points at `src/index.ts` and `bin` at `bin/explainery.ts`. This works for projects that consume the package through `link:`, because Node resolves the symlink to this checkout's real path. Node refuses to strip types from files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, verified on Node 24.18), so publishing to npm requires emitting JavaScript and declarations first.
- **The browser runtime is the one built file.** HyperFrames loads `runtime/scene.js` as a classic `<script>` in the host page, and browsers cannot run TypeScript. `runtime/scene.ts` is the source; `pnpm build:runtime` compiles it with its own `runtime/tsconfig.json` (DOM and GSAP types), the generated file is committed so projects need no build, and a test fails while the committed file differs from a fresh build.
- **The domain types mirror the schemas.** `Story` and `Timing` in `src/types.ts` describe schema-valid files; the JSON schemas stay the runtime contract and change first.

## Out of scope

- Inline `<script>` blocks in HTML compositions stay JavaScript, because HyperFrames executes them as they are.
- Vendored agent skills are third-party code that their installer overwrites, and stay as shipped. Their shared location is now core's [.agents/skills/](../../.agents/skills/), as decided in [ADR 0004](0004-shared-authoring-skills.md).

## Rejected alternatives

- **Type-checked JavaScript (`// @ts-check` with JSDoc) for the runtime.** It would have avoided the build step, but kept two authoring styles in one repository.
- **A bundler or `tsc` emit for all Node code.** It would add a build step to every edit and test run for no benefit while nothing is published.
