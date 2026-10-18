import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateVoice, splitVoiceText, voiceCommandError } from '../src/voice.ts';
import type { Story } from '../src/types.ts';
import type { VoiceAdapter } from '../src/voice.ts';

function wav(seconds = 1): Buffer {
  const data = Buffer.alloc(Math.round(seconds * 24000) * 2, 1);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const story: Story = {
  id: 'example', title: 'Example', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  pronunciations: { SQL: 'sequel' },
  scenes: [
    { id: 'first', copy: { headline: 'First' }, narration: '{begin} Query SQL.', hold: 1, overlap: 0.25 },
    { id: 'second', copy: { headline: 'Second' }, narration: '{end} Read the result.' },
  ],
};

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-voice-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls: string[] = [];
  const adapter: VoiceAdapter = { version: 'test-engine', synthesize: async text => { calls.push(text); return wav(); } };
  return { dir, calls, adapter };
}

test('voice measures composition offsets including holds, overlaps and gaps and preserves canonical script', async t => {
  const { dir, calls, adapter } = await fixture(t);
  const before = structuredClone(story);
  const manifest = await generateVoice(dir, story, { adapter });
  assert.deepEqual(calls, ['Query sequel.', 'Read the result.']);
  assert.deepEqual(story, before);
  assert.deepEqual(manifest.segments.map(({ id, start, end }) => ({ id, start, end })), [
    { id: 'first', start: 0.25, end: 1.25 }, { id: 'second', start: 2.4, end: 3.4 },
  ]);
  assert.equal(manifest.duration, 3.65);
  assert.equal((await readFile(join(dir, manifest.audio))).length, 44 + 3.65 * 48000);
  assert.match(manifest.audioSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(manifest.scriptHash, manifest.voiceInputHash);
});

test('voice reuses matching audio and invalidates only affected content or synthesis settings', async t => {
  const { dir, calls, adapter } = await fixture(t);
  const first = await generateVoice(dir, story, { adapter });
  assert.deepEqual(await generateVoice(dir, story, { adapter }), first);
  assert.equal(calls.length, 2);
  await generateVoice(dir, story, { adapter, gap: 0.7 });
  assert.equal(calls.length, 2);
  const changed = structuredClone(story);
  changed.pronunciations = { SQL: 'ess cue ell' };
  await generateVoice(dir, changed, { adapter });
  assert.equal(calls.length, 3);
  await generateVoice(dir, changed, { adapter, speed: 0.9 });
  assert.equal(calls.length, 5);
  await generateVoice(dir, changed, { adapter: { ...adapter, version: 'new-engine' }, speed: 0.9 });
  assert.equal(calls.length, 7);
});

test('voice detects damaged cached bytes and synthesizes the affected composition again', async t => {
  const { dir, calls, adapter } = await fixture(t);
  const manifest = await generateVoice(dir, story, { adapter });
  await writeFile(join(dir, manifest.segments[0].audio), wav(0.5));
  await generateVoice(dir, story, { adapter });
  assert.equal(calls.length, 3);
});

test('sample synthesis is isolated from film output and reuses the same composition cache', async t => {
  const { dir, calls, adapter } = await fixture(t);
  const sample = await generateVoice(dir, story, { adapter, sample: 'second' });
  assert.equal(sample.sample, 'second');
  assert.deepEqual(calls, ['Read the result.']);
  assert.deepEqual(sample.segments.map(segment => segment.id), ['second']);
  await assert.rejects(readFile(join(dir, '.explainery/voice/film/manifest.json')), { code: 'ENOENT' });
  const film = await generateVoice(dir, story, { adapter });
  assert.equal(calls.length, 2);
  assert.notEqual(sample.audio, film.audio);
  assert.equal(JSON.parse(await readFile(join(dir, '.explainery/voice/samples/second/manifest.json'), 'utf8')).audioSha256, sample.audioSha256);
  await assert.rejects(generateVoice(dir, story, { adapter, sample: 'unknown' }), /unknown composition/);
});

test('story voice settings apply when no option names them, and options override them one by one', async t => {
  const { dir, adapter } = await fixture(t);
  const paced: Story = { ...story, voice: { name: 'bf_emma', speed: 0.9, gap: 0.6 } };
  assert.deepEqual((await generateVoice(dir, paced, { adapter })).settings, { voice: 'bf_emma', lang: 'en-gb', speed: 0.9, gap: 0.6 });
  assert.deepEqual((await generateVoice(dir, paced, { adapter, speed: 1.1, gap: 0 })).settings, { voice: 'bf_emma', lang: 'en-gb', speed: 1.1, gap: 0 });
  assert.deepEqual((await generateVoice(dir, paced, { adapter, voice: 'af_heart' })).settings, { voice: 'af_heart', lang: 'en-us', speed: 0.9, gap: 0.6 });
});

test('an explicit output keeps its manifest beside the audio and leaves the default film manifest alone', async t => {
  const { dir, adapter } = await fixture(t);
  const manifest = await generateVoice(dir, story, { adapter, out: 'assets/narration.wav' });
  assert.equal(manifest.audio, 'assets/narration.wav');
  assert.equal(manifest.manifestFile, 'assets/narration.wav.voice.json');
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'assets/narration.wav.voice.json'), 'utf8')), manifest);
  await assert.rejects(readFile(join(dir, '.explainery/voice/film/manifest.json')), { code: 'ENOENT' });
  assert.equal((await generateVoice(dir, story, { adapter })).manifestFile, '.explainery/voice/film/manifest.json');
});

test('chunking preserves all words and bounds long text, including a single oversized token', () => {
  for (const text of ['A sentence. '.repeat(200), 'x'.repeat(1200), '🙂'.repeat(700)]) {
    const chunks = splitVoiceText(text);
    assert.ok(chunks.every(chunk => [...chunk].length <= 300 && chunk.length > 0));
    assert.equal(chunks.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  }
});

test('token overflow retries smaller chunks without swallowing unrelated engine errors', async t => {
  const { dir, adapter } = await fixture(t);
  const calls: string[] = [];
  const limited: VoiceAdapter = { ...adapter, synthesize: async text => {
    calls.push(text);
    if (text.length > 10) throw new Error('index 511 is out of bounds for axis 0 with size 510');
    return wav(0.1);
  } };
  const result = await generateVoice(dir, story, { adapter: limited, sample: 'second' });
  assert.ok(calls.length > 1);
  assert.ok(result.segments[0].end > result.segments[0].start);
  await assert.rejects(generateVoice(dir, story, { adapter: { version: 'broken', synthesize: async () => { throw new Error('missing model'); } } }), /missing model/);
});

test('voice rejects invalid settings and invalid PCM before publishing a manifest', async t => {
  const { dir, adapter } = await fixture(t);
  for (const options of [{ speed: 0 }, { speed: NaN }, { gap: -1 }, { lang: 'unknown' }]) {
    await assert.rejects(generateVoice(dir, story, { adapter, ...options }));
  }
  await assert.rejects(generateVoice(dir, story, { adapter: { ...adapter, synthesize: async () => Buffer.from('bad') } }), /WAV/);
  await assert.rejects(readFile(join(dir, '.explainery/voice/film/manifest.json')), { code: 'ENOENT' });
});

test('voice command failures preserve the CLI JSON reason and process termination evidence', () => {
  const cause = Object.assign(new Error('Command failed'), {
    stdout: 'initialization\n{"ok":false,"error":"model file is unreadable"}\n', stderr: 'python diagnostic',
    code: 1, killed: false, signal: null,
  });
  const failure = voiceCommandError(cause);
  assert.match(failure.message, /model file is unreadable/);
  assert.match(failure.message, /python diagnostic/);
  assert.match(failure.message, /code=1/);
  assert.equal(failure.cause, cause);
  const stopped = voiceCommandError(Object.assign(new Error('Command failed'), { stdout: '', stderr: '', killed: true, signal: 'SIGTERM', code: null }));
  assert.match(stopped.message, /killed=true/);
  assert.match(stopped.message, /signal=SIGTERM/);
  assert.match(stopped.message, /60000ms/);
});

test('voice command failures keep non-JSON output and token overflow details available for retry', () => {
  const failure = voiceCommandError(Object.assign(new Error('Command failed'), { stdout: 'index 511 is out of bounds for axis 0 with size 510', stderr: '' }));
  assert.match(failure.message, /index 511 is out of bounds for axis 0 with size 510/);
  assert.match(voiceCommandError(new Error('spawn ENOENT')).message, /spawn ENOENT/);
  assert.match(voiceCommandError('unexpected rejection').message, /unexpected rejection/);
});
