import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { transcribe } from '../src/hyperframes.ts';
import { core, fixtureProject } from './support/fixture.ts';

// These tests prove what only HyperFrames can: per-instance variables reach a scene through its scoped
// getVariables(), a scene error fails `hyperframes check`, and the theme and components resolve through the
// node_modules link. Each fixture links this checkout exactly as a project does.
const cli = join(core, 'node_modules/hyperframes/dist/cli.js');
const run = promisify(execFile);

const hyperframes = (dir: string, ...args: string[]) => run(process.execPath, [cli, ...args], { cwd: dir, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
const snapshot = (dir: string, ...args: string[]) => hyperframes(dir, 'snapshot', '--no-end', '--no-browser-gpu', '--describe', 'false', '--output', join(dir, 'out'), ...args);

async function pixel(png: string, x: number, y: number) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', png, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' });
  return [...stdout];
}

test('a scene tween starts at the beat its host passes in', { timeout: 150000 }, async () => {
  const dir = await fixtureProject('scene-runtime');
  await snapshot(dir, '--at', '0.5,1.5');
  assert.deepEqual(await pixel(join(dir, 'out/frame-00-at-0.5s.png'), 320, 300), [0, 0, 0]);
  assert.deepEqual(await pixel(join(dir, 'out/frame-01-at-1.5s.png'), 320, 300), [255, 0, 0]);
});

test('copy the story leaves out is removed from the scene', { timeout: 150000 }, async () => {
  const dir = await fixtureProject('scene-runtime');
  await snapshot(dir, '--at', '0.5', '--zoom', '#probe-headline');
  await assert.rejects(snapshot(dir, '--at', '0.5', '--zoom', '#probe-support'), /probe-support/);
});

test('a scene that overruns its duration fails hyperframes check', { timeout: 150000 }, async () => {
  const dir = await fixtureProject('scene-runtime', html => html.replace('"duration":2', '"duration":1'));
  await assert.rejects(
    hyperframes(dir, 'check', '--no-browser-gpu', '--no-contrast', '--samples', '2'),
    (error: { code: number; stdout: string }) => error.code === 1 && error.stdout.includes('scene "probe" timeline ends at 1.01s, after its 1s'),
  );
});

test('the dark theme styles a project through the linked package', { timeout: 150000 }, async () => {
  const dir = await fixtureProject('dark-theme');
  await snapshot(dir, '--at', '0.5');
  const frame = join(dir, 'out/frame-00-at-0.5s.png');
  assert.deepEqual(await pixel(frame, 130, 788), [0xa9, 0xbf, 0xdc], 'accent rule takes --accent');
  assert.deepEqual(await pixel(frame, 626, 215), [0xc5, 0xd9, 0xf0], 'cube top face takes --cube-top from the theme');
  await hyperframes(dir, 'check', '--no-browser-gpu', '--no-contrast', '--samples', '2');
});

// Roadmap rows are 44px from y=330 on a chapter card; the current row carries a 5px accent bar at its left edge,
// so one pixel shows which scene it marks. An agenda card marks none: its first row starts below the headline.
test('the card layer covers the scenes only while a card shows, and a chapter card marks its scene', { timeout: 150000 }, async () => {
  const dir = await fixtureProject('cards');
  await snapshot(dir, '--at', '0.5,2,3.9,5.5');
  const at = (index: number, time: string, x: number, y: number) => pixel(join(dir, `out/frame-0${index}-at-${time}s.png`), x, y);
  assert.deepEqual(await at(0, '0.5', 960, 1060), [0, 255, 0], 'the scene shows before the first card');
  assert.notDeepEqual(await at(1, '2', 112, 370), [0xa9, 0xbf, 0xdc], 'the agenda marks no scene');
  assert.notDeepEqual(await at(1, '2', 960, 1060), [0, 255, 0], 'the agenda covers the scene');
  assert.deepEqual(await at(2, '3.9', 960, 1060), [0, 255, 0], 'the scene shows between cards');
  assert.deepEqual(await at(3, '5.5', 1292, 396), [0xa9, 0xbf, 0xdc], 'the chapter card marks the second scene');
  assert.notDeepEqual(await at(3, '5.5', 960, 1060), [0, 255, 0], 'the chapter card covers the scene');
  // Strict, because a card covering scene text is intended layering, not a layout warning.
  await hyperframes(dir, 'check', '--no-browser-gpu', '--no-contrast', '--samples', '8', '--strict');
});

async function videoPixel(video: string, at: number, x: number, y: number) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', video, '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' });
  return [...stdout];
}

// Video encoding shifts colours a little, so rendered pixels are compared within a tolerance.
const near = (actual: number[], expected: number[], label: string) => assert.ok(actual.every((channel, index) => Math.abs(channel - expected[index]) <= 40), `${label}: ${actual} is not near ${expected}`);

// Snapshots and MP4 renders take different paths through HyperFrames 0.8.142, and a deferred fromTo's opacity
// from-state is lost only in renders, so the motion helpers are proven on a rendered video. The deferred line is a
// characterization: when an upgrade draws it, the validate rule against that form can be relaxed.
test('motion helpers render in an MP4, while a deferred opacity from-state is lost there', { timeout: 300000 }, async () => {
  const dir = await fixtureProject('motion');
  const video = join(dir, 'out.mp4');
  await hyperframes(dir, 'render', '--output', video, '--workers', '1', '--no-browser-gpu');
  near(await videoPixel(video, 1, 330, 300), [255, 255, 0], 'travel carries the token halfway');
  near(await videoPixel(video, 1, 600, 30), [0, 0, 0], 'the arrowhead waits while its line is drawn');
  near(await videoPixel(video, 1.9, 600, 30), [255, 0, 255], 'the arrowhead joins the drawn line');
  near(await videoPixel(video, 1, 230, 190), [77, 77, 77], 'focus dims the other wrapper');
  near(await videoPixel(video, 1, 330, 190), [255, 255, 255], 'focus keeps the kept element');
  near(await videoPixel(video, 1.9, 320, 60), [255, 0, 0], 'draw strokes the line');
  near(await videoPixel(video, 1.9, 70, 190), [0, 0, 255], 'rise settles the box');
  near(await videoPixel(video, 1.9, 230, 190), [255, 255, 255], 'focus restores the wrapper');
  near(await videoPixel(video, 1.9, 320, 120), [0, 0, 0], 'the deferred opacity from-state stays lost in the render');
  await snapshot(dir, '--at', '1.9');
  near(await pixel(join(dir, 'out/frame-00-at-1.9s.png'), 320, 120), [0, 255, 0], 'while a snapshot draws the deferred line');
});

test('transcription removes its temporary folder, even when HyperFrames fails', { timeout: 60000 }, async () => {
  const leftovers = async () => (await readdir(tmpdir())).filter(name => name.startsWith('explainery-transcript-')).sort();
  const before = await leftovers();
  await assert.rejects(transcribe(core, 'missing.wav'));
  assert.deepEqual(await leftovers(), before);
});
