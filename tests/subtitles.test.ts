import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { subtitleCues, formatSubtitles } from '../src/subtitles.ts';
import { storyCompositions } from '../src/story.ts';
import type { Story } from '../src/types.ts';
import type { TranscriptWord } from '../src/align.ts';

const story = (narration: string): Story => ({ id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, scenes: [{ id: 'intro', copy: { headline: 'Hello' }, narration }] });
const words = (text: string, from = 0): TranscriptWord[] => text.split(' ').map((text, i) => ({ text, start: from + i * .4, end: from + i * .4 + .3 }));

test('subtitles preserve the script, not recognition mistakes, markers or TTS spellings', () => {
  const film = story('{start} The API keeps each object unchanged.');
  film.pronunciations = { API: 'A-P-I' };
  const cues = subtitleCues(film, words('the api keeps each objects unchanged.'), { duration: 3 });
  assert.equal(cues.map(c => c.text).join(' ').replace(/\s+/g, ' '), 'The API keeps each object unchanged.');
  assert.equal(cues[0].start, 0);
  assert.ok(cues.at(-1)!.end <= 3);
});

test('cue boundaries respect compositions, sentence ends, long pauses and two-line width', () => {
  const first = 'These individually addressed documents retain their original identity when the surrounding collection changes. Another short sentence.';
  const second = 'We continue after a pause with another explanation.';
  const film = story(first);
  film.scenes.push({ id: 'chapter', title: 'Chapter', compositions: [{ id: 'next', copy: { headline: 'Next' }, narration: second }] });
  const transcript = [...words(first), ...words(second, 12)];
  const cues = subtitleCues(film, transcript, { duration: 20 });
  assert.equal(cues.map(c => c.text).join(' ').replace(/\s+/g, ' '), first + ' ' + second);
  assert.ok(cues.some(c => c.text.includes('Another short sentence.')));
  for (const [i, cue] of cues.entries()) {
    assert.ok(cue.end > cue.start && cue.end - cue.start <= 6);
    assert.ok(cue.text.split('\n').length <= 2);
    assert.ok(cue.text.split('\n').every(line => line.length <= 42));
    if (i) assert.ok(cue.start >= cues[i - 1].end);
    assert.ok(cue.end < 12 || cue.start >= 12);
  }
});

test('the same composition clears subtitles during a long speech pause', () => {
  const cues = subtitleCues(story('We wait and then continue.'), [...words('We wait'), ...words('and then continue.', 5)], { duration: 7 });
  assert.equal(cues.length, 2);
  assert.ok(cues[0].end < 2);
  assert.equal(cues[1].start, 5);
});

test('invalid or unrelated transcripts and impossible timing fail before serializing', () => {
  const film = story('The little garden grows.');
  assert.throws(() => subtitleCues(film, words('Something else entirely happened.'), { duration: 4 }), /transcript matches/);
  for (const transcript of [null, [{ text: 'The', start: -1, end: 1 }], [{ text: 'The', start: 2, end: 1 }]]) {
    assert.throws(() => subtitleCues(film, transcript as unknown as TranscriptWord[], { duration: 4 }), /transcript/i);
  }
  assert.throws(() => subtitleCues(film, words('The little garden grows.'), { duration: .5 }), /duration/);
  assert.throws(() => subtitleCues(story('x'.repeat(43)), words('x'.repeat(43)), { duration: 1 }), /42/);
});

test('formats share cues, round milliseconds with carry, and escape literal WebVTT markup', () => {
  const cues = [{ start: 59.9996, end: 62.125, text: 'A < B & C\nremains true.' }];
  assert.equal(formatSubtitles(cues, 'srt'), '1\n00:01:00,000 --> 00:01:02,125\nA &lt; B &amp; C\nremains true.\n');
  assert.equal(formatSubtitles(cues, 'vtt'), 'WEBVTT\n\n1\n00:01:00.000 --> 00:01:02.125\nA &lt; B &amp; C\nremains true.\n');
});

test('the CLI exports both formats without changing film timing, picture or focus', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-subtitles-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const film = story('Say hello to everyone.');
  const timing = JSON.stringify({ source: 'imported', audio: 'voice.wav', duration: 3, scenes: { intro: { start: 0, duration: 3, beats: {} } } });
  await writeFile(join(dir, 'story.yaml'), JSON.stringify(film));
  await writeFile(join(dir, 'timing.json'), timing);
  await writeFile(join(dir, 'index.html'), '<!-- existing picture -->');
  await mkdir(join(dir, '.explainery'));
  await writeFile(join(dir, '.explainery/focus.json'), '{"sceneId":"intro"}');
  await writeFile(join(dir, 'transcript.json'), JSON.stringify(words(storyCompositions(film)[0].narration)));
  const run = promisify(execFile);
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=d=2', join(dir, 'voice.wav')], { timeout: 10000 });
  const cli = new URL('../bin/explainery.ts', import.meta.url).pathname;
  const { stdout } = await run(process.execPath, [cli, 'subtitles', dir, '--transcript', join(dir, 'transcript.json')], { cwd: dir, timeout: 15000 });
  assert.match(stdout, /subtitles/);
  const srt = await readFile(join(dir, 'renders/demo-full.srt'), 'utf8');
  const vtt = await readFile(join(dir, 'renders/demo-full.vtt'), 'utf8');
  assert.ok(srt.includes('Say hello to everyone.'));
  assert.ok(vtt.startsWith('WEBVTT\n\n'));
  assert.equal(await readFile(join(dir, 'timing.json'), 'utf8'), timing);
  assert.equal(await readFile(join(dir, 'index.html'), 'utf8'), '<!-- existing picture -->');
  assert.equal(await readFile(join(dir, '.explainery/focus.json'), 'utf8'), '{"sceneId":"intro"}');
  await assert.rejects(run(process.execPath, [cli, 'subtitles', dir, '--scene', 'intro']), /subtitles always use the full-film clock/);
});

test('compound terms keep their spoken span when recognition splits or merges words', () => {
  const film = story('We use DataStore. Blue sky.');
  const transcript = [
    { text: 'We', start: 0, end: .2 }, { text: 'use', start: .2, end: .5 },
    { text: 'Data', start: 2, end: 2.5 }, { text: 'Store.', start: 2.5, end: 3 },
    { text: 'Bluesky.', start: 5, end: 6 },
  ];
  const cues = subtitleCues(film, transcript, { duration: 7 });
  assert.equal(cues.map(c => c.text).join(' ').replace(/\s+/g, ' '), 'We use DataStore. Blue sky.');
  assert.equal(cues.find(c => c.text === 'DataStore.')?.start, 2);
  assert.equal(cues.at(-1)!.start, 5);
});

test('an overlong word is rejected rather than silently hiding its final spoken seconds', () => {
  assert.throws(() => subtitleCues(story('Hello.'), [{ text: 'Hello.', start: 0, end: 7 }], { duration: 8 }), /six seconds/);
});
