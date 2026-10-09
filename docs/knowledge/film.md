---
type: Domain Concept
title: Film
description: The complete story, with ordered editorial scenes and a shared playback clock.
---
# Film

A film is the complete explainer. It has an identity, title, theme, canvas dimensions and frame rate, an ordered collection of editorial scenes, and a global playback clock. Its [scenes](scene.md) carry the narrative; global shared layers carry recurring visuals or continuous audio.

The authored representation remains `story.yaml`. Its `scenes` entries describe editorial scenes through the [authoring contract](authoring.md). `timing.json` places their compositions on the film clock; the root `index.html` assembles those modules and shared layers. The film can produce a video or an explainer page from the same source.

The project directory contains the film’s authored files and runtime assets. It is the directory passed to authoring commands, whether it is a repository root or a film subdirectory. See the [assembler](../../src/assemble.ts), [file traversal](../../src/film-files.ts), and [exporter](../../src/explainer.ts) for the current file contracts.
