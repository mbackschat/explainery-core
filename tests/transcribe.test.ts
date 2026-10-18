import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { alignStoryWords, type TranscriptWord } from '../src/align.ts';
import { transcribeSegments, type RecognitionAdapter } from '../src/transcribe.ts';
import { spokenWords } from '../src/narration.ts';
import { storyCompositions } from '../src/story.ts';
import { generateVoice, type VoiceAdapter, type VoiceManifest } from '../src/voice.ts';
import type { Story } from '../src/types.ts';

// One second of mono 24 kHz PCM16 per call; the sample value derives from the text so different clips hash differently.
function wav(text: string): Buffer {
  const data = Buffer.alloc(24000 * 2, [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 250 + 1);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const story: Story = {
  id: 'example', title: 'Example', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    { id: 'first', copy: { headline: 'First' }, narration: '{begin} Query the table.', hold: 1, overlap: 0.25 },
    { id: 'second', copy: { headline: 'Second' }, narration: '{end} Read the result.' },
  ],
};

const voiceAdapter: VoiceAdapter = { version: 'test-engine', synthesize: async text => wav(text) };

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-transcribe-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls: string[] = [];
  // Recognizes a clip as its composition's words at clip-local times, finding the composition through the manifest.
  const recognizer = (manifest: VoiceManifest, current: Story, version = 'test-recognizer'): RecognitionAdapter => ({
    version,
    async transcribe(projectDir, audio) {
      assert.equal(projectDir, dir);
      calls.push(audio);
      const id = manifest.segments.find(segment => segment.audio === audio)!.id;
      const words = spokenWords(storyCompositions(current).find(composition => composition.id === id)!.narration).words;
      return words.map((text, index): TranscriptWord => ({ text, start: 0.1 + index * 0.2, end: 0.25 + index * 0.2 }));
    },
  });
  return { dir, calls, recognizer };
}

test('each clip is recognized separately and shifted onto the film clock by its segment start', async t => {
  const { dir, calls, recognizer } = await fixture(t);
  const manifest = await generateVoice(dir, story, { adapter: voiceAdapter });
  const result = await transcribeSegments(dir, manifest, { adapter: recognizer(manifest, story) });
  assert.deepEqual(calls, manifest.segments.map(segment => segment.audio));
  assert.deepEqual(result.recognized, ['first', 'second']);
  assert.deepEqual(result.words.slice(0, 2), [{ text: 'Query', start: 0.35, end: 0.5 }, { text: 'the', start: 0.55, end: 0.7 }]);
  assert.deepEqual(result.words[3], { text: 'Read', start: 2.5, end: 2.65 });
  // The combined transcript is what `align --transcript --segments` consumes.
  assert.equal(alignStoryWords(story, result.words, { segments: manifest.segments }).words.length, 6);
});

test('recognition is cached by clip hash, so re-voicing one composition re-recognizes only its clip', async t => {
  const { dir, calls, recognizer } = await fixture(t);
  const manifest = await generateVoice(dir, story, { adapter: voiceAdapter });
  const first = await transcribeSegments(dir, manifest, { adapter: recognizer(manifest, story) });
  assert.deepEqual(await transcribeSegments(dir, manifest, { adapter: recognizer(manifest, story) }), { ...first, recognized: [] });
  assert.equal(calls.length, 2);
  const revised = structuredClone(story);
  (revised.scenes[1] as { narration: string }).narration = '{end} Read the final result.';
  const revoiced = await generateVoice(dir, revised, { adapter: voiceAdapter });
  const result = await transcribeSegments(dir, revoiced, { adapter: recognizer(revoiced, revised) });
  assert.deepEqual(result.recognized, ['second']);
  assert.equal(calls.length, 3);
  assert.deepEqual(result.words.slice(3).map(word => word.text), ['Read', 'the', 'final', 'result.']);
});

test('a changed recognizer recognizes cached clips again', async t => {
  const { dir, calls, recognizer } = await fixture(t);
  const manifest = await generateVoice(dir, story, { adapter: voiceAdapter });
  await transcribeSegments(dir, manifest, { adapter: recognizer(manifest, story) });
  await transcribeSegments(dir, manifest, { adapter: recognizer(manifest, story, 'upgraded-recognizer') });
  assert.equal(calls.length, 4);
});

test('a word reported past its clip ends with its segment, keeping the transcript ordered for alignment', async t => {
  const { dir } = await fixture(t);
  const adjacent: Story = { ...story, voice: { gap: 0 }, scenes: [
    { id: 'first', copy: { headline: 'First' }, narration: 'Query the table.' },
    { id: 'second', copy: { headline: 'Second' }, narration: 'Read the result.' },
  ] };
  const manifest = await generateVoice(dir, adjacent, { adapter: voiceAdapter });
  assert.equal(manifest.segments[0].end, manifest.segments[1].start);
  const late: RecognitionAdapter = { version: 'late', transcribe: async () => [{ text: 'word', start: 0.9, end: 1.2 }] };
  const { words } = await transcribeSegments(dir, manifest, { adapter: late });
  assert.deepEqual(words, [{ text: 'word', start: 1.15, end: 1.25 }, { text: 'word', start: 2.15, end: 2.25 }]);
});

test('a clip whose bytes no longer match the manifest is refused instead of recognized', async t => {
  const { dir, calls, recognizer } = await fixture(t);
  const manifest = await generateVoice(dir, story, { adapter: voiceAdapter });
  await writeFile(join(dir, manifest.segments[1].audio), wav('other text'));
  await assert.rejects(transcribeSegments(dir, manifest, { adapter: recognizer(manifest, story) }), /"second".*voice/);
  assert.equal(calls.length, 1);
  const bare = { segments: [{ id: 'first', start: 0, end: 1 }] } as unknown as VoiceManifest;
  await assert.rejects(transcribeSegments(dir, bare, { adapter: recognizer(manifest, story) }), /voice manifest/);
});
