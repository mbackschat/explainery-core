import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { sceneChapters, writeMp4Chapters } from '../src/chapters.ts';
import type { Story, Timing } from '../src/types.ts';

const story: Story = {
  id: 'garden', title: 'Garden', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    { id: 'start', copy: { headline: 'Plant' }, narration: 'Plant.' },
    { id: 'grow', title: 'Watch it grow', compositions: [
      { id: 'water', copy: { headline: 'Water' }, narration: 'Water.' },
      { id: 'sun', copy: { headline: 'Sun' }, narration: 'Sun.' },
    ] },
    { id: 'pick', copy: { headline: 'Harvest' }, narration: 'Pick.' },
  ],
};
const timing: Timing = { source: 'imported', duration: 10, scenes: {
  start: { start: .2, duration: 3, beats: {} }, water: { start: 2.5, duration: 3, beats: {} },
  sun: { start: 5, duration: 3, beats: {} }, pick: { start: 7.5, duration: 2.5, beats: {} },
} };

test('chapters use editorial titles and contiguous intervals, including lead-in and overlap transitions', () => {
  assert.deepEqual(sceneChapters(story, timing), [
    { title: 'Plant', start: 0, end: 2.5 },
    { title: 'Watch it grow', start: 2.5, end: 7.5 },
    { title: 'Harvest', start: 7.5, end: 10 },
  ]);
});

test('selected scenes start at zero and end with the selected render, without composition chapters', () => {
  assert.deepEqual(sceneChapters(story, timing, ['grow']), [{ title: 'Watch it grow', start: 0, end: 5.5 }]);
  assert.deepEqual(sceneChapters(story, timing, ['grow', 'pick']), [
    { title: 'Watch it grow', start: 0, end: 5 }, { title: 'Harvest', start: 5, end: 7.5 },
  ]);
  for (const ids of [['missing'], ['grow', 'grow'], ['pick', 'grow'], ['start', 'pick']]) {
    assert.throws(() => sceneChapters(story, timing, ids));
  }
});

test('indistinguishable chapter starts fail instead of creating an empty chapter', () => {
  assert.throws(() => sceneChapters(story, { ...timing, scenes: { ...timing.scenes, water: { start: 0, duration: 5, beats: {} } } }), /chapter.*start|chapter.*duration/i);
});

const run = promisify(execFile);
async function probe(file: string) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file], { timeout: 10000 });
  return JSON.parse(stdout).chapters as Array<{ start_time: string; end_time: string; tags: { title: string } }>;
}
async function packetHashes(file: string, stream: string) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', file], { timeout: 10000 });
  return JSON.parse(stdout).packets;
}

test('MP4 remux preserves compressed video, audio and subtitles, and replaces chapters idempotently', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-chapters-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const video = join(dir, 'film.mp4');
  const subtitles = join(dir, 'subtitles.srt');
  await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:01,000\nHello.\n');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-i', subtitles, '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'mov_text', '-metadata', 'title=Garden film', video], { timeout: 15000 });
  const before = await Promise.all(['v', 'a', 's'].map(stream => packetHashes(video, stream)));
  const chapters = [{ title: 'A = B; #1 \\ café', start: 0, end: .875 }, { title: 'Next', start: .875, end: 1.99 }];
  for (let iteration = 0; iteration < 2; iteration++) {
    await writeMp4Chapters(video, chapters, 30);
    const actual = await probe(video);
    assert.deepEqual(actual.map(c => [c.tags.title, Number(c.start_time), Number(c.end_time)]), [[chapters[0].title, 0, .875], ['Next', .875, 2]]);
    assert.deepEqual(await Promise.all(['v', 'a', 's'].map(stream => packetHashes(video, stream))), before);
  }
  const original = await readFile(video);
  await assert.rejects(writeMp4Chapters(video, [{ title: 'Wrong film', start: 0, end: 20 }], 30), /duration/);
  assert.deepEqual(await readFile(video), original);
  await assert.rejects(writeMp4Chapters(video, [{ title: 'Empty', start: 0, end: 0 }], 30), /chapter/);
  assert.deepEqual(await readFile(video), original);
});
