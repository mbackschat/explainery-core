import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { contactSheet, verifyVideo, verifyFilm, verifyHtml } from '../src/verification.ts';
import { sceneChapters, writeMp4Chapters } from '../src/chapters.ts';
import { fixtureProject } from './support/fixture.ts';
import { exportExplainerFile } from '../src/explainer-file.ts';
import { assembleIndex } from '../src/assemble.ts';
import { loadStory } from '../src/validate.ts';
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

test('video evidence of a composition selection expects its range and no chapters', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-verification-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const grouped: Story = { ...story, scenes: [{ id: 'pair', title: 'Pair', compositions: [{ id: 'a', copy: { headline: 'First' }, narration: 'First.' }, { id: 'b', copy: { headline: 'Second' }, narration: 'Second.' }] }] };
  const pairTiming: Timing = { source: 'imported', duration: 1.5, scenes: { a: { start: 0, duration: 1, beats: {} }, b: { start: 1, duration: .5, beats: {} } } };
  const video = join(dir, 'b.mp4');
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=30:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { timeout: 10000 });
  await writeMp4Chapters(video, [], 30, .5);
  const good = await verifyVideo(video, { out: join(dir, 'good'), story: grouped, timing: pairTiming, compositionIds: ['b'] });
  assert.equal(good.passed, true, good.failures.join('\n'));
  const asScene = await verifyVideo(video, { out: join(dir, 'scene'), story: grouped, timing: pairTiming, sceneIds: ['pair'] });
  assert.match(asScene.failures.join('\n'), /duration/);
  assert.match(asScene.failures.join('\n'), /chapters/);
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

test('beat captions carry the words spoken in that beat, and a quick sheet says which comparisons it skipped', () => {
  const frame = { composition: 'checkout', context: 'full', at: 5.6, file: '0001-checkout-full.png', sha256: 'x' } as const;
  const sheet = contactSheet({ quick: true, failures: [], frames: [{ ...frame, cue: 'merge', narration: 'Two <ledgers> merge,' }, { ...frame, cue: 'closing' }] });
  assert.match(sheet, /<figcaption>checkout · full · merge · 5.600s<br><q>Two &lt;ledgers&gt; merge,<\/q><\/figcaption>/);
  assert.match(sheet, /<figcaption>checkout · full · closing · 5.600s<\/figcaption>/);
  assert.match(sheet, /Quick check: beat and closing frames only; no seek-history or isolation comparisons/);
  assert.doesNotMatch(contactSheet({ quick: false, failures: [], frames: [] }), /Quick check/);
});

test('an unknown composition filter fails before any capture', async t => {
  const project = await fixtureProject('scene-runtime');
  t.after(() => rm(project, { recursive: true, force: true }));
  const receipt = await verifyFilm(project, { out: join(project, 'verification'), composition: 'missing' });
  assert.equal(receipt.passed, false);
  assert.deepEqual(receipt.frames, []);
  assert.match(receipt.failures.join('\n'), /unknown composition "missing"/);
});

// Needs the pinned HyperFrames browser, like the seek-history test above.
test('quick verification of one composition captures only its beat and closing frames with their narration', { timeout: 60000 }, async t => {
  const project = await fixtureProject('scene-runtime');
  t.after(() => rm(project, { recursive: true, force: true }));
  const storyFile = join(project, 'story.yaml');
  await writeFile(storyFile, (await readFile(storyFile, 'utf8')).replace('Show it {show}.', 'Show {show} the probe.'));
  const receipt = await verifyFilm(project, { out: join(project, 'verification'), composition: 'probe', quick: true });
  assert.equal(receipt.passed, true, receipt.failures.join('\n'));
  assert.equal(receipt.quick, true);
  assert.equal(receipt.composition, 'probe');
  assert.deepEqual(receipt.comparisons, []);
  assert.deepEqual(receipt.frames.map(frame => [frame.cue, frame.context, frame.at, frame.narration]), [['show', 'full', 1.3, 'the probe.'], ['closing', 'full', 2 - 1 / 30, undefined]]);
  assert.match(await readFile(receipt.contactSheetPath, 'utf8'), /<q>the probe\.<\/q>/);
});

// Locks the one-line headline rule (docs/authoring.md#write-headlines-that-state-the-claim); the oracle is the browser's own line boxes.
test('verification fails a composition whose headline wraps onto a second line', { timeout: 60000 }, async t => {
  const long = 'A headline long enough to wrap onto a second line in this small probe frame';
  const project = await fixtureProject('scene-runtime', html => html.replace('"headline":"Story copy"', `"headline":"${long}"`));
  t.after(() => rm(project, { recursive: true, force: true }));
  const storyFile = join(project, 'story.yaml');
  await writeFile(storyFile, (await readFile(storyFile, 'utf8')).replace('headline: Story copy', `headline: ${long}`));
  const receipt = await verifyFilm(project, { out: join(project, 'verification'), composition: 'probe', quick: true });
  assert.equal(receipt.passed, false);
  assert.deepEqual(receipt.failures, ['probe: headline wraps onto 2 lines; shorten it to fit one line']);
});

// Locks the two-line support rule (docs/authoring.md#write-headlines-that-state-the-claim): a third line overflows the
// theme's copy block. The line count depends on font metrics, so only the overflow itself is asserted.
test('verification fails a composition whose support line runs past two lines', { timeout: 60000 }, async t => {
  const long = 'A support line long enough to run past two lines in this small probe frame, because it keeps adding qualifiers that belong in the narration instead';
  const project = await fixtureProject('scene-runtime', html => html.replace('"headline":"Story copy"', `"headline":"Story copy","support":"${long}"`));
  t.after(() => rm(project, { recursive: true, force: true }));
  const storyFile = join(project, 'story.yaml');
  await writeFile(storyFile, (await readFile(storyFile, 'utf8')).replace('copy: { headline: Story copy }', `copy: { headline: Story copy, support: "${long}" }`));
  const receipt = await verifyFilm(project, { out: join(project, 'verification'), composition: 'probe', quick: true });
  assert.equal(receipt.failures.length, 1, receipt.failures.join('\n'));
  assert.match(receipt.failures[0], /^probe: support line wraps onto \d lines; shorten it to fit two lines$/);
});

// Card titles follow the same one-line rule; a chapter card once wrapped a scene title and a roadmap cut another off
// while every composition headline passed. The oracle is the theme's own card layout in the browser.
test('verification fails a card whose title wraps or whose roadmap entry is cut off', { timeout: 60000 }, async t => {
  const title = 'A scene title long enough to wrap onto a second line on its chapter card';
  const project = await fixtureProject('scene-runtime', html => html
    .replace('</head>', '  <link rel="stylesheet" href="node_modules/explainery-core/themes/dark/theme.css">\n  </head>')
    .replace('    </div>\n    <script>', '      <div id="explainery-cards" class="clip" data-composition-id="explainery-cards" data-composition-src="compositions/cards.html" data-start="0" data-duration="3" data-width="640" data-height="360" data-track-index="2" data-story-span data-story-cards></div>\n    </div>\n    <script>'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await writeFile(join(project, 'compositions/cards.html'), `<template id="explainery-cards-template">
  <div id="explainery-cards-layer" data-composition-id="explainery-cards" data-width="640" data-height="360" data-layout-ignore=""></div>
  <script>defineCards({ window, document, gsap }, 'explainery-cards');</script>
</template>
`);
  await writeFile(join(project, 'story.yaml'), `id: scene-runtime-fixture
title: Scene runtime fixture
theme: dark
canvas: { width: 640, height: 360, fps: 30 }
scenes:
  - id: part
    title: ${title}
    compositions:
      - id: question
        card: chapter
        copy: { headline: Why? }
        narration: Why?
      - id: probe
        copy: { headline: Story copy }
        narration: Show it {show}.
`);
  const timing: Timing = { source: 'imported', duration: 3, scenes: { question: { start: 0, duration: 1, beats: {} }, probe: { start: 1, duration: 2, beats: { show: 1 } } } };
  await writeFile(join(project, 'timing.json'), JSON.stringify(timing));
  const index = join(project, 'index.html');
  const assembled = assembleIndex(await readFile(index, 'utf8'), (await loadStory(project)).value!, timing);
  assert.deepEqual(assembled.errors, []);
  await writeFile(index, assembled.html);
  const receipt = await verifyFilm(project, { out: join(project, 'verification'), composition: 'question', quick: true });
  // The line count depends on font metrics, so only the wrap itself is asserted.
  assert.equal(receipt.failures.length, 2, receipt.failures.join('\n'));
  assert.match(receipt.failures[0], /^question: card title wraps onto \d lines; shorten it to fit one line$/);
  assert.equal(receipt.failures[1], `question: roadmap entry "01  ${title}" is cut off; shorten that scene title`);
});

// A beat whose picture never changes while the narration moves on reads as a frozen film. The oracle is the scene's own
// registered timeline: the probe tweens only on `show`, so the five-second `idle` beat is static. Static beats are
// warnings, not failures, because a deliberate hold on a settled diagram is legitimate.
test('quick verification warns about a long beat in which no tween starts', { timeout: 60000 }, async t => {
  const project = await fixtureProject('scene-runtime', html => html.replaceAll('data-duration="2"', 'data-duration="8"'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const composition = join(project, 'compositions/probe.html');
  await writeFile(composition, (await readFile(composition, 'utf8')).replace('data-duration="2"', 'data-duration="8"'));
  const storyFile = join(project, 'story.yaml');
  await writeFile(storyFile, (await readFile(storyFile, 'utf8')).replace('Show it {show}.', 'Show it {show}. Then nothing moves {idle} for a while.'));
  const timing: Timing = { source: 'imported', duration: 8, scenes: { probe: { start: 0, duration: 8, beats: { show: 1, idle: 3 } } } };
  await writeFile(join(project, 'timing.json'), JSON.stringify(timing));
  const index = join(project, 'index.html');
  const assembled = assembleIndex(await readFile(index, 'utf8'), (await loadStory(project)).value!, timing);
  assert.deepEqual(assembled.errors, []);
  await writeFile(index, assembled.html);
  const receipt = await verifyFilm(project, { out: join(project, 'verification'), composition: 'probe', quick: true });
  assert.equal(receipt.passed, true, receipt.failures.join('\n'));
  assert.deepEqual(receipt.staticBeats, [{ composition: 'probe', cue: 'idle', start: 3, seconds: 5 }]);
  assert.match(await readFile(receipt.contactSheetPath, 'utf8'), /probe · idle: 5\.0 s without a visual change/);
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
