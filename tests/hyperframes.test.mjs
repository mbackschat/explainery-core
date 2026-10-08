import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { core, fixtureProject } from './support/fixture.mjs';

// These tests prove what only HyperFrames can: per-instance variables reach a scene through its scoped
// getVariables(), a scene error fails `hyperframes check`, and the theme and components resolve through the
// node_modules link. Each fixture links this checkout exactly as a project does.
const cli = join(core, 'node_modules/hyperframes/dist/cli.js');
const run = promisify(execFile);

const hyperframes = (dir, ...args) => run(process.execPath, [cli, ...args], { cwd: dir, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
const snapshot = (dir, ...args) => hyperframes(dir, 'snapshot', '--no-end', '--no-browser-gpu', '--describe', 'false', '--output', join(dir, 'out'), ...args);

async function pixel(png, x, y) {
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
    error => error.code === 1 && error.stdout.includes('scene "probe" timeline ends at 1.01s, after its 1s'),
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
