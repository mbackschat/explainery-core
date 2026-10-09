import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { checkTiming, estimateTiming, validateStoryTiming, type Scene, type Story } from '../src/index.ts';

const scene = (id: string, narration: string, extra: Partial<Scene> = {}): Scene => ({ id, copy: { headline: id }, narration, ...extra });
const story = (...scenes: Scene[]): Story => ({ id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, scenes });

test('a beat falls after the words spoken before its marker, and the scene lasts for its words plus its hold', () => {
  const timing = estimateTiming(story(scene('intro', 'One two three {wave} four five.', { hold: 0.5 })), { wordsPerSecond: 2.5 });
  assert.deepEqual(timing, { source: 'estimate', duration: 2.5, scenes: { intro: { start: 0, duration: 2.5, beats: { wave: 1.2 } } } });
});

test('scenes follow each other, and an overlap starts the next scene that much earlier', () => {
  const timing = estimateTiming(story(
    scene('first', 'One two three four five.', { overlap: 0.4 }),
    scene('second', '{grow} One two three four five six seven eight nine ten.', { hold: 1 }),
  ), { wordsPerSecond: 2.5 });
  assert.deepEqual(timing.scenes, {
    first: { start: 0, duration: 2, beats: {} },
    second: { start: 1.6, duration: 5, beats: { grow: 0 } },
  });
  assert.equal(timing.duration, 6.6);
});

test('the last scene has nothing to cross into, so its overlap is ignored', () => {
  const timing = estimateTiming(story(scene('only', 'One two three four five.', { overlap: 1 })), { wordsPerSecond: 2.5 });
  assert.equal(timing.duration, 2);
});

test('times are rounded to the millisecond', () => {
  const timing = estimateTiming(story(scene('intro', 'One two three four five six seven {end}')), { wordsPerSecond: 2.3 });
  assert.deepEqual(timing.scenes.intro, { start: 0, duration: 3.043, beats: { end: 3.043 } });
});

test('the default pace is 2.5 words per second, measured on a recorded narration', () => {
  assert.equal(estimateTiming(story(scene('intro', 'One two three four five.'))).duration, 2);
});

test('an overlap as long as its scene fails, because the next scene would start before it', () => {
  assert.throws(
    () => estimateTiming(story(scene('first', 'One two.', { overlap: 0.8 }), scene('second', 'Three.')), { wordsPerSecond: 2.5 }),
    /scene "first": overlap 0.8s is not shorter than its 0.8s/,
  );
});

test('an estimate is valid timing for its story', () => {
  const value = story(
    scene('seed', "Every garden starts small. {plant} Plant one seed, {water} water it daily, and it grows. {sprout}", { overlap: 0.7 }),
    scene('harvest', '{pick} By autumn you pick the fruit, {share} share it with neighbours, {store} store the rest, and {sow} sow again.', { hold: 0.5 }),
  );
  const timing = estimateTiming(value);
  assert.deepEqual(checkTiming(timing), []);
  assert.deepEqual(validateStoryTiming(value, timing), []);
});

const storyYaml = `id: demo
title: Demo
theme: dark
canvas: { width: 1920, height: 1080, fps: 30 }
scenes:
  - id: intro
    copy: { headline: Hello }
    narration: One two three {wave} four five.
`;

async function project(timing?: object) {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-estimate-'));
  await writeFile(join(dir, 'story.yaml'), storyYaml);
  if (timing) await writeFile(join(dir, 'timing.json'), JSON.stringify(timing));
  return dir;
}

const run = promisify(execFile);
const cli = new URL('../bin/explainery.ts', import.meta.url).pathname;

test('the estimate command writes timing.json at the given pace before any composition exists', async () => {
  const dir = await project();
  const { stdout } = await run(process.execPath, [cli, 'estimate', dir, '--wps', '2']);
  assert.match(stdout, /Estimated 1 scene, 2.5s at 2 words per second/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8')), { source: 'estimate', duration: 2.5, scenes: { intro: { start: 0, duration: 2.5, beats: { wave: 1.5 } } } });
});

test('the estimate command replaces an earlier estimate but never timing from a voice', async () => {
  const dir = await project({ source: 'estimate', duration: 9, scenes: {} });
  await run(process.execPath, [cli, 'estimate', dir]);
  assert.equal(JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8')).duration, 2);
  const aligned = { source: 'aligned', audio: 'assets/narration.wav', duration: 3, scenes: { intro: { start: 0, duration: 3, beats: { wave: 1 } } } };
  await writeFile(join(dir, 'timing.json'), JSON.stringify(aligned));
  await assert.rejects(run(process.execPath, [cli, 'estimate', dir]), (error: { code: number; stderr: string }) => error.code === 1 && error.stderr.includes('timing.json is aligned; pass --force to replace it with an estimate'));
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8')), aligned);
  await run(process.execPath, [cli, 'estimate', dir, '--force']);
  assert.equal(JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8')).source, 'estimate');
});

test('the narration command prints the spoken text without beat markers, ready for a voice', async () => {
  const dir = await project();
  const { stdout } = await run(process.execPath, [cli, 'narration', dir]);
  assert.equal(stdout, 'One two three four five.\n');
});

test('the narration command speaks the pronunciations of the story', async () => {
  const dir = await project();
  await writeFile(join(dir, 'story.yaml'), `${storyYaml}pronunciations: { three: tree }\n`);
  const { stdout } = await run(process.execPath, [cli, 'narration', dir]);
  assert.equal(stdout, 'One two tree four five.\n');
});
