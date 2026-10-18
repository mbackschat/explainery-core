import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { alignTiming, checkTiming, validateStoryTiming, type Composition, type Story, type TranscriptWord } from '../src/index.ts';

const scene = (id: string, narration: string, extra: Partial<Composition> = {}): Composition => ({ id, copy: { headline: id }, narration, ...extra });
const story = (...scenes: Composition[]): Story => ({ id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, scenes });

// One word every half second, each spoken for 0.4 s, starting at `from`.
const spoken = (text: string, from: number): TranscriptWord[] => text.split(' ').map((word, index) => ({ text: word, start: from + index * 0.5, end: from + index * 0.5 + 0.4 }));

const garden = story(
  scene('seed', 'Every garden starts small. {plant} Plant one seed {grow} and it grows. {sprout}', { overlap: 0.5 }),
  scene('harvest', '{pick} Then you pick the fruit.', { hold: 1 }),
);
const gardenWords = [...spoken('Every garden starts small. Plant one seed and it grows.', 0.3), ...spoken('Then you pick the fruit.', 6)];

test('the alignment report lists each composition\'s words on its own clock, with the beat each falls in', async () => {
  const { alignTimingWithReport } = await import('../src/align.ts');
  const { compositions } = alignTimingWithReport(garden, gardenWords, { audio: 'a.wav' });
  assert.deepEqual(compositions.seed, [
    { text: 'Every', start: .3, end: .7 }, { text: 'garden', start: .8, end: 1.2 }, { text: 'starts', start: 1.3, end: 1.7 }, { text: 'small.', start: 1.8, end: 2.2 },
    { text: 'Plant', start: 2.3, end: 2.7, beat: 'plant', offset: 0 }, { text: 'one', start: 2.8, end: 3.2, beat: 'plant', offset: .5 }, { text: 'seed', start: 3.3, end: 3.7, beat: 'plant', offset: 1 },
    { text: 'and', start: 3.8, end: 4.2, beat: 'grow', offset: 0 }, { text: 'it', start: 4.3, end: 4.7, beat: 'grow', offset: .5 }, { text: 'grows.', start: 4.8, end: 5.2, beat: 'grow', offset: 1 },
  ]);
  // harvest starts its overlap early, at film second 4.7, so its first word at film second 6 is local second 1.3.
  assert.deepEqual(compositions.harvest[0], { text: 'Then', start: 1.3, end: 1.7, beat: 'pick', offset: 0 });
  assert.equal(compositions.harvest.length, 5);
});

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
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.explainery/alignment.json'), 'utf8')), {
    diagnostics: [],
    compositions: { intro: [
      { text: 'Say', start: .2, end: .6 }, { text: 'hello', start: .7, end: 1.1 },
      { text: 'to', start: 1.2, end: 1.6, beat: 'wave', offset: 0 }, { text: 'everyone.', start: 1.7, end: 2.1, beat: 'wave', offset: .5 },
    ] },
  });
});

test('a word that whisper stretches across the following pause ends where the pause begins', () => {
  const long = story(scene('seed', 'Every garden starts small.', { hold: 2 }), scene('harvest', '{pick} Then you pick the fruit.'));
  const words = [...spoken('Every garden starts small.', 0), ...spoken('Then you pick the fruit.', 4.5)];
  words[3] = { ...words[3], end: 4.4 };
  const timing = alignTiming(long, words, { audio: 'a.wav', silences: [{ start: 1.9, end: 4.5 }] });
  assert.equal(timing.scenes.seed.duration, 3.9);
  assert.equal(timing.scenes.harvest.start, 3.9);
});

test('the align command finds the pauses in the audio itself', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-align-'));
  await writeFile(join(dir, 'story.yaml'), [
    'id: pauses', 'title: Pauses', 'theme: dark', 'canvas: { width: 1920, height: 1080, fps: 30 }', 'scenes:',
    '  - id: one', '    copy: { headline: One }', '    narration: "Say hello."', '    hold: 1',
    '  - id: two', '    copy: { headline: Two }', '    narration: "{wave} Wave back."', '',
  ].join('\n'));
  // A tone for each scene's words, with 1.5 s of silence between them; whisper stretches "hello." across that silence.
  await writeFile(join(dir, 'transcript.json'), JSON.stringify([
    { text: 'Say', start: 0, end: 0.4 }, { text: 'hello.', start: 0.5, end: 2.4 },
    { text: 'Wave', start: 2.5, end: 2.9 }, { text: 'back.', start: 3, end: 3.4 },
  ]));
  await mkdir(join(dir, 'assets'));
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.5', '-f', 'lavfi', '-i', 'sine=f=440:d=1',
    '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', join(dir, 'assets/narration.wav')]);
  await run(process.execPath, [cli, 'align', dir, '--audio', 'assets/narration.wav', '--transcript', join(dir, 'transcript.json')]);
  const timing = JSON.parse(await readFile(join(dir, 'timing.json'), 'utf8'));
  assert.equal(timing.scenes.one.duration, 2);
  assert.equal(timing.scenes.two.start, 2);
});

test('words that whisper drifts into a pause are fitted back before it, keeping their order', () => {
  const long = story(scene('seed', 'Every garden starts {small} small.', { hold: 2 }), scene('harvest', '{pick} Then you pick the fruit.'));
  const words = [...spoken('Every garden starts small.', 0), ...spoken('Then you pick the fruit.', 4.5)];
  words[2] = { ...words[2], end: 2.4 };
  words[3] = { ...words[3], start: 2.5, end: 4.3 };
  const timing = alignTiming(long, words, { audio: 'a.wav', silences: [{ start: 1.9, end: 4.5 }] });
  assert.equal(timing.scenes.seed.duration, 3.9);
  const small = timing.scenes.seed.beats.small;
  assert.ok(small > 1 && small < 1.9, `small starts at ${small}`);
});


test('spoken input maps pronunciation expansions onto canonical words and beat timestamps', async () => {
  const { alignStoryWords, alignTimingWithReport } = await import('../src/align.ts');
  const film = story(scene('one', '{api} API {next} stores JSON. {done}'));
  film.pronunciations = { API: 'A P I', JSON: 'jay son' };
  const transcript = spoken('A P I stores jay son.', 1);
  const options = { transcriptMode: 'spoken' as const };
  const aligned = alignStoryWords(film, transcript, options);
  assert.deepEqual(aligned.words, [
    { text: 'API', start: 1, end: 2.4 }, { text: 'stores', start: 2.5, end: 2.9 }, { text: 'JSON.', start: 3, end: 3.9 },
  ]);
  assert.deepEqual(alignTimingWithReport(film, transcript, { audio: 'a.wav', ...options }), {
    timing: { source: 'aligned', audio: 'a.wav', duration: 3.9, scenes: { one: { start: 0, duration: 3.9, beats: { api: 1, next: 2.5, done: 3.9 } } } }, diagnostics: [],
    compositions: { one: [
      { text: 'API', start: 1, end: 2.4, beat: 'api', offset: 0 }, { text: 'stores', start: 2.5, end: 2.9, beat: 'next', offset: 0 }, { text: 'JSON.', start: 3, end: 3.9, beat: 'next', offset: .5 },
    ] },
  });
  assert.deepEqual(alignStoryWords(film, spoken('API stores JSON.', 0)).words.map(word => word.text), ['API', 'stores', 'JSON.']);
});

test('known audio segments bound missing edge words and report inferred opening and closing beats', async () => {
  const { alignTimingWithReport, alignStoryWords } = await import('../src/align.ts');
  const film = story(scene('one', 'One two three {last} missing. {close}'), scene('two', '{first} Missing four five six.'));
  const transcript = [...spoken('One two three', 0), ...spoken('four five six.', 10.5)];
  const segments = [{ id: 'one', start: 0, end: 2 }, { id: 'two', start: 10, end: 12 }];
  const aligned = alignStoryWords(film, transcript, { segments });
  assert.deepEqual(aligned.words[3], { text: 'missing.', start: 1.4, end: 2 });
  assert.deepEqual(aligned.words[4], { text: 'Missing', start: 10, end: 10.5 });
  const report = alignTimingWithReport(film, transcript, { audio: 'a.wav', segments });
  assert.deepEqual(report.diagnostics, [
    { compositionId: 'one', beat: 'last', time: 1.4, reason: 'inferred-word' },
    { compositionId: 'one', beat: 'close', time: 2, reason: 'inferred-word' },
    { compositionId: 'two', beat: 'first', time: 8, reason: 'inferred-word' },
  ]);
  assert.deepEqual(report.compositions.one[3], { text: 'missing.', start: 1.4, end: 2, beat: 'last', offset: 0, inferred: true });
  assert.deepEqual(report.compositions.two[0], { text: 'Missing', start: 8, end: 8.5, beat: 'first', offset: 0, inferred: true });
});

test('known segments prevent matching repeated narration to a different composition', async () => {
  const { alignStoryWords } = await import('../src/align.ts');
  const film = story(scene('one', 'We use four words.'), scene('two', 'We use four words.'));
  assert.throws(() => alignStoryWords(film, [...spoken('We use four words.', 0), ...spoken('We use four words.', 3)], {
    segments: [{ id: 'one', start: 0, end: 5 }, { id: 'two', start: 10, end: 15 }],
  }), /scene "two".*matches only 0/);
});

test('audio segments require complete ordered non-overlapping composition coverage', async () => {
  const { alignStoryWords } = await import('../src/align.ts');
  for (const segments of [[], [{ id: 'wrong', start: 0, end: 10 }], [{ id: 'seed', start: 0, end: 10 }, { id: 'harvest', start: 9, end: 12 }], [{ id: 'seed', start: 0, end: NaN }, { id: 'harvest', start: 10, end: 12 }]]) {
    assert.throws(() => alignStoryWords(garden, gardenWords, { segments }), /segments/);
  }
});


test('spoken aliases retain punctuation, joined recognition words and multi-word canonical phrases', async () => {
  const { alignStoryWords } = await import('../src/align.ts');
  const film = story(scene('one', 'Data Store uses SQL.'));
  film.pronunciations = { 'Data Store': 'repository', SQL: 'S-Q-L' };
  const aligned = alignStoryWords(film, spoken('repository uses S Q L.', 0), { transcriptMode: 'spoken' });
  assert.deepEqual(aligned.words.map(word => word.text), ['Data', 'Store', 'uses', 'SQL.']);
  assert.equal(aligned.words[0].start, 0);
  assert.equal(aligned.words[1].end, .4);
  assert.equal(aligned.words[2].start, .5);
  assert.equal(aligned.words[3].start, 1);
  assert.ok(Math.abs(aligned.words[3].end - 2.4) < 1e-9);
  assert.ok(aligned.words.every((word, index) => word.end >= word.start && (!index || word.start >= aligned.words[index - 1].end)));
});

test('known segment ends clip recognition drift without consuming the next composition', async () => {
  const { alignStoryWords } = await import('../src/align.ts');
  const film = story(scene('one', 'Hello.'), scene('two', 'Goodbye.'));
  const aligned = alignStoryWords(film, [{ text: 'Hello.', start: 0, end: 4 }, { text: 'Goodbye.', start: 5, end: 7 }], {
    segments: [{ id: 'one', start: 0, end: 2 }, { id: 'two', start: 5, end: 6 }],
  });
  assert.deepEqual(aligned.words, [{ text: 'Hello.', start: 0, end: 2 }, { text: 'Goodbye.', start: 5, end: 6 }]);
});


test('beats beside punctuation align canonical and expanded transcripts to the same word', () => {
  const film = story(scene('one', 'API {next}, stores data {done}.'));
  film.pronunciations = { API: 'A P I' };
  const canonical = alignTiming(film, spoken('API, stores data.', 0), { audio: 'a.wav' });
  const expanded = alignTiming(film, spoken('A P I, stores data.', 0), { audio: 'a.wav', transcriptMode: 'spoken' });
  assert.deepEqual(canonical.scenes.one.beats, { next: .5, done: 1.4 });
  assert.deepEqual(expanded.scenes.one.beats, { next: 1.5, done: 2.4 });
});

test('spoken aliases never span composition boundaries during full-transcript matching', async () => {
  const { alignStoryWords } = await import('../src/align.ts');
  const film = story(scene('one', 'Data'), scene('two', 'Store.'));
  film.pronunciations = { 'Data Store': 'repository' };
  assert.deepEqual(alignStoryWords(film, spoken('Data Store.', 0), { transcriptMode: 'spoken' }), {
    words: spoken('Data Store.', 0), inferred: [false, false],
  });
});

test('shared story alignment rejects malformed or unordered transcript timestamps', async () => {
  const { alignStoryWords } = await import('../src/align.ts');
  const film = story(scene('one', 'One two.'));
  const valid = spoken('One two.', 0);
  const invalid = [
    [{ ...valid[0], start: Number.NaN }, valid[1]],
    [{ ...valid[0], start: -1 }, valid[1]],
    [valid[0], { ...valid[1], end: Infinity }],
    [{ ...valid[0], end: -1 }, valid[1]],
    [{ ...valid[0], end: 1 }, valid[1]],
    [{ ...valid[0], text: '' }, valid[1]],
    [],
  ];
  for (const transcript of invalid) {
    assert.throws(() => alignStoryWords(film, transcript), {
      message: 'transcript must contain ordered, non-overlapping words with finite, nonnegative timestamps',
    });
  }
});
