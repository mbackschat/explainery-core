# 0004 Shared authoring skills

Decided on 9 October 2026. Supersedes the per-project skill installation in [ADR 0001](0001-explainery-architecture.md#naming-and-repositories).

## Decision

Store HyperFrames skill bundles once in core's [.agents/skills/](../../.agents/skills/) with one [skills-lock.json](../../skills-lock.json). Expose that directory to Claude Code through `.claude/skills -> ../.agents/skills`. Story repositories contain no skill copies, symlinks, or lock files.

Keep sessions in the story being authored. Claude Code loads core's skills through `--add-dir ../explainery-core` or `/add-dir`; Codex follows explicit links in the story's repository instructions because sibling skill directories are outside its automatic discovery path. The [README](../../README.md#shared-authoring-skills) owns the launch instructions and upstream references.

## Rationale and consequences

The skills describe the common rendering engine, so copying them into every story duplicates maintenance and permits version drift. Core owns their shared snapshot and provenance; updates are deliberate framework changes reviewed against the pinned CLI. The initial move preserves the existing bundles byte for byte.

Story instructions continue to own scene selection, source evidence, and the film contract. Upstream skills supply engine guidance; their scaffolding and upgrade suggestions do not override Explainery's modular authoring workflow. Shared helper resources resolve from the skill directory while project commands run from the story root. No installer hook or per-story discovery link is needed.
