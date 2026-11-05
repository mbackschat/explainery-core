import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import * as dependencies from '../src/film-files.ts';
import { onScreenTextHash } from '../src/label-audit.ts';
import { prepareSceneProject } from '../src/scene-project.ts';
import { productionPreflight, recordProduction, renderFingerprint } from '../src/production.ts';
import { loadStory } from '../src/validate.ts';
import { assembleIndex } from '../src/assemble.ts';
import { recordLabelAudit } from '../src/label-audit.ts';
import { fixtureProject } from './support/fixture.ts';
import { verifyFilm } from '../src/verification.ts';

async function fixture(t: test.TestContext, files: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'scene-source-pipeline-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entries = {
    'story.yaml': JSON.stringify({ id: 'film', title: 'Film', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, scenes: [{ source: 'scenes/example/definition.yaml' }] }),
    'scenes/example/definition.yaml': JSON.stringify({ id: 'example', title: 'Example', compositions: [{ id: 'diagram', source: 'diagram.html', copy: { headline: 'Example' }, narration: 'Example.' }] }),
    'timing.json': JSON.stringify({ source: 'estimate', duration: 2, scenes: { diagram: { start: 0, duration: 2, beats: {} } } }),
    'index.html': '<html><body><div data-composition-id="film" data-start="0" data-duration="2"><div data-composition-id="diagram" data-composition-src="scenes/example/diagram.html"></div><div data-story-span data-composition-id="shared" data-composition-src="compositions/shared.html"></div></div></body></html>',
    'scenes/example/diagram.html': '<template><div data-composition-id="diagram"><img src="scenes/example/assets/shape.svg"><span>Original label</span></div></template>',
    'scenes/example/assets/shape.svg': '<svg/>',
    'scenes/example/README.md': 'Purpose and evidence.',
    'scenes/example/evidence/notes.markdown': 'Source evidence.',
    'compositions/shared.html': '<template><div data-composition-id="shared">Shared label</div></template>',
    ...files,
  };
  for (const [path, contents] of Object.entries(entries)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), contents);
  }
  return dir;
}

test('nested HTML rejects sibling collisions across markup attributes and inline CSS with suffixes', async t => {
  const dir = await fixture(t, { 'assets/shape.svg': '<svg/>', 'scenes/example/diagram.html': `<template><div data-composition-id="diagram"><img src="assets/shape.svg?cache=1#icon"><video poster="assets/shape.svg"></video><svg><use href="assets/shape.svg#symbol"/></svg><div style="background:url('assets/shape.svg')"></div><style>.shape { mask:url(assets/shape.svg); }</style></div></template>` });
  const errors = await dependencies.validateHtmlResourcePaths(dir, ['scenes/example/diagram.html']);
  assert.ok(errors.length >= 5);
  for (const error of errors) {
    assert.match(error, /diagram/);
    assert.match(error, /assets\/shape\.svg/);
    assert.match(error, /scenes\/example\/assets\/shape\.svg/);
  }
});

test('HTML parent-relative resources fail while fragments, data and unambiguous root resources pass', async t => {
  const dir = await fixture(t);
  assert.deepEqual(await dependencies.validateHtmlResourcePaths(dir, ['scenes/example/diagram.html']), []);
  await writeFile(join(dir, 'scenes/example/diagram.html'), '<div data-composition-id="diagram"><img src="../shape.svg"><style>.a{background:url(../texture.svg)}</style><svg><use href="#symbol"/></svg><img src="data:image/png;base64,AA"></div>');
  const errors = await dependencies.validateHtmlResourcePaths(dir, ['scenes/example/diagram.html']);
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /parent-relative/);
});

test('resource guards normalize escaped paths and treat existing sibling directories as capture collisions', async t => {
  const dir = await fixture(t, { 'scenes/example/diagram.html': '<div data-composition-id="diagram"><img src=" assets/%73hape.svg?version=1#icon "><img src="assets/folder"></div>' });
  await mkdir(join(dir, 'scenes/example/assets/folder'));
  const errors = await dependencies.validateHtmlResourcePaths(dir, ['scenes/example/diagram.html']);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /assets\/%73hape.svg.*scenes\/example\/assets\/shape.svg.*assets\/shape.svg/);
  assert.match(errors[1], /scenes\/example\/assets\/folder/);
});

test('referenced label audits cover visual and shared HTML but exclude scene documentation', async t => {
  const dir = await fixture(t);
  const original = await onScreenTextHash(dir);
  await writeFile(join(dir, 'scenes/example/README.md'), 'Changed explanation.');
  assert.equal(await onScreenTextHash(dir), original);
  await writeFile(join(dir, 'scenes/example/diagram.html'), '<div data-composition-id="diagram">Changed label</div>');
  const visualChanged = await onScreenTextHash(dir);
  assert.notEqual(visualChanged, original);
  await writeFile(join(dir, 'compositions/shared.html'), '<div data-composition-id="shared">Changed shared label</div>');
  assert.notEqual(await onScreenTextHash(dir), visualChanged);
});

test('referenced label audits include shared hosts outside the flat composition directory', async t => {
  const dir = await fixture(t, { 'shared/layer.html': '<div data-composition-id="shared">Original shared label</div>' });
  const index = join(dir, 'index.html');
  await writeFile(index, (await readFile(index, 'utf8')).replace('compositions/shared.html', 'shared/layer.html'));
  const original = await onScreenTextHash(dir);
  await writeFile(join(dir, 'shared/layer.html'), '<div data-composition-id="shared">Changed shared label</div>');
  assert.notEqual(await onScreenTextHash(dir), original);
});

test('scene views retain runtime paths and purge custom scene definitions and documentation on refresh', async t => {
  const dir = await fixture(t);
  const prepared = await prepareSceneProject(dir, ['example']);
  for (const name of ['scenes/example/diagram.html', 'scenes/example/assets/shape.svg', 'compositions/shared.html']) assert.equal(await readFile(join(prepared.directory, name), 'utf8'), await readFile(join(dir, name), 'utf8'));
  for (const name of ['scenes/example/definition.yaml', 'scenes/example/README.md', 'scenes/example/evidence/notes.markdown']) {
    await assert.rejects(readFile(join(prepared.directory, name)), /ENOENT/);
    await mkdir(dirname(join(prepared.directory, name)), { recursive: true });
    await writeFile(join(prepared.directory, name), 'Stale authoring input');
  }
  await prepareSceneProject(dir, ['example']);
  for (const name of ['scenes/example/definition.yaml', 'scenes/example/README.md', 'scenes/example/evidence/notes.markdown']) await assert.rejects(readFile(join(prepared.directory, name)), /ENOENT/);
});

test('render fingerprints track referenced definitions and exclude scene documentation', async t => {
  const dir = await fixture(t);
  await symlink(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'));
  const settings = { quality: 'preview', sceneIds: [], workers: 1 };
  const original = await renderFingerprint(dir, settings);
  await writeFile(join(dir, 'scenes/example/README.md'), 'Changed README');
  assert.equal(await renderFingerprint(dir, settings), original);
  const path = join(dir, 'scenes/example/definition.yaml');
  await writeFile(path, (await readFile(path, 'utf8')).replace('Example.', 'Changed narration.'));
  assert.notEqual(await renderFingerprint(dir, settings), original);
});

test('referenced dependency traversal rejects escaping runtime symlinks', async t => {
  const dir = await fixture(t);
  const loaded = await loadStory(dir);
  assert.ok(loaded.resolved);
  const outside = await mkdtemp(join(tmpdir(), 'scene-source-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'escape.svg'), '<svg/>');
  await symlink(join(outside, 'escape.svg'), join(dir, 'scenes/example/assets/escape.svg'));
  await writeFile(join(dir, 'scenes/example/diagram.html'), '<div><img src="scenes/example/assets/escape.svg"></div>');
  await assert.rejects(dependencies.filmFiles(dir, { resolved: loaded.resolved }), /outside the project/);
});

test('referenced dependency traversal guards shared HTML outside compositions and uses assembled source overrides', async t => {
  const dir = await fixture(t, {
    'shared/layer.html': '<div data-composition-id="shared"><img src="assets/shape.svg?version=1"></div>',
    'shared/assets/shape.svg': '<svg/>',
    'assets/shape.svg': '<svg/>',
  });
  const loaded = await loadStory(dir);
  assert.ok(loaded.resolved);
  const rootHTML = (await readFile(join(dir, 'index.html'), 'utf8')).replace('compositions/shared.html', 'shared/layer.html');
  await writeFile(join(dir, 'index.html'), '<div data-composition-src="missing-old-source.html"></div>');
  await assert.rejects(dependencies.filmFiles(dir, { resolved: loaded.resolved, rootHTML }), /shared\/layer.html.*shared\/assets\/shape.svg.*assets\/shape.svg/);
  await writeFile(join(dir, 'shared/layer.html'), '<div><img src="scenes/example/assets/shape.svg"></div>');
  assert.ok((await dependencies.filmFiles(dir, { resolved: loaded.resolved, rootHTML })).includes('shared/layer.html'));
});

test('a path-only source move preserves production narration hashes and changed nested labels block preflight', async t => {
  const dir = await fixtureProject('scene-runtime');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const timing = JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8'));
  timing.audio = 'voice.wav';
  await writeFile(join(dir, 'voice.wav'), 'retained voice bytes');
  await writeFile(join(dir, 'transcript.json'), JSON.stringify([{ text: 'Show', start: 0, end: .3 }, { text: 'it', start: .3, end: .8 }]));
  await writeFile(join(dir, 'timing.json'), JSON.stringify(timing));
  const inline = await loadStory(dir);
  assert.ok(inline.value);
  const index = (await readFile(join(dir, 'index.html'), 'utf8')).replace('</body>', '<audio src="voice.wav" data-story-audio data-story-span data-start="0"></audio></body>');
  await writeFile(join(dir, 'index.html'), assembleIndex(index, inline.value, timing).html);
  const before = await recordProduction(dir, { transcript: 'transcript.json' });
  const oldFingerprint = await renderFingerprint(dir, { quality: 'preview', sceneIds: [], workers: 1 });
  await mkdir(join(dir, 'scenes/probe'), { recursive: true });
  await writeFile(join(dir, 'scenes/probe/scene.yaml'), JSON.stringify({ id: 'probe', title: 'Probe', compositions: [{ ...inline.value.scenes[0], source: 'visual.html' }] }));
  await writeFile(join(dir, 'scenes/probe/visual.html'), await readFile(join(dir, 'compositions/probe.html')));
  await rm(join(dir, 'compositions/probe.html'));
  await writeFile(join(dir, 'story.yaml'), JSON.stringify({ ...inline.value, scenes: [{ source: 'scenes/probe/scene.yaml' }] }));
  const moved = await loadStory(dir);
  assert.ok(moved.value);
  await writeFile(join(dir, 'index.html'), assembleIndex(index, moved.value, timing, moved.resolved).html);
  const after = await recordProduction(dir, { transcript: 'transcript.json' });
  assert.equal(after.narrationHash, before.narrationHash);
  assert.equal(after.voiceInputHash, before.voiceInputHash);
  assert.equal(after.audio.sha256, before.audio.sha256);
  assert.equal(after.timingSha256, before.timingSha256);
  assert.notEqual(await renderFingerprint(dir, { quality: 'preview', sceneIds: [], workers: 1 }), oldFingerprint);
  await writeFile(join(dir, 'audit.md'), 'Reviewed labels.');
  await recordLabelAudit(dir, { report: 'audit.md', reviewer: 'fixture reviewer' });
  assert.deepEqual((await productionPreflight(dir)).errors, []);
  const visual = join(dir, 'scenes/probe/visual.html');
  await writeFile(visual, (await readFile(visual, 'utf8')).replace('Fallback copy', 'Changed label'));
  assert.match((await productionPreflight(dir)).errors.join('\n'), /on-screen text changed/);
});

test('verification refuses stale referenced assembly even when the old visual still exists', async t => {
  const dir = await fixture(t);
  const loaded = await loadStory(dir);
  assert.ok(loaded.value);
  const index = join(dir, 'index.html');
  const timing = JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8'));
  await writeFile(index, assembleIndex(await readFile(index, 'utf8'), loaded.value, timing, loaded.resolved).html);
  const definition = join(dir, 'scenes/example/definition.yaml');
  await writeFile(definition, (await readFile(definition, 'utf8')).replace('diagram.html', 'new-diagram.html'));
  await writeFile(join(dir, 'scenes/example/new-diagram.html'), await readFile(join(dir, 'scenes/example/diagram.html')));
  for (const quick of [false, true]) {
    const receipt = await verifyFilm(dir, { out: join(dir, 'verification'), quick });
    assert.equal(receipt.passed, false);
    assert.match(receipt.failures.join('\n'), /index.html is stale/);
    assert.deepEqual(receipt.frames, []);
  }
});

test('verification source evidence identifies referenced definitions and runtime asset bytes before capture', async t => {
  const dir = await fixture(t);
  const loaded = await loadStory(dir);
  assert.ok(loaded.value);
  const index = join(dir, 'index.html');
  const timing = JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8'));
  await writeFile(index, assembleIndex(await readFile(index, 'utf8'), loaded.value, timing, loaded.resolved).html);
  const options = { out: join(dir, 'verification'), quick: true };
  const before = await verifyFilm(dir, options);
  assert.match(before.failures.join('\n'), /hyperframes/, 'the fixture deliberately has no browser engine; evidence is recorded before that boundary');
  assert.ok(before.sourceHashes['scenes/example/definition.yaml']);
  assert.ok(before.sourceHashes['scenes/example/assets/shape.svg']);
  await writeFile(join(dir, 'scenes/example/assets/shape.svg'), '<svg><path d="M0 0H1"/></svg>');
  const after = await verifyFilm(dir, options);
  assert.notEqual(after.sourceHashes['scenes/example/assets/shape.svg'], before.sourceHashes['scenes/example/assets/shape.svg']);
});
