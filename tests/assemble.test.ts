import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { assembleIndex, type Story, type Timing } from '../src/index.ts';
import type { ResolvedFilm } from '../src/types.ts';

const story: Story = {
  id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    { id: 'library', copy: { category: 'SHARE', headline: 'Town Library' }, narration: 'Publish {publish} it.' },
    { id: 'branches', copy: { headline: "It's <yours> & ours" }, narration: 'Grow {grow}.' },
  ],
};
const timing: Timing = {
  source: 'imported', audio: 'assets/narration.wav', duration: 16,
  scenes: { library: { start: 0, duration: 8.9, beats: { publish: 2.45 } }, branches: { start: 8.2, duration: 7.8, beats: { grow: 2.2 } } },
};
const index = `<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="1">
    <div id="library" class="clip" data-composition-id="library" data-composition-src="compositions/library.html" data-start="0" data-duration="1" data-track-index="1"></div>
    <div id="branches" data-composition-id="branches" data-composition-src="compositions/branches.html" data-variable-values='{"stale":true}'></div>
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
  const library = attributes(html, 'library');
  assert.equal(library['data-start'], '0');
  assert.equal(library['data-duration'], '8.9');
  assert.deepEqual(JSON.parse(library['data-variable-values']), { copy: { category: 'SHARE', headline: 'Town Library' }, beats: { publish: 2.45 }, duration: 8.9 });
  const branches = attributes(html, 'branches');
  assert.equal(branches['data-start'], '8.2');
  assert.deepEqual(JSON.parse(branches['data-variable-values']).copy, { headline: "It's <yours> & ours" });
});

test('the root, story-spanning elements, and the narration track follow the story duration and audio', () => {
  const { html } = assembleIndex(index, story, timing);
  assert.equal(attributes(html, 'root')['data-duration'], '16');
  assert.equal(attributes(html, 'brand-frame')['data-duration'], '16');
  assert.equal(attributes(html, 'narration')['data-duration'], '16');
  assert.equal(attributes(html, 'narration').src, 'assets/narration.wav');
});

test('the narration track ends with its audio when the film holds after the last word', () => {
  assert.equal(attributes(assembleIndex(index, story, { ...timing, audioDuration: 14.27 }).html, 'narration')['data-duration'], '14.27');
  assert.equal(attributes(assembleIndex(index, story, { ...timing, audioDuration: 17 }).html, 'narration')['data-duration'], '16');
  assert.equal(attributes(assembleIndex(index, story, { ...timing, audioDuration: 14.27 }).html, 'brand-frame')['data-duration'], '16');
});

test('everything outside the managed attributes is preserved, and assembling is idempotent', () => {
  const { html } = assembleIndex(index, story, timing);
  assert.match(html, /<div id="library" class="clip" data-composition-id="library" data-composition-src="compositions\/library.html" data-start="0" data-duration="8.9" data-track-index="1" data-variable-values='/);
  assert.equal(assembleIndex(html, story, timing).html, html);
});

test('a story scene without a host in index.html is reported', () => {
  const { errors } = assembleIndex(index.replace(/<div id="branches"[^\n]*\n/, ''), story, timing);
  assert.deepEqual(errors, ['index.html: no host with data-composition-src for scene "branches"']);
});

const referenced = (): ResolvedFilm => ({
  story, mode: 'referenced', sources: new Map([
    ['library', { definition: 'scenes/first/scene.yaml', html: 'scenes/first/diagram.html' }],
    ['branches', { definition: 'scenes/second/scene.yaml', html: 'scenes/second/diagram.html' }],
  ]),
});

test('referenced assembly changes only source attributes in an already assembled film', () => {
  const before = assembleIndex(index, story, timing).html;
  const expected = before.replace('compositions/library.html', 'scenes/first/diagram.html').replace('compositions/branches.html', 'scenes/second/diagram.html');
  const result = assembleIndex(before, story, timing, referenced());
  assert.deepEqual(result.errors, []);
  assert.equal(result.html, expected);
  assert.equal(assembleIndex(result.html, story, timing, referenced()).html, expected);
});

test('referenced source paths are escaped once and canonicalized without changing host order', () => {
  const resolved = referenced();
  resolved.sources.get('library')!.html = 'scenes/first/a&b.html';
  const before = assembleIndex(index, story, timing).html.replace('compositions/library.html', './compositions/library.html');
  const result = assembleIndex(before, story, timing, resolved);
  assert.equal(attributes(result.html, 'library')['data-composition-src'], 'scenes/first/a&b.html');
  assert.equal(assembleIndex(result.html, story, timing, resolved).html, result.html);
  assert.ok(result.html.indexOf('id="library"') < result.html.indexOf('id="branches"'));
});

test('only referenced films reject obsolete and unidentified hosts while preserving declared shared layers', () => {
  for (const host of [
    '<div data-composition-id="removed" data-composition-src="old.html"></div>',
    '<div data-composition-src="old.html"></div>',
  ]) {
    const html = index.replace('</body>', `${host}</body>`);
    assert.deepEqual(assembleIndex(html, story, timing).errors, []);
    assert.match(assembleIndex(html, story, timing, referenced()).errors.join('\n'), /unrecognized composition host/);
  }
  assert.deepEqual(assembleIndex(index, story, timing, referenced()).errors, []);
});

test('referenced assembly fails if a visual source mapping is incomplete', () => {
  const resolved = referenced();
  resolved.sources.delete('library');
  assert.match(assembleIndex(index, story, timing, resolved).errors.join('\n'), /library.*resolved HTML source/);
});

test('canonical referenced sources retain authored quotes and equivalent entity spelling', () => {
  const resolved = referenced();
  resolved.sources.get('library')!.html = 'scenes/first/a&b.html';
  const canonical = assembleIndex(index, story, timing, resolved).html;
  const authored = canonical.replace('data-composition-src="scenes/first/a&amp;b.html"', "data-composition-src='scenes/first/a&#38;b.html'");
  assert.equal(assembleIndex(authored, story, timing, resolved).html, authored);
});

test('the assemble command writes index.html, and --check fails while it is stale', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-assemble-'));
  await mkdir(join(dir, 'compositions'));
  await writeFile(join(dir, 'story.yaml'), JSON.stringify(story));
  await writeFile(join(dir, 'timing.json'), JSON.stringify(timing));
  for (const id of ['library', 'branches']) await writeFile(join(dir, 'compositions', `${id}.html`), `<template><div data-composition-id="${id}"></div></template>`);
  await writeFile(join(dir, 'index.html'), index);
  const run = promisify(execFile);
  const cli = new URL('../bin/explainery.ts', import.meta.url).pathname;
  await assert.rejects(run(process.execPath, [cli, 'assemble', dir, '--check']), (error: { code: number; stderr: string }) => error.code === 1 && /index\.html is out of date/.test(error.stderr));
  await run(process.execPath, [cli, 'assemble', dir]);
  assert.equal(await readFile(join(dir, 'index.html'), 'utf8'), assembleIndex(index, story, timing).html);
  await run(process.execPath, [cli, 'assemble', dir, '--check']);
});

test('the CLI resolves referenced source paths and refuses stale exports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-referenced-assemble-'));
  const run = promisify(execFile);
  const cli = new URL('../bin/explainery.ts', import.meta.url).pathname;
  const source = { ...story, scenes: [{ source: 'scenes/demo/scene.yaml' }] };
  await mkdir(join(dir, 'scenes/demo'), { recursive: true });
  await mkdir(join(dir, 'compositions'));
  await writeFile(join(dir, 'story.yaml'), JSON.stringify(source));
  await writeFile(join(dir, 'scenes/demo/scene.yaml'), JSON.stringify({ id: 'demo', title: 'Demo', compositions: story.scenes.map(part => ({ ...part, source: `${part.id}.html` })) }));
  for (const id of ['library', 'branches']) await writeFile(join(dir, `scenes/demo/${id}.html`), `<template><div data-composition-id="${id}"></div></template>`);
  await writeFile(join(dir, 'compositions/brand-frame.html'), '<template><div data-composition-id="brand-frame"></div></template>');
  await writeFile(join(dir, 'timing.json'), JSON.stringify({ ...timing, audio: undefined }));
  await writeFile(join(dir, 'index.html'), index.replace(/\s*<audio[^>]*><\/audio>/, ''));
  for (const args of [['assemble', dir, '--check'], ['export', dir, '--out', join(dir, 'export')], ['export', dir, '--single-file', '--out', join(dir, 'out.html')]]) {
    await assert.rejects(run(process.execPath, [cli, ...args]), (error: { stderr: string }) => /index.html.*(?:out of date|stale)/.test(error.stderr));
  }
  await run(process.execPath, [cli, 'assemble', dir]);
  await run(process.execPath, [cli, 'assemble', dir, '--check']);
  const html = await readFile(join(dir, 'index.html'), 'utf8');
  assert.equal(attributes(html, 'library')['data-composition-src'], 'scenes/demo/library.html');
  assert.equal(attributes(html, 'branches')['data-composition-src'], 'scenes/demo/branches.html');
});
