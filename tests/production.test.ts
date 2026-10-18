import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureProject } from './support/fixture.ts';
import { assembleIndex } from '../src/assemble.ts';
import { validateProject } from '../src/validate.ts';
import { recordProduction, productionPreflight, renderFingerprint, reusableRender, recordRender } from '../src/production.ts';

async function fixture() {
  const dir = await fixtureProject('scene-runtime');
  const timing = JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8'));
  timing.audio = 'voice.wav';
  await writeFile(join(dir, 'voice.wav'), 'fixture audio bytes');
  await writeFile(join(dir, 'transcript.json'), JSON.stringify([{ text: 'Show', start: 0, end: .3 }, { text: 'it', start: .3, end: .8 }]));
  await writeFile(join(dir, 'timing.json'), JSON.stringify(timing));
  const validated = await validateProject(dir);
  assert.ok(validated.valid);
  const root = join(dir, 'index.html');
  const html = (await readFile(root, 'utf8')).replace('</body>', '<audio src="voice.wav" data-story-audio data-story-span data-start="0"></audio></body>');
  await writeFile(root, assembleIndex(html, validated.story, validated.timing).html);
  return dir;
}

test('production preflight rejects missing provenance and changed narration, audio, transcript, timing, or assembly', async t => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.match((await productionPreflight(dir)).errors.join(), /record/);
  await recordProduction(dir, { transcript: 'transcript.json' });
  assert.deepEqual((await productionPreflight(dir)).errors, []);
  for (const [file, change, expected] of [
    ['voice.wav', (text: string) => text + 'changed', /audio/],
    ['transcript.json', (text: string) => text.replace('Show', 'Changed'), /transcript/],
    ['story.yaml', (text: string) => text.replace('Show it', 'Explain it'), /narration/],
    ['timing.json', (text: string) => text.replace('"show":1', '"show":0.8'), /timing/],
    ['index.html', (text: string) => text.replace('data-duration="2"', 'data-duration="3"'), /assemble/],
  ] as const) {
    const original = await readFile(join(dir, file), 'utf8');
    await writeFile(join(dir, file), change(original));
    assert.match((await productionPreflight(dir)).errors.join(), expected, file);
    await writeFile(join(dir, file), original);
  }
});

test('production requires the reviewed narration to be the managed rendered audio track', async t => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'index.html');
  const original = await readFile(file, 'utf8');
  await recordProduction(dir, { transcript: 'transcript.json' });
  for (const broken of [original.replace('data-story-audio', 'data-other-audio'), original.replace(/(<audio\b[^>]*data-start=")0"/, (_, prefix: string) => prefix + '1"')]) {
    await writeFile(file, broken);
    assert.match((await productionPreflight(dir)).errors.join(), /narration|audio/);
    await assert.rejects(recordProduction(dir, { transcript: 'transcript.json' }), /narration|audio/);
  }
});

test('pronunciation changes invalidate production even with unchanged written narration', async t => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await recordProduction(dir, { transcript: 'transcript.json' });
  await writeFile(join(dir, 'story.yaml'), (await readFile(join(dir, 'story.yaml'), 'utf8')) + '\npronunciations:\n  Show: Demonstrate\n');
  assert.match((await productionPreflight(dir)).errors.join(), /pronunciation/);
});

test('production rejects another recording’s voice manifest and accepts normalized audio paths', async t => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'segments.json'), JSON.stringify({ audioSha256: 'stale', sample: 'probe', segments: [{ id: 'probe', start: 0, end: 1 }] }));
  await assert.rejects(recordProduction(dir, { transcript: 'transcript.json', segments: 'segments.json' }), /manifest/);
  const timing = JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8'));
  timing.audio = './voice.wav';
  await writeFile(join(dir, 'timing.json'), JSON.stringify(timing));
  const validated = await validateProject(dir);
  assert.ok(validated.valid);
  await writeFile(join(dir, 'index.html'), assembleIndex(await readFile(join(dir, 'index.html'), 'utf8'), validated.story, validated.timing).html);
  await recordProduction(dir, { transcript: 'transcript.json' });
  assert.deepEqual((await productionPreflight(dir)).errors, []);
});

test('render reuse requires a verified fingerprint and intact output bytes', async t => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'movie.mp4');
  await writeFile(output, 'verified fixture bytes');
  const fingerprint = await renderFingerprint(dir, { quality: 'delivery', sceneIds: [], workers: 1 });
  assert.equal(await reusableRender(output, fingerprint), false);
  await recordRender(output, fingerprint);
  assert.equal(await reusableRender(output, fingerprint), true);
  assert.equal(await reusableRender(output, fingerprint + 'changed'), false);
  await writeFile(output, 'corrupt');
  assert.equal(await reusableRender(output, fingerprint), false);
  await writeFile(join(dir, 'compositions/probe.html'), (await readFile(join(dir, 'compositions/probe.html'), 'utf8')) + '\n<!-- changed -->');
  assert.notEqual(await renderFingerprint(dir, { quality: 'delivery', sceneIds: [], workers: 1 }), fingerprint);
  // A flat scene and its only composition render the same range but differ in chapters, so their receipts must differ.
  const scene = await renderFingerprint(dir, { quality: 'delivery', sceneIds: ['probe'], workers: 1 });
  assert.notEqual(await renderFingerprint(dir, { quality: 'delivery', sceneIds: ['probe'], compositionIds: ['probe'], workers: 1 }), scene);
});
