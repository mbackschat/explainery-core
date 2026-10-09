import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { alignTiming, checkTiming, validateStoryTiming, type Scene, type Story, type TranscriptWord } from '../src/index.ts';

const scene = (id: string, narration: string, extra: Partial<Scene> = {}): Scene => ({ id, copy: { headline: id }, narration, ...extra });
const story = (...scenes: Scene[]): Story => ({ id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, scenes });

// One word every half second, each spoken for 0.4 s, starting at `from`.
const spoken = (text: string, from: number): TranscriptWord[] => text.split(' ').map((word, index) => ({ text: word, start: from + index * 0.5, end: from + index * 0.5 + 0.4 }));

const garden = story(
  scene('seed', 'Every garden starts small. {plant} Plant one seed {grow} and it grows. {sprout}', { overlap: 0.5 }),
  scene('harvest', '{pick} Then you pick the fruit.', { hold: 1 }),
);
const gardenWords = [...spoken('Every garden starts small. Plant one seed and it grows.', 0.3), ...spoken('Then you pick the fruit.', 6)];

test('a beat falls where the word after its marker starts, and a closing beat where the last word ends', () => {
  const timing = alignTiming(garden, gardenWords, { audio: 'assets/narration.wav' });
  assert.deepEqual(timing.scenes.seed.beats, { plant: 2.3, grow: 3.8, sprout: 5.2 });
});

test('a scene ends its hold after its last word, and the next starts its overlap earlier', () => {
  const timing = alignTiming(garden, gardenWords, { audio: 'assets/narration.wav' });
  assert.deepEqual(timing, {
    source: 'aligned',
    audio: 'assets/narration.wav',
    duration: 9.4,
    scenes: {
      seed: { start: 0, duration: 5.2, beats: { plant: 2.3, grow: 3.8, sprout: 5.2 } },
      harvest: { start: 4.7, duration: 4.7, beats: { pick: 1.3 } },
    },
  });
});

test('the audio length is kept beside the audio, so the narration track can end with it', () => {
  const timing = alignTiming(garden, gardenWords, { audio: 'assets/narration.wav', audioDuration: 8.6 });
  assert.equal(timing.audio, 'assets/narration.wav');
  assert.equal(timing.audioDuration, 8.6);
  assert.equal(timing.duration, 9.4);
});

test('misheard words still align, and a beat before one falls between its recognised neighbours', () => {
  const misheard = gardenWords.map(word => (word.text === 'Plant' ? { ...word, text: 'Plans' } : word));
  assert.equal(alignTiming(garden, misheard, { audio: 'a.wav' }).scenes.seed.beats.plant, 2.2);
});

test('a transcript of different words fails instead of producing timing', () => {
  assert.throws(
    () => alignTiming(garden, spoken('Something else entirely was said here today friend.', 0), { audio: 'a.wav' }),
    /the transcript matches only 0 of 15 narration words; does the audio speak this story's narration\?/,
  );
});

test('a hold longer than the pause before the next narration fails, naming both scenes', () => {
  const long = story(scene('seed', 'Every garden starts small.', { hold: 2 }), scene('harvest', '{pick} Then you pick the fruit.'));
  assert.throws(
    () => alignTiming(long, [...spoken('Every garden starts small.', 0), ...spoken('Then you pick the fruit.', 2.5)], { audio: 'a.wav' }),
    /scene "harvest": its narration starts at 2.5s, before the scene starts at 3.9s; shorten the hold or overlap of "seed"/,
  );
});

test('aligned timing is valid timing for its story', () => {
  const timing = alignTiming(garden, gardenWords, { audio: 'assets/narration.wav' });
  assert.deepEqual(checkTiming(timing), []);
  assert.deepEqual(validateStoryTiming(garden, timing), []);
});

const storyYaml = `id: demo
title: Demo
theme: dark
canvas: { width: 1920, height: 1080, fps: 30 }
scenes:
  - id: intro
    copy: { headline: Hello }
    narration: Say hello {wave} to everyone.
`;

const run = promisify(execFile);
const cli = new URL('../bin/explainery.ts', import.meta.url).pathname;

test('the align command writes aligned timing from a transcript, but never replaces imported timing unless forced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-align-'));
  await writeFile(join(dir, 'story.yaml'), storyYaml);
  await writeFile(join(dir, 'transcript.json'), JSON.stringify(spoken('Say hello to everyone.', 0.2)));
  await mkdir(join(dir, 'assets'));
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1.9', join(dir, 'assets/narration.wav')]);
  const imported = { source: 'imported', duration: 3, scenes: { intro: { start: 0, duration: 3, beats: { wave: 1 } } } };
  await writeFile(join(dir, 'timing.json'), JSON.stringify(imported));
  const args = [cli, 'align', dir, '--audio', 'assets/narration.wav', '--transcript', join(dir, 'transcript.json')];
  await assert.rejects(run(process.execPath, args), (error: { code: number; stderr: string }) => error.code === 1 && error.stderr.includes('timing.json is imported; pass --force to replace it'));
  const { stdout } = await run(process.execPath, [...args, '--force']);
  assert.match(stdout, /Aligned 1 scene to assets\/narration.wav, 2.1s/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8')), {
    source: 'aligned', audio: 'assets/narration.wav', audioDuration: 1.9, duration: 2.1, scenes: { intro: { start: 0, duration: 2.1, beats: { wave: 1.2 } } },
  });
});
