import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { youtubeText } from '../src/youtube.ts';
import type { Story, Timing } from '../src/types.ts';

const story: Story = {
  id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: ['Opening', 'Middle', 'Closing'].map((title, index) => ({ id: `s${index}`, title, compositions: [{ id: `c${index}`, copy: { headline: title }, narration: 'An example.' }] })),
};
const timing: Timing = { source: 'aligned', duration: 72, scenes: {
  c0: { start: 0, duration: 27.136, beats: {} },
  c1: { start: 27.136, duration: 33.9, beats: {} },
  c2: { start: 61.036, duration: 10.964, beats: {} },
} };
const metadata = { title: 'A useful introduction', description: 'Overview.\n\nChapters\n{chapters}\n\nEnglish narration.' };

test('YouTube text derives editorial chapters from timing and preserves authored copy', () => {
  const result = youtubeText(story, timing, metadata);
  assert.equal(result.title, metadata.title);
  assert.equal(result.description, 'Overview.\n\nChapters\n00:00 Opening\n00:27 Middle\n01:01 Closing\n\nEnglish narration.');
  const changed = structuredClone(timing);
  changed.scenes.c1.start = 30;
  assert.match(youtubeText(story, changed, metadata).description, /00:30 Middle/);
  assert.equal(metadata.description.includes('{chapters}'), true);
});

test('YouTube timestamps support hour-long films', () => {
  const long = structuredClone(timing);
  long.scenes.c2.start = 3661.8;
  long.scenes.c2.duration = 20;
  long.duration = 3681.8;
  assert.match(youtubeText(story, long, metadata).description, /1:01:01 Closing/);
});

test('YouTube export rejects invalid copy and ineligible chapter lists', () => {
  for (const input of [null, {}, { ...metadata, title: 'x'.repeat(101) }, { ...metadata, title: 'Two\nlines' }, { ...metadata, description: 'é'.repeat(2501) }, { ...metadata, description: '<tag>' }, { ...metadata, description: '{chapters}\n{chapters}' }]) {
    assert.throws(() => youtubeText(story, timing, input));
  }
  const short = structuredClone(timing);
  short.duration = 65;
  assert.throws(() => youtubeText(story, short, metadata), /10 seconds/);
  const two = { ...story, scenes: story.scenes.slice(0, 2) };
  assert.throws(() => youtubeText(two, timing, metadata), /three/);
  assert.equal(youtubeText(two, timing, { ...metadata, description: 'No chapter list.' }).description, 'No chapter list.');
  assert.throws(() => youtubeText(story, { ...timing, source: 'estimate' }, metadata), /aligned or imported/);
});

test('YouTube CLI writes copy-ready files without modifying source metadata or rendering', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'explainery-youtube-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const project = join(cwd, 'film');
  await mkdir(join(project, 'compositions'), { recursive: true });
  await writeFile(join(project, 'story.yaml'), JSON.stringify(story));
  await writeFile(join(project, 'timing.json'), JSON.stringify(timing));
  for (const id of Object.keys(timing.scenes)) await writeFile(join(project, 'compositions', `${id}.html`), `<template><div data-composition-id="${id}"></div></template>`);
  const source = JSON.stringify({ ...metadata, privacyStatus: 'unlisted' });
  await writeFile(join(cwd, 'youtube.json'), source);
  const cli = fileURLToPath(new URL('../bin/explainery.ts', import.meta.url));
  const run = spawnSync(process.execPath, [cli, 'youtube', 'film', '--metadata', 'youtube.json', '--out', 'renders/youtube'], { cwd, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(await readFile(join(cwd, 'renders/youtube-title.txt'), 'utf8'), metadata.title + '\n');
  assert.match(await readFile(join(cwd, 'renders/youtube-description.txt'), 'utf8'), /00:27 Middle/);
  assert.equal(await readFile(join(cwd, 'youtube.json'), 'utf8'), source);
});
