import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { filmFiles } from '../src/film-files.ts';
import { hyperframesDist } from '../src/hyperframes.ts';
import { prepareSceneProject } from '../src/scene-project.ts';
import type { Story, Timing } from '../src/types.ts';

const story: Story = {
  id: 'review-film', title: 'Review film', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    { id: 'lead', copy: { headline: 'Lead' }, narration: 'Lead.' },
    { id: 'chapter', title: 'The chapter', compositions: [
      { id: 'part-a', copy: { headline: 'Current copy' }, narration: 'First {move}.' },
      { id: 'part-b', copy: { headline: 'Second part' }, narration: 'Second {settle}.' },
    ] },
    { id: 'final', copy: { headline: 'Final' }, narration: 'Final.' },
    { id: 'tail', copy: { headline: 'Tail' }, narration: 'Tail.' },
  ],
};
const timing: Timing = {
  source: 'imported', audio: 'assets/narration.wav', duration: 18,
  scenes: {
    lead: { start: 0, duration: 2, beats: {} },
    'part-a': { start: 2, duration: 5, beats: { move: 1.25 } },
    'part-b': { start: 6, duration: 4, beats: { settle: 2.0 } },
    final: { start: 9, duration: 4, beats: {} },
    tail: { start: 13, duration: 5, beats: {} },
  },
};

function wave(duration: number): Buffer {
  const sampleRate = 8000;
  const dataBytes = sampleRate * duration * 2;
  const result = Buffer.alloc(44 + dataBytes);
  result.write('RIFF'); result.writeUInt32LE(36 + dataBytes, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(sampleRate, 24); result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34); result.write('data', 36); result.writeUInt32LE(dataBytes, 40);
  return result;
}

async function project(t: test.TestContext, options: { story?: Story; audio?: string | false; sourceDuration?: number; timing?: Timing; literalTags?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-scenes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await Promise.all(['compositions', 'assets', 'theme', 'node_modules'].map(name => mkdir(join(dir, name))));
  await writeFile(join(dir, 'story.yaml'), JSON.stringify(options.story ?? story));
  await writeFile(join(dir, 'timing.json'), JSON.stringify(options.timing ?? timing));
  for (const id of Object.keys(timing.scenes)) await writeFile(join(dir, 'compositions', `${id}.html`), `<template><div data-composition-id="${id}"><span>${id} authored artwork</span><svg><image href="assets/shape.svg"/></svg></div></template>`);
  await writeFile(join(dir, 'compositions', 'brand-frame.html'), '<template><div data-composition-id="brand-frame">Brand</div></template>');
  await writeFile(join(dir, 'assets', 'shape.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H5"/></svg>');
  await writeFile(join(dir, 'assets', 'narration.wav'), wave(options.sourceDuration ?? 18));
  await writeFile(join(dir, 'theme', 'theme.css'), '.background { background: #123; }');
  await writeFile(join(dir, 'node_modules', 'animation.js'), 'window.gsap = {};');
  await writeFile(join(dir, 'package.json'), '{"name":"review-film","type":"module"}');
  const audio = options.audio === false ? '' : options.audio ?? '<audio id="narration" src="assets/old.wav" data-start="0" data-duration="99" data-media-start="0" data-story-span data-story-audio data-volume=".8"></audio>';
  const comment = options.literalTags === false ? '<!-- A comment stays intact. -->' : '<!-- <section data-composition-src="fake.html">A comment stays intact.</section> -->';
  const example = options.literalTags === false ? 'A script stays intact.' : '<section data-composition-src="not-a-host.html">';
  const hosts = Object.keys(timing.scenes).map(id => `<section id="host-${id}" class="clip" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="99" data-duration="99"><div data-custom="nested">${id} host body</div></section>`).join('\n');
  await writeFile(join(dir, 'index.html'), `<!DOCTYPE html><html lang="en"><head><title>Review</title><script src="node_modules/animation.js"></script><link rel="stylesheet" href="theme/theme.css"><style>.clip { position:absolute; }</style></head><body>
    ${comment}
    <div id="root" data-composition-id="main" data-start="0" data-duration="99" data-width="1920" data-height="1080">
      <div class="background"><span>Shared background</span></div>${hosts}
      <div id="brand-frame" data-composition-id="brand-frame" data-composition-src="compositions/brand-frame.html" data-start="0" data-duration="99" data-story-span></div>${audio}
    </div><script>const example = '${example}'; window.__timelines['main'] = gsap.timeline({ paused:true });</script></body></html>`);
  return dir;
}

const readIndex = async (dir: string) => parseHTML(await readFile(join(dir, 'index.html'), 'utf8')).document;

test('a selected scene keeps all of its compositions and their overlap, copy, and local beats', async t => {
  const dir = await project(t);
  const result = await prepareSceneProject(dir, ['chapter']);
  assert.deepEqual({ start: result.start, duration: result.duration, sceneIds: result.sceneIds }, { start: 2, duration: 8, sceneIds: ['chapter'] });
  assert.equal(basename(result.directory), 'review-film--chapter');
  const document = await readIndex(result.directory);
  assert.deepEqual([...document.querySelectorAll('[data-composition-src]')].map(e => e.getAttribute('data-composition-id')), ['part-a', 'part-b', 'brand-frame']);
  assert.equal(document.querySelector('#host-part-a')!.getAttribute('data-start'), '0');
  assert.equal(document.querySelector('#host-part-b')!.getAttribute('data-start'), '4');
  assert.equal(document.querySelector('#host-part-a')!.getAttribute('data-duration'), '5');
  assert.deepEqual(JSON.parse(document.querySelector('#host-part-a')!.getAttribute('data-variable-values')!), { copy: { headline: 'Current copy' }, beats: { move: 1.25 }, duration: 5 });
  assert.match(document.querySelector('#host-part-a')!.innerHTML, /part-a host body/);
  assert.doesNotMatch(document.body.textContent!, /lead host body|final host body|tail host body/);
});

test('consecutive scene ranges cover their complete units and retime the root and shared frame', async t => {
  const dir = await project(t);
  const result = await prepareSceneProject(dir, ['chapter', 'final']);
  assert.deepEqual({ start: result.start, duration: result.duration }, { start: 2, duration: 11 });
  const document = await readIndex(result.directory);
  for (const id of ['root', 'brand-frame']) {
    assert.equal(document.querySelector('#' + id)!.getAttribute('data-start'), '0');
    assert.equal(document.querySelector('#' + id)!.getAttribute('data-duration'), '11');
  }
  assert.equal(document.querySelector('#host-final')!.getAttribute('data-start'), '7');
  assert.equal(document.querySelector('.background')!.textContent, 'Shared background');
  assert.equal(document.querySelector('link')!.getAttribute('href'), 'theme/theme.css');
  assert.match(document.querySelector('style')!.textContent!, /\.clip/);
  assert.match(document.body.innerHTML, /A comment stays intact/);
  assert.match([...document.querySelectorAll('script')].at(-1)!.textContent!, /window\.__timelines\['main'\]/);
  assert.match([...document.querySelectorAll('script')].at(-1)!.textContent!, /not-a-host\.html/);
});

test('narration advances the existing source offset and stops at the real source tail', async t => {
  const dir = await project(t, { sourceDuration: 17, audio: '<audio id="narration" src="assets/narration.wav" data-start="0" data-duration="99" data-playback-start="1" data-story-span data-story-audio data-volume=".8"></audio>' });
  const result = await prepareSceneProject(dir, ['tail']);
  const audio = (await readIndex(result.directory)).querySelector('audio')!;
  assert.equal(result.duration, 5);
  assert.equal(audio.getAttribute('data-start'), '0');
  assert.equal(audio.getAttribute('data-duration'), '3');
  assert.equal(audio.getAttribute('data-media-start'), '14');
  assert.equal(audio.hasAttribute('data-playback-start'), false);
  assert.equal(audio.getAttribute('data-volume'), '.8');
});

test('a late audio start and an authored clip end stay inside the selected local range', async t => {
  const dir = await project(t, { audio: '<audio id="narration" src="assets/narration.wav" data-start="4" data-duration="8" data-media-start="1" data-story-audio muted></audio>' });
  const chapter = await prepareSceneProject(dir, ['chapter']);
  let audio = (await readIndex(chapter.directory)).querySelector('audio')!;
  assert.equal(audio.getAttribute('data-start'), '2');
  assert.equal(audio.getAttribute('data-duration'), '6');
  assert.equal(audio.getAttribute('data-media-start'), '1');
  assert.equal(audio.hasAttribute('muted'), true);
  const final = await prepareSceneProject(dir, ['final']);
  audio = (await readIndex(final.directory)).querySelector('audio')!;
  assert.equal(audio.getAttribute('data-start'), '0');
  assert.equal(audio.getAttribute('data-duration'), '3');
  assert.equal(audio.getAttribute('data-media-start'), '6');
});

test('source offsets and the available audio tail account for an authored playback rate', async t => {
  const dir = await project(t, { sourceDuration: 17, audio: '<audio id="narration" src="assets/narration.wav" data-start="0" data-duration="18" data-media-start="1" data-playback-rate="2" data-story-span data-story-audio></audio>' });
  const result = await prepareSceneProject(dir, ['chapter']);
  const audio = (await readIndex(result.directory)).querySelector('audio')!;
  assert.equal(audio.getAttribute('data-media-start'), '5');
  assert.equal(audio.getAttribute('data-duration'), '6');
  assert.equal(audio.getAttribute('data-playback-rate'), '2');
});

test('no narration and selections after its source tail produce no audio track', async t => {
  const silent = await project(t, { audio: false, timing: { ...timing, audio: undefined } });
  const silentResult = await prepareSceneProject(silent, ['chapter']);
  assert.equal((await readIndex(silentResult.directory)).querySelector('audio'), null);
  const short = await project(t, { sourceDuration: 8 });
  const shortResult = await prepareSceneProject(short, ['tail']);
  assert.equal((await readIndex(shortResult.directory)).querySelector('audio'), null);
});

test('scene selection rejects empty, unknown, duplicate, reversed, and nonconsecutive ids', async t => {
  const dir = await project(t);
  for (const ids of [[], ['missing'], ['chapter', 'chapter'], ['final', 'chapter'], ['lead', 'final']]) await assert.rejects(prepareSceneProject(dir, ids), /scene|consecutive|selection/i);
});

test('selection, timing, root, and audio-source failures name their cause', async t => {
  const dir = await project(t);
  const rejected: [string[], string][] = [
    [[], 'scene selection must contain at least one scene id'],
    [['missing'], 'unknown scene "missing"'],
    [['chapter', 'chapter'], 'scene selection contains duplicate scene ids'],
    [['final', 'chapter'], 'scene selection must be consecutive scenes in story order'],
    [['lead', 'final'], 'scene selection must be consecutive scenes in story order'],
  ];
  for (const [ids, message] of rejected) await assert.rejects(prepareSceneProject(dir, ids), { message });
  const invalid = await project(t, { timing: { source: 'imported' } as Timing });
  await assert.rejects(prepareSceneProject(invalid, ['missing']), { message: /^timing\.json \/: must have required property 'duration'/ });
  const rootless = await project(t);
  await writeFile(join(rootless, 'index.html'), `<!DOCTYPE html><html><body>${Object.keys(timing.scenes).map(id => `<section data-composition-id="${id}" data-composition-src="compositions/${id}.html"></section>`).join('')}</body></html>`);
  await assert.rejects(prepareSceneProject(rootless, ['chapter']), { message: 'index.html: no root composition' });
  const remote = await project(t, { audio: '<audio src="https://example.com/narration.wav" data-start="0"></audio>' });
  await assert.rejects(prepareSceneProject(remote, ['chapter']), { message: 'scene isolation requires local audio: https://example.com/narration.wav' });
});

test('flat stories still isolate one composition per scene', async t => {
  const flat: Story = { ...story, scenes: [{ id: 'part-a', copy: { headline: 'Flat' }, narration: 'First {move}.' }, { id: 'part-b', copy: { headline: 'Second' }, narration: 'Second {settle}.' }] };
  const slots: Timing = { ...timing, duration: 10, scenes: { 'part-a': timing.scenes['part-a'], 'part-b': timing.scenes['part-b'] } };
  const dir = await project(t, { story: flat, timing: slots, audio: false });
  const result = await prepareSceneProject(dir, ['part-b']);
  assert.deepEqual({ start: result.start, duration: result.duration }, { start: 6, duration: 4 });
  assert.equal((await readIndex(result.directory)).querySelector('#host-part-b')!.getAttribute('data-start'), '0');
});

test('source files stay untouched and rerunning refreshes all source edits into an isolated cache', async t => {
  const dir = await project(t, { literalTags: false });
  const originals = await Promise.all(['index.html', 'story.yaml', 'timing.json'].map(name => readFile(join(dir, name), 'utf8')));
  const result = await prepareSceneProject(dir, ['chapter']);
  const rootInode = (await stat(result.directory)).ino;
  const compositionInode = (await stat(join(result.directory, 'compositions'))).ino;
  await mkdir(join(result.directory, '.hyperframes'));
  await writeFile(join(result.directory, '.hyperframes', 'preview-state.json'), '{}');
  assert.deepEqual(await Promise.all(['index.html', 'story.yaml', 'timing.json'].map(name => readFile(join(dir, name), 'utf8'))), originals);
  for (const name of ['compositions', 'assets', 'theme']) assert.notEqual(await realpath(join(result.directory, name)), await realpath(join(dir, name)));
  assert.equal(await realpath(join(result.directory, 'node_modules')), await realpath(join(dir, 'node_modules')));
  const files = await filmFiles(result.directory);
  assert.ok(files.includes('compositions/part-a.html'));
  assert.ok(files.includes('assets/shape.svg'));
  assert.ok(files.includes('theme/theme.css'));
  assert.ok(!files.includes('compositions/final.html'));
  await writeFile(join(dir, 'compositions', 'part-a.html'), '<template><div data-composition-id="part-a">Animation edited live</div></template>');
  assert.doesNotMatch(await readFile(join(result.directory, 'compositions', 'part-a.html'), 'utf8'), /Animation edited live/);
  await writeFile(join(dir, 'theme', 'theme.css'), '.background { background: #456; }');
  assert.doesNotMatch(await readFile(join(result.directory, 'theme', 'theme.css'), 'utf8'), /#456/);
  const changed = structuredClone(story);
  const chapter = changed.scenes[1];
  assert.ok('compositions' in chapter);
  chapter.compositions[0].copy.headline = 'Reworded';
  await writeFile(join(dir, 'story.yaml'), JSON.stringify(changed));
  await writeFile(join(dir, 'timing.json'), JSON.stringify({ ...timing, scenes: { ...timing.scenes, 'part-a': { ...timing.scenes['part-a'], beats: { move: 1.5 } } } }));
  const refreshed = await prepareSceneProject(dir, ['chapter']);
  assert.equal(refreshed.directory, result.directory);
  assert.equal((await stat(refreshed.directory)).ino, rootInode);
  assert.equal((await stat(join(refreshed.directory, 'compositions'))).ino, compositionInode);
  assert.equal(await readFile(join(refreshed.directory, '.hyperframes', 'preview-state.json'), 'utf8'), '{}');
  const values = JSON.parse((await readIndex(refreshed.directory)).querySelector('#host-part-a')!.getAttribute('data-variable-values')!);
  assert.equal(values.copy.headline, 'Reworded');
  assert.equal(values.beats.move, 1.5);
  assert.match(await readFile(join(result.directory, 'compositions', 'part-a.html'), 'utf8'), /Animation edited live/);
  assert.match(await readFile(join(result.directory, 'theme', 'theme.css'), 'utf8'), /#456/);
  await writeFile(join(result.directory, 'compositions', 'part-a.html'), 'An edit in the generated cache');
  assert.match(await readFile(join(dir, 'compositions', 'part-a.html'), 'utf8'), /Animation edited live/);
});

test('the pinned HyperFrames compiler mounts selected compositions from the generated project', async t => {
  const dir = await project(t, { audio: false, literalTags: false });
  const result = await prepareSceneProject(dir, ['chapter']);
  const dist = hyperframesDist(fileURLToPath(new URL('../', import.meta.url)));
  const compilerName = (await readdir(dist)).find(name => /^compiler-.*\.js$/.test(name));
  assert.ok(compilerName, 'The pinned HyperFrames installation exposes its compiler.');
  const compiler = await import(pathToFileURL(join(dist, compilerName)).href);
  const html: string = await compiler.bundleToSingleHtml(result.directory, { staticGuard: false, runtime: 'placeholder' });
  assert.ok(html.includes('part-a authored artwork'), 'The compiler must mount the first selected composition.');
  assert.ok(html.includes('part-b authored artwork'), 'The compiler must mount the overlapping composition.');
  assert.ok(html.includes('background: #123'), 'The compiler must read the copied project stylesheet.');
  assert.ok(!/lead authored artwork|final authored artwork/.test(html), 'Unselected compositions must not be mounted.');
});
