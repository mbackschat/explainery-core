import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { verifyVideo, verifyFilm, verifyHtml } from '../src/verification.ts';
import { sceneChapters, writeMp4Chapters } from '../src/chapters.ts';
import { fixtureProject } from './support/fixture.ts';
import { exportExplainerFile } from '../src/explainer-file.ts';
import type { Story, Timing } from '../src/types.ts';

const story: Story = { id: 'probe', title: 'Probe', theme: 'dark', canvas: { width: 32, height: 32, fps: 30 }, scenes: [{ id: 'a', copy: { headline: 'First' }, narration: 'First.' }] };
const timing: Timing = { source: 'imported', duration: .5, scenes: { a: { start: 0, duration: .5, beats: {} } } };

test('isolation tolerance is explicit in receipts and invalid values fail before capture', async t => {
  const out = await mkdtemp(join(tmpdir(), 'explainery-tolerance-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const missingProject = join(out, 'missing-project');
  for (const isolationTolerance of [-1, .5, 256, Number.NaN, Number.POSITIVE_INFINITY]) {
    const receipt = await verifyFilm(missingProject, { out, isolationTolerance });
    assert.equal(receipt.passed, false);
    assert.match(receipt.failures.join('\n'), /isolationTolerance must be an integer from 0 to 255/);
    assert.deepEqual(receipt.frames, []);
  }
  const defaults = await verifyFilm(missingProject, { out });
  assert.equal(defaults.isolationTolerance, 1);
  for (const isolationTolerance of [0, 2, 255]) {
    const receipt = await verifyFilm(missingProject, { out, isolationTolerance });
    assert.equal(receipt.isolationTolerance, isolationTolerance);
    assert.equal(JSON.parse(await readFile(receipt.receiptPath, 'utf8')).isolationTolerance, isolationTolerance);
    assert.doesNotMatch(receipt.failures.join('\n'), /isolationTolerance/);
  }
});

test('video evidence checks decode, duration, codec, chapters and the expected hash', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-verification-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const video = join(dir, 'film.mp4');
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=30:d=0.5', '-c:v', 'libx264', video], { timeout: 10000 });
  await writeMp4Chapters(video, sceneChapters(story, timing), 30);
  const good = await verifyVideo(video, { out: join(dir, 'good'), story, timing });
  assert.equal(good.passed, true, good.failures.join('\n'));
  assert.equal(good.decode, true);
  assert.match(good.sha256!, /^[a-f0-9]{64}$/);
  const formatMismatch = await verifyVideo(video, { out: join(dir, 'format'), story: { ...story, canvas: { width: 64, height: 64, fps: 24 } }, timing });
  assert.match(formatMismatch.failures.join('\n'), /dimensions/);
  assert.match(formatMismatch.failures.join('\n'), /frame rate/);
  const incompatible = join(dir, 'incompatible.mp4');
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=30:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-flags', '+ilme+ildct', '-x264-params', 'tff=1', incompatible], { timeout: 10000 });
  await writeMp4Chapters(incompatible, sceneChapters(story, timing), 30);
  const incompatibleResult = await verifyVideo(incompatible, { out: join(dir, 'incompatible'), story, timing });
  assert.match(incompatibleResult.failures.join('\n'), /pixel format/);
  assert.match(incompatibleResult.failures.join('\n'), /progressive/);
  const bad = await verifyVideo(video, { out: join(dir, 'bad'), story, timing: { ...timing, duration: 2 }, expectedSha256: 'wrong' });
  assert.equal(bad.passed, false);
  assert.match(bad.failures.join('\n'), /duration/);
  assert.match(bad.failures.join('\n'), /hash/);
  assert.equal(JSON.parse(await readFile(bad.receiptPath, 'utf8')).humanReview, 'pending');
});

test('source evidence captures every seek direction and HTML evidence opens offline', { timeout: 60000 }, async t => {
  const project = await fixtureProject('scene-runtime');
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, '.explainery'));
  await writeFile(join(project, '.explainery/focus.json'), '{"sceneId":"different"}');
  const receipt = await verifyFilm(project, { out: join(project, 'verification'), sceneIds: ['probe'], isolationTolerance: 2 });
  assert.equal(receipt.passed, true, receipt.failures.join('\n'));
  assert.equal(receipt.isolationTolerance, 2);
  assert.equal(receipt.comparisons.length, 2);
  for (const direction of ['direct', 'forward', 'backward']) assert.ok(receipt.frames.some(frame => frame.cue === direction));
  assert.ok(receipt.frames.some(frame => frame.cue === 'show'));
  assert.match(await readFile(receipt.contactSheetPath, 'utf8'), /<img/);
  assert.equal(await readFile(join(project, '.explainery/focus.json'), 'utf8'), '{"sceneId":"different"}');
  const html = join(project, 'delivery.html');
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=2', join(project, 'narration.wav')], { timeout: 10000 });
  const indexFile = join(project, 'index.html');
  await writeFile(indexFile, (await readFile(indexFile, 'utf8')).replace('</body>', '<audio src="narration.wav" data-start="0" data-duration="2"></audio></body>'));
  const subtitles = join(project, 'captions.vtt');
  await writeFile(subtitles, 'WEBVTT\n\n00:00.000 --> 00:01.900\nProbe caption.\n');
  await exportExplainerFile(project, html, { subtitles });
  const checked = await verifyHtml(html, { out: join(project, 'html-verification'), project, expectSubtitles: true, expectAudio: true });
  assert.equal(checked.passed, true, checked.failures.join('\n'));
  assert.deepEqual(checked.networkRequests, []);
  assert.ok(checked.decodedAudio > 0);
});

test('standalone HTML rejects sibling resources and missing or broken images', { timeout: 60000 }, async t => {
  const project = await fixtureProject('scene-runtime');
  t.after(() => rm(project, { recursive: true, force: true }));
  const html = join(project, 'delivery.html');
  await exportExplainerFile(project, html);
  const original = await readFile(html, 'utf8');
  await writeFile(join(project, 'sibling.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
  for (const [name, markup, failure] of [
    ['sibling', '<img src="sibling.svg">', /nonembedded resource/],
    ['missing', '<img src="missing.svg">', /image failed to load/],
    ['broken-data', '<img src="data:image/png;base64,YnJva2Vu">', /image failed to load/],
    ['svg-missing', '<svg><image href="missing-svg.svg" width="10" height="10"/></svg>', /resource request failed/],
  ] as const) {
    await writeFile(html, original.replace('</body>', `${markup}</body>`));
    const receipt = await verifyHtml(html, { out: join(project, name), project });
    assert.equal(receipt.passed, false, name);
    assert.match(receipt.failures.join('\n'), failure, name);
  }
});
