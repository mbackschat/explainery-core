import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { assembleIndex, type Story, type Timing } from '../src/index.ts';

const story: Story = {
  id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    { id: 'registry', copy: { category: 'SHARE', headline: 'Team Registry' }, narration: 'Publish {publish} it.' },
    { id: 'scopes', copy: { headline: "It's <yours> & ours" }, narration: 'Grow {grow}.' },
  ],
};
const timing: Timing = {
  source: 'imported', audio: 'assets/narration.wav', duration: 16,
  scenes: { registry: { start: 0, duration: 8.9, beats: { publish: 2.45 } }, scopes: { start: 8.2, duration: 7.8, beats: { grow: 2.2 } } },
};
const index = `<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="1">
    <div id="registry" class="clip" data-composition-id="registry" data-composition-src="compositions/registry.html" data-start="0" data-duration="1" data-track-index="1"></div>
    <div id="scopes" data-composition-id="scopes" data-composition-src="compositions/scopes.html" data-variable-values='{"stale":true}'></div>
    <div id="brand-frame" data-composition-id="brand-frame" data-composition-src="compositions/brand-frame.html" data-start="0" data-duration="1" data-story-span></div>
    <audio id="narration" src="assets/old.wav" data-start="0" data-duration="1" data-story-span data-story-audio></audio>
  </div>
</body>`;

const unescape = (value: string) => value.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function attributes(html: string, id: string): Record<string, string> {
  const tag = html.match(new RegExp(`<[a-z]+ id="${id}"(?:\\s+[^\\s"'>/=]+(?:=(?:"[^"]*"|'[^']*'))?)*\\s*>`))![0];
  return Object.fromEntries([...tag.matchAll(/\s([^\s"'>/=]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)].map(([, name, double, single]) => [name, unescape(double ?? single ?? '')]));
}

test('scene hosts receive their slot and their copy, beats, and duration as composition variables', () => {
  const { html, errors } = assembleIndex(index, story, timing);
  assert.deepEqual(errors, []);
  const registry = attributes(html, 'registry');
  assert.equal(registry['data-start'], '0');
  assert.equal(registry['data-duration'], '8.9');
  assert.deepEqual(JSON.parse(registry['data-variable-values']), { copy: { category: 'SHARE', headline: 'Team Registry' }, beats: { publish: 2.45 }, duration: 8.9 });
  const scopes = attributes(html, 'scopes');
  assert.equal(scopes['data-start'], '8.2');
  assert.deepEqual(JSON.parse(scopes['data-variable-values']).copy, { headline: "It's <yours> & ours" });
});

test('the root, story-spanning elements, and the narration track follow the story duration and audio', () => {
  const { html } = assembleIndex(index, story, timing);
  assert.equal(attributes(html, 'root')['data-duration'], '16');
  assert.equal(attributes(html, 'brand-frame')['data-duration'], '16');
  assert.equal(attributes(html, 'narration')['data-duration'], '16');
  assert.equal(attributes(html, 'narration').src, 'assets/narration.wav');
});

test('everything outside the managed attributes is preserved, and assembling is idempotent', () => {
  const { html } = assembleIndex(index, story, timing);
  assert.match(html, /<div id="registry" class="clip" data-composition-id="registry" data-composition-src="compositions\/registry.html" data-start="0" data-duration="8.9" data-track-index="1" data-variable-values='/);
  assert.equal(assembleIndex(html, story, timing).html, html);
});

test('a story scene without a host in index.html is reported', () => {
  const { errors } = assembleIndex(index.replace(/<div id="scopes"[^\n]*\n/, ''), story, timing);
  assert.deepEqual(errors, ['index.html: no host with data-composition-src for scene "scopes"']);
});

test('the assemble command writes index.html, and --check fails while it is stale', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-assemble-'));
  await mkdir(join(dir, 'compositions'));
  await writeFile(join(dir, 'story.yaml'), JSON.stringify(story));
  await writeFile(join(dir, 'timing.json'), JSON.stringify(timing));
  for (const id of ['registry', 'scopes']) await writeFile(join(dir, 'compositions', `${id}.html`), `<template><div data-composition-id="${id}"></div></template>`);
  await writeFile(join(dir, 'index.html'), index);
  const run = promisify(execFile);
  const cli = new URL('../bin/explainery.ts', import.meta.url).pathname;
  await assert.rejects(run(process.execPath, [cli, 'assemble', dir, '--check']), (error: { code: number; stderr: string }) => error.code === 1 && /index\.html is out of date/.test(error.stderr));
  await run(process.execPath, [cli, 'assemble', dir]);
  assert.equal(await readFile(join(dir, 'index.html'), 'utf8'), assembleIndex(index, story, timing).html);
  await run(process.execPath, [cli, 'assemble', dir, '--check']);
});
