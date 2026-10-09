# 0004 Shared authoring skills

Decided on 9 October 2026. Supersedes the per-project skill installation in [ADR 0001](0001-explainery-architecture.md#naming-and-repositories).

## Decision

Store HyperFrames skill bundles once in core's [.agents/skills/](../../.agents/skills/) with one [skills-lock.json](../../skills-lock.json). Expose that directory to Claude Code through `.claude/skills -> ../.agents/skills`. Story repositories contain no skill copies or lock files.

Keep sessions in the story being authored. Claude Code loads core's skills through `--add-dir ../explainery-core` or `/add-dir` (superseded by the amendment below); Codex follows explicit links in the story's repository instructions because sibling skill directories are outside its automatic discovery path. The [README](../../README.md#shared-authoring-skills) owns the launch instructions and upstream references.

## Rationale and consequences

The skills describe the common rendering engine, so copying them into every story duplicates maintenance and permits version drift. Core owns their shared snapshot and provenance; updates are deliberate framework changes reviewed against the pinned CLI. The initial move preserves the existing bundles byte for byte.

Story instructions continue to own scene selection, source evidence, and the film contract. Upstream skills supply engine guidance; their scaffolding and upgrade suggestions do not override Explainery's modular authoring workflow. Shared helper resources resolve from the skill directory while project commands run from the story root. No installer hook is needed; the amendment below adds the one per-story discovery link.

## Amendment: a discovery link in each story

Amended on 9 October 2026. Requiring `--add-dir` proved unreliable: a session started without it silently ran without the skills. Each story now tracks one relative link, `.claude/skills -> ../../explainery-core/.agents/skills`, which Claude Code loads as project skills. Neither a `permissions.additionalDirectories` setting nor a link in the folder above the story loads them (checked on 9 October 2026). The link duplicates nothing, so the rationale above still holds, and it cannot dangle where the story works at all, because the story already requires core as its sibling. Codex keeps the explicit links in story instructions.
