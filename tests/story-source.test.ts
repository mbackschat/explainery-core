import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { loadStory } from '../src/validate.ts';

const composition = (id = 'diagram') => ({ id, copy: { headline: 'Example' }, narration: '{show} Example.', hold: 1, overlap: 0.2 });
const scene = () => ({ id: 'example', title: 'Example', compositions: [{ ...composition(), source: './diagram.html' }, { ...composition('recap'), card: 'agenda' }] });
const film = (scenes: unknown[]) => ({ id: 'film', title: 'Film', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, scenes });

async function project(t: TestContext, scenes: unknown[] = [{ source: './scenes/example/scene.yaml' }]) {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-source-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await put(dir, 'story.yaml', film(scenes));
  await put(dir, 'scenes/example/scene.yaml', scene());
  await put(dir, 'scenes/example/diagram.html', '<div data-composition-id="diagram"></div>');
  return dir;
}

async function put(dir: string, file: string, value: unknown) {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), typeof value === 'string' ? value : JSON.stringify(value));
}

test('referenced scenes resolve in order into a clean canonical story and explicit source ownership', async t => {
  const dir = await project(t);
  const result = await loadStory(dir);
  assert.deepEqual(result.errors, []);
  assert.equal(result.value, result.resolved?.story);
  assert.deepEqual(result.value, film([{ id: 'example', title: 'Example', compositions: [composition(), { ...composition('recap'), card: 'agenda' }] }]));
  assert.equal(result.resolved?.mode, 'referenced');
  assert.deepEqual([...result.resolved!.sources], [
    ['diagram', { definition: 'scenes/example/scene.yaml', html: 'scenes/example/diagram.html' }],
    ['recap', { definition: 'scenes/example/scene.yaml' }],
  ]);
});

test('inline stories retain their shape and load without visual files', async t => {
  const inline = [composition(), { id: 'closing', title: 'Closing', compositions: [{ ...composition('recap'), card: 'agenda' }] }];
  const dir = await project(t, inline);
  const result = await loadStory(dir);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.value, film(inline));
  assert.equal(result.resolved?.mode, 'inline');
  assert.deepEqual([...result.resolved!.sources], [
    ['diagram', { definition: 'story.yaml', html: 'compositions/diagram.html' }],
    ['recap', { definition: 'story.yaml' }],
  ]);
});

test('normalized declared paths retain their spelling rather than serializing symlink targets', async t => {
  const dir = await project(t, [{ source: 'scenes/example/./scene.yaml' }]);
  await symlink('diagram.html', join(dir, 'scenes/example/alias.html'));
  await put(dir, 'scenes/example/scene.yaml', { ...scene(), compositions: [{ ...composition(), source: 'sub/../alias.html' }] });
  const result = await loadStory(dir);
  assert.deepEqual(result.errors, []);
  assert.equal(result.resolved?.sources.get('diagram')?.html, 'scenes/example/alias.html');
});

test('schema diagnostics include known scene and composition identities', async t => {
  const dir = await project(t);
  await put(dir, 'scenes/example/scene.yaml', { ...scene(), compositions: [{ ...composition(), source: 'diagram.html', hold: -1 }] });
  assert.match((await loadStory(dir)).errors.join('\n'), /scenes\/example\/scene.yaml scene "example" composition "diagram".*hold/);
});

test('invalid referenced definitions report their owner and never return a partial story', async t => {
  for (const invalid of [
    { ...scene(), extra: true },
    { ...scene(), compositions: [] },
    { ...scene(), compositions: [{ ...composition(), source: 'diagram.html', card: 'chapter' }] },
    { ...scene(), compositions: [composition()] },
    { source: 'other.yaml' },
  ]) {
    const dir = await project(t);
    await put(dir, 'scenes/example/scene.yaml', invalid);
    const result = await loadStory(dir);
    assert.equal(result.value, undefined);
    assert.equal(result.resolved, undefined);
    assert.match(result.errors.join('\n'), /scenes\/example\/scene.yaml/);
  }
});

test('missing scene and visual sources are diagnosed at their declaring file', async t => {
  const dir = await project(t);
  await rm(join(dir, 'scenes/example/diagram.html'));
  assert.match((await loadStory(dir)).errors.join('\n'), /scenes\/example\/scene.yaml.*diagram.*missing/);
  await rm(join(dir, 'scenes/example/scene.yaml'));
  assert.match((await loadStory(dir)).errors.join('\n'), /story.yaml.*scenes\/example\/scene.yaml.*missing/);
});

test('source references reject URLs, suffixes, absolute paths and escaping paths', async t => {
  const dir = await project(t);
  for (const source of ['https://example.test/scene.yaml', '/tmp/scene.yaml', '../scene.yaml', 'scene.yaml?version=1', 'scene.yaml#scene', 'C:\\scene.yaml', 'scenes\\example\\scene.yaml']) {
    await put(dir, 'story.yaml', film([{ source }]));
    assert.equal((await loadStory(dir)).value, undefined, source);
  }
  await put(dir, 'story.yaml', film([{ source: 'scenes/example/scene.yaml' }]));
  await put(dir, 'scenes/elsewhere.html', '<div></div>');
  for (const source of ['../elsewhere.html', '../../story.yaml', 'https://example.test/diagram.html', 'diagram.html#x']) {
    await put(dir, 'scenes/example/scene.yaml', { ...scene(), compositions: [{ ...composition(), source }] });
    assert.match((await loadStory(dir)).errors.join('\n'), /scenes\/example\/scene.yaml.*diagram/);
  }
});

test('real-path identity rejects repeated scene references and visual aliases', async t => {
  const dir = await project(t);
  await symlink('scene.yaml', join(dir, 'scenes/example/alias.yaml'));
  await put(dir, 'story.yaml', film([{ source: 'scenes/example/scene.yaml' }, { source: 'scenes/example/alias.yaml' }]));
  assert.match((await loadStory(dir)).errors.join('\n'), /alias.yaml.*already.*scene.yaml/);
  await put(dir, 'story.yaml', film([{ source: 'scenes/example/scene.yaml' }]));
  await symlink('diagram.html', join(dir, 'scenes/example/alias.html'));
  await put(dir, 'scenes/example/scene.yaml', { ...scene(), compositions: [{ ...composition(), source: 'diagram.html' }, { ...composition('other'), source: 'alias.html' }] });
  assert.match((await loadStory(dir)).errors.join('\n'), /other.*already.*diagram/);
});

test('real paths must remain inside the film and the owning scene folder', async t => {
  const dir = await project(t);
  const outside = await mkdtemp(join(tmpdir(), 'explainery-source-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await put(outside, 'scene.yaml', scene());
  await symlink(join(outside, 'scene.yaml'), join(dir, 'outside.yaml'));
  await put(dir, 'story.yaml', film([{ source: 'outside.yaml' }]));
  assert.match((await loadStory(dir)).errors.join('\n'), /outside.*boundary/);
  await put(dir, 'story.yaml', film([{ source: 'scenes/example/scene.yaml' }]));
  await put(dir, 'shared.html', '<div></div>');
  await rm(join(dir, 'scenes/example/diagram.html'));
  await symlink('../../shared.html', join(dir, 'scenes/example/diagram.html'));
  assert.match((await loadStory(dir)).errors.join('\n'), /diagram.*boundary/);
});

test('scene and composition identities are unique in separate namespaces', async t => {
  const dir = await project(t, [{ source: 'scenes/example/scene.yaml' }, { source: 'scenes/second/scene.yaml' }]);
  await put(dir, 'scenes/second/diagram.html', '<div></div>');
  await put(dir, 'scenes/second/scene.yaml', { ...scene(), compositions: [{ ...composition('different'), source: 'diagram.html' }] });
  assert.match((await loadStory(dir)).errors.join('\n'), /scenes\/second\/scene.yaml.*scene id "example".*twice/);
  await put(dir, 'scenes/second/scene.yaml', { ...scene(), id: 'second', compositions: [{ ...composition(), source: 'diagram.html' }] });
  assert.match((await loadStory(dir)).errors.join('\n'), /scenes\/second\/scene.yaml.*composition id "diagram".*twice/);
  await put(dir, 'scenes/second/scene.yaml', { ...scene(), id: 'diagram', compositions: [{ ...composition('different'), source: 'diagram.html' }] });
  assert.deepEqual((await loadStory(dir)).errors, []);
});
