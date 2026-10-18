import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { narrationBeats, validateProject, validateStoryTiming, type Composition, type Story, type Timing } from '../src/index.ts';

const scene = (id: string, narration: string): Composition => ({ id, copy: { headline: id }, narration });
const story = (...scenes: Composition[]): Story => ({ id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, scenes });
const consistent = (): { story: Story; timing: Timing } => ({
  story: story(scene('first', 'Publish {publish} then pull {pull}.'), scene('second', 'Grow {grow}.')),
  timing: {
    source: 'imported',
    duration: 16,
    scenes: {
      first: { start: 0, duration: 8.9, beats: { publish: 2.45, pull: 4.5 } },
      second: { start: 8.2, duration: 7.8, beats: { grow: 2.2 } },
    },
  },
});

test('narration markers yield beat ids in spoken order', () => {
  assert.deepEqual(narrationBeats('Publish it {publish-book} and borrow it {borrow-books}.'), { beats: ['publish-book', 'borrow-books'], errors: [] });
});

test('malformed and repeated markers are reported', () => {
  assert.deepEqual(narrationBeats('A {Bad Marker} b {x} c {x}').errors, ['malformed beat marker "{Bad Marker}"', 'beat "x" is marked twice']);
});

test('a consistent story and timing produce no errors', () => {
  const { story, timing } = consistent();
  assert.deepEqual(validateStoryTiming(story, timing), []);
});

test('beats out of narration order fail', () => {
  const { story, timing } = consistent();
  timing.scenes.first.beats = { publish: 4.5, pull: 2.45 };
  assert.deepEqual(validateStoryTiming(story, timing), ['timing.json scene "first": beat "pull" at 2.45s comes before "publish" at 4.5s, but the narration marks it after']);
});

test('a beat after the end of its scene fails', () => {
  const { story, timing } = consistent();
  timing.scenes.second.beats.grow = 8;
  assert.deepEqual(validateStoryTiming(story, timing), ['timing.json scene "second": beat "grow" at 8s lies after the scene\'s 7.8s']);
});

test('timing and narration must name the same beats', () => {
  const { story, timing } = consistent();
  timing.scenes.first.beats = { publish: 2.45, push: 4.5 };
  assert.deepEqual(validateStoryTiming(story, timing), [
    'timing.json scene "first": no time for beat "pull"',
    'timing.json scene "first": beat "push" is not marked in the narration',
  ]);
});

test('timing and story must name the same scenes', () => {
  const { story, timing } = consistent();
  timing.scenes.third = timing.scenes.second;
  delete timing.scenes.second;
  assert.deepEqual(validateStoryTiming(story, timing), ['timing.json: no timing for scene "second"', 'timing.json: scene "third" is not in the story']);
});

test('scenes must start in story order and end within the story', () => {
  const { story, timing } = consistent();
  timing.scenes.second.start = 9;
  timing.scenes.first.start = 9.5;
  assert.deepEqual(validateStoryTiming(story, timing), [
    'timing.json scene "first": ends at 18.4s, after the story\'s 16s',
    'timing.json scene "second": ends at 16.8s, after the story\'s 16s',
    'timing.json scene "second": starts at 9s, before the preceding scene "first" at 9.5s',
  ]);
});

test('a scene id used twice fails', () => {
  const { timing } = consistent();
  assert.deepEqual(validateStoryTiming(story(scene('first', 'Publish {publish} then pull {pull}.'), scene('first', 'Again.')), timing).slice(0, 1), ['story.yaml: scene id "first" is used twice']);
});

async function project({ storyYaml, timingJson, compositions }: { storyYaml: string; timingJson?: string; compositions: Record<string, string> }) {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-validate-'));
  await mkdir(join(dir, 'compositions'));
  await writeFile(join(dir, 'story.yaml'), storyYaml);
  if (timingJson !== undefined) await writeFile(join(dir, 'timing.json'), timingJson);
  for (const [id, html] of Object.entries(compositions)) await writeFile(join(dir, 'compositions', `${id}.html`), html);
  return dir;
}

const storyYaml = `id: demo
title: Demo
theme: dark
canvas: { width: 1920, height: 1080, fps: 30 }
scenes:
  - id: intro
    copy: { headline: Hello }
    narration: Say hello {wave}.
`;
const timingJson = JSON.stringify({ source: 'estimate', duration: 2, scenes: { intro: { start: 0, duration: 2, beats: { wave: 0.8 } } } });
const introHtml = '<template><div data-composition-id="intro"></div></template>';

test('a project with matching files and compositions validates', async () => {
  assert.deepEqual((await validateProject(await project({ storyYaml, timingJson, compositions: { intro: introHtml } }))).errors, []);
});

test('an editorial scene validates its composition files without requiring a scene file or timing', async () => {
  const { story: flat, timing } = consistent();
  const grouped: Story = { ...flat, scenes: [{ id: 'chapter', title: 'A chapter', compositions: flat.scenes as Composition[] }] };
  const dir = await project({ storyYaml: JSON.stringify(grouped), timingJson: JSON.stringify(timing), compositions: {
    first: '<template><div data-composition-id="first"></div></template>',
    second: '<template><div data-composition-id="second"></div></template>',
  } });
  assert.deepEqual((await validateProject(dir)).errors, []);
});

test('a scene whose composition is missing or mislabelled fails', async () => {
  assert.deepEqual((await validateProject(await project({ storyYaml, timingJson, compositions: {} }))).errors, ['compositions/intro.html: missing']);
  const mislabelled = '<template><div data-composition-id="hello"></div></template>';
  assert.deepEqual((await validateProject(await project({ storyYaml, timingJson, compositions: { intro: mislabelled } }))).errors, ['compositions/intro.html: no element with data-composition-id="intro"']);
});

test('schema violations are reported per file and stop the semantic checks', async () => {
  const errors = (await validateProject(await project({ storyYaml: storyYaml.replace('theme: dark', 'theme: Dark'), timingJson: '{ "source": "estimate" }', compositions: { intro: introHtml } }))).errors;
  assert.deepEqual(errors, [
    'story.yaml /theme: must match pattern "^[a-z0-9]+(-[a-z0-9]+)*$"',
    "timing.json /: must have required property 'duration'",
    "timing.json /: must have required property 'scenes'",
  ]);
});

test('unreadable files are reported rather than thrown', async () => {
  const errors = (await validateProject(await project({ storyYaml: 'id: [unclosed', timingJson: undefined, compositions: {} }))).errors;
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^story\.yaml: /);
  assert.match(errors[1], /^timing\.json: /);
});

test('the validate command exits non-zero and prints each error', async () => {
  const dir = await project({ storyYaml, timingJson, compositions: {} });
  const run = promisify(execFile);
  const cli = new URL('../bin/explainery.ts', import.meta.url).pathname;
  await assert.rejects(run(process.execPath, [cli, 'validate', dir]), (error: { code: number; stderr: string }) => error.code === 1 && error.stderr.includes('compositions/intro.html: missing'));
  await writeFile(join(dir, 'compositions', 'intro.html'), introHtml);
  const { stdout } = await run(process.execPath, [cli, 'validate', dir]);
  assert.match(stdout, /1 scene/);
});

// Locks the render-only defect documented on deferredReveals in src/validate.ts. Transform- or dash-only deferred fromTo
// calls render correctly, so they stay allowed.
test('a deferred fromTo that sets opacity in its from-state fails, because renders ignore it', async () => {
  const html = (script: string) => `<template><div data-composition-id="intro"></div><script>${script}</script></template>`;
  const reveal = `const draw = (target, at) => tl.fromTo(target, { opacity: 1, strokeDashoffset: (i, line) => line.getTotalLength() }, { strokeDashoffset: 0, duration: .6, immediateRender: false }, at);
  tl.fromTo('#a', { autoAlpha: 1, x: 0 }, { x: 40, immediateRender: false }, 2);`;
  assert.deepEqual((await validateProject(await project({ storyYaml, timingJson, compositions: { intro: html(reveal) } }))).errors, [
    'compositions/intro.html:1: a deferred fromTo (immediateRender: false) sets opacity in its from-state, which HyperFrames renders ignore; set it with tl.set at the tween start instead',
    'compositions/intro.html:2: a deferred fromTo (immediateRender: false) sets autoAlpha in its from-state, which HyperFrames renders ignore; set it with tl.set at the tween start instead',
  ]);
  const spread = `const later = { immediateRender: false };
  tl.fromTo('#a', { opacity: 0 }, { opacity: 1, ...later }, 2);`;
  assert.deepEqual((await validateProject(await project({ storyYaml, timingJson, compositions: { intro: html(spread) } }))).errors, [
    'compositions/intro.html:2: a deferred fromTo (immediateRender: false) sets opacity in its from-state, which HyperFrames renders ignore; set it with tl.set at the tween start instead',
  ]);
  const allowed = `tl.fromTo('#a', { x: 0 }, { x: 40, immediateRender: false }, 2);
  tl.fromTo('#b', { opacity: 0 }, { opacity: 1 }, 1);`;
  assert.deepEqual((await validateProject(await project({ storyYaml, timingJson, compositions: { intro: html(allowed) } }))).errors, []);
});
