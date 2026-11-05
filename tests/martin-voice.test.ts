import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createMartinAdapter } from '../src/martin-voice.ts';
import { storyVoicePlan } from '../src/narration.ts';
import { storyCompositions } from '../src/story.ts';
import { generateVoice } from '../src/voice.ts';
import type { Story } from '../src/types.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-martin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const python = join(dir, 'python');
  const model = join(dir, 'model.onnx');
  const voices = join(dir, 'voices.npz');
  const provenanceDir = join(dir, '.explainery/voice/martin');
  await writeFile(model, 'model-1');
  await writeFile(voices, 'voices-1');
  await writeFile(python, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identity = () => ({
  frontend: 'test', runtime: {version: fs.existsSync(path.join(path.dirname(arg('--model')), 'runtime-changed')) ? 'changed' : 'test'},
  inputs: {model: {sha256: hash(fs.readFileSync(arg('--model')))}, voices: {sha256: hash(fs.readFileSync(arg('--voices')))}},
  espeakLibrary: 'test', espeakData: null,
});
if (args.includes('--identity')) {
  console.log(JSON.stringify(identity()));
  process.exit(0);
}
const request = JSON.parse(fs.readFileSync(arg('--request'), 'utf8'));
const clip = request.clips[0];
if (clip.text === 'Kaputt.') { console.error('martin-tts: unknown phonemes'); process.exit(1); }
if ([...clip.text].length > 35) { console.error('martin-tts: phoneme limit exceeded: 511 > 510'); process.exit(1); }
fs.appendFileSync(path.join(path.dirname(arg('--model')), 'calls.jsonl'), JSON.stringify(clip.runs) + '\\n');
const output = arg('--out');
fs.mkdirSync(output, {recursive: true});
const wav = Buffer.alloc(44 + 480, 1);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(480, 40);
fs.writeFileSync(path.join(output, clip.id + '.wav'), wav);
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({...identity(), settings: {espeakLibrary: 'test', espeakData: null}, clips: [{...clip, phonemes: 'test', audio: {sha256: fs.readFileSync(arg('--model'), 'utf8') === 'bad-hash' ? 'wrong' : hash(wav)}}]}));
`);
  await chmod(python, 0o755);
  return { dir, options: { python, model, voices, provenanceDir } };
}

const story: Story = {
  id: 'example', title: 'Example', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  voice: { name: 'martin', lang: 'de', speed: 1 },
  scenes: [{ id: 'one', copy: { headline: 'One' }, narration: 'Die Engine läuft.' }],
};

test('Martin adapter retains language runs through long composition retries and publishes measured voice segments', async t => {
  const { dir, options } = await fixture(t);
  const adapter = await createMartinAdapter(options);
  const text = 'Vorlauf '.repeat(46) + 'Engine nutzt API und Plattformcode. ' + 'Ende '.repeat(70);
  const film = { ...story, scenes: [{ ...story.scenes[0], narration: text }, { ...story.scenes[0], id: 'two' }] };
  const result = await generateVoice(dir, film, { adapter, out: 'assets/narration.wav' });
  const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const characters = (runs: { text: string; lang: string }[]) => runs.flatMap(run => [...run.text].map(char => ({ char, lang: run.lang })));
  assert.deepEqual(characters(calls.flat()), characters(storyCompositions(film).flatMap(scene => storyVoicePlan(scene.narration, film).runs)));
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].start, .25);
  assert.ok(result.segments[1].start > result.segments[0].end);
  assert.deepEqual(JSON.parse(await readFile(join(dir, result.manifestFile), 'utf8')), result);
  assert.match(result.engine.version, /^martin:/);
  const retained = await readdir(options.provenanceDir);
  assert.ok(retained.length > 1);
  for (const entry of retained) {
    const chunk = join(options.provenanceDir, entry);
    const manifest = JSON.parse(await readFile(join(chunk, 'output/manifest.json'), 'utf8'));
    const request = JSON.parse(await readFile(join(chunk, 'request.json'), 'utf8'));
    assert.deepEqual(manifest.clips[0].runs, request.clips[0].runs);
    assert.equal(manifest.clips[0].phonemes, 'test');
    assert.ok((await readFile(join(chunk, 'output/speech.wav'))).length > 44);
  }
  await generateVoice(dir, film, { adapter });
  assert.equal((await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').length, calls.length);
});

test('Martin identity invalidates the composition cache after a model change', async t => {
  const { dir, options } = await fixture(t);
  const first = await generateVoice(dir, story, { adapter: await createMartinAdapter(options) });
  await writeFile(options.model, 'model-2');
  const second = await generateVoice(dir, story, { adapter: await createMartinAdapter(options) });
  assert.notEqual(first.engine.version, second.engine.version);
  assert.notEqual(first.segments[0].cacheKey, second.segments[0].cacheKey);
});

test('Martin rejects unsupported settings and non-overflow errors without publishing voice output', async t => {
  const { dir, options } = await fixture(t);
  const adapter = await createMartinAdapter(options);
  const settings = { voice: 'martin', lang: 'de', speed: 1, gap: .4 };
  for (const changed of [{ voice: 'af_heart' }, { lang: 'en-us' }, { speed: .4 }]) {
    await assert.rejects(adapter.synthesize('Text', { ...settings, ...changed }), /Martin/);
  }
  await assert.rejects(generateVoice(dir, { ...story, scenes: [{ ...story.scenes[0], narration: 'Kaputt.' }] }, { adapter }), /unknown phonemes/);
  await assert.rejects(readFile(join(dir, '.explainery/voice/film/manifest.json')), { code: 'ENOENT' });
});

test('Martin refuses audio whose retained provenance hash disagrees before publishing a voice manifest', async t => {
  const { dir, options } = await fixture(t);
  await writeFile(options.model, 'bad-hash');
  await assert.rejects(generateVoice(dir, story, { adapter: await createMartinAdapter(options) }), /does not match/);
  await assert.rejects(readFile(join(dir, '.explainery/voice/film/manifest.json')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(options.provenanceDir), []);
});

test('Martin refuses synthesis whose assets or runtime changed after the identity probe', async t => {
  for (const change of ['model', 'runtime']) {
    const { dir, options } = await fixture(t);
    const adapter = await createMartinAdapter(options);
    await writeFile(change === 'model' ? options.model : join(dir, 'runtime-changed'), 'changed');
    await assert.rejects(generateVoice(dir, story, { adapter }), /identity changed/);
    await assert.rejects(readFile(join(dir, '.explainery/voice/film/manifest.json')), { code: 'ENOENT' });
  }
});
