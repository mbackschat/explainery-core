import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { gsap } from 'gsap';
import { parseHTML } from 'linkedom';
import { preparePreviewOverlays } from '../src/preview-overlays.ts';
import type { SceneSelection } from '../src/story.ts';
import type { Story, Timing } from '../src/types.ts';

const story: Story = {
  id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [{ id: 'a', copy: { headline: 'A' }, narration: '' }, { id: 'b', copy: { headline: 'B' }, narration: '' }],
};
const timing: Timing = { source: 'imported', duration: 12, scenes: {
  a: { start: 0, duration: 8, beats: {} }, b: { start: 6, duration: 6, beats: {} },
} };
const full: SceneSelection = { start: 0, end: 12, duration: 12, compositionIds: new Set() };
const selected: SceneSelection = { start: 7, end: 10, duration: 3, compositionIds: new Set(['b']) };
const plan = () => ({ portrait: 'assets/portrait.png', frame: { x: 1400, y: 100, width: 400, height: 400, shape: 'circle' }, appearances: [{ composition: 'a', start: 0, end: 2 }, { composition: 'b', start: 0, end: 5 }] });

async function fixture(t: test.TestContext) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'preview-overlays-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = join(base, 'film');
  await mkdir(join(project, 'assets'), { recursive: true });
  await writeFile(join(project, 'assets/portrait.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'));
  const presenters = join(base, 'presenters.json');
  await writeFile(presenters, JSON.stringify(plan()));
  const subtitles = join(base, 'subtitles.vtt');
  await writeFile(subtitles, 'WEBVTT\n\n00:01.000 --> 00:02.000\nEarlier\n\n00:06.000 --> 00:08.000\n&lt;img src=x&gt; &amp; text\nSecond line\n\n00:09.000 --> 00:11.000\nLast\n');
  return { base, project, presenters, subtitles };
}

function composition(html: string) {
  const { document } = parseHTML(html);
  return document.querySelector('template')!.content;
}

test('omitted overlays produce no subcomposition or copied assets', async () => {
  assert.deepEqual(await preparePreviewOverlays('/unused', story, timing, full, {}), { html: '', assets: [] });
});

test('selected overlays clip film times, escape subtitles, and copy the retained portrait', async t => {
  const { project, presenters, subtitles } = await fixture(t);
  const result = await preparePreviewOverlays(project, story, timing, selected, {
    presenters: relative(process.cwd(), presenters), subtitles: relative(process.cwd(), subtitles),
  });
  const root = composition(result.html);
  assert.equal(root.querySelector('[data-composition-id]')?.getAttribute('data-composition-id'), 'explainery-preview-overlays');
  assert.equal(root.querySelector('[data-composition-id]')?.getAttribute('data-duration'), '3');
  const portrait = root.querySelector('[data-preview-presenter]')!;
  assert.equal(portrait.getAttribute('data-start'), '0');
  assert.equal(portrait.getAttribute('data-duration'), '3');
  assert.equal(root.querySelectorAll('[data-preview-presenter]').length, 1);
  assert.equal(portrait.querySelector('img')?.getAttribute('src'), 'explainery-preview/portrait.png');
  assert.equal(portrait.querySelector('img')?.hasAttribute('data-layout-allow-overflow'), false);
  assert.deepEqual(result.assets, [{ source: join(project, 'assets/portrait.png'), destination: 'explainery-preview/portrait.png' }]);
  const cues = [...root.querySelectorAll('[data-preview-subtitle]')];
  assert.deepEqual(cues.map(cue => [cue.getAttribute('data-start'), cue.getAttribute('data-duration'), cue.textContent]), [
    ['0', '1', '<img src=x> & text\nSecond line'], ['2', '1', 'Last'],
  ]);
  assert.equal(cues[0].querySelector('img'), null);
  assert.match(result.html, /white-space:\s*pre-wrap/);
  assert.match(result.html, /top:auto;right:auto;left:5%;bottom:/);
  assert.equal(root.querySelector('script[src]'), null);
});

test('each overlay works independently and empty composition selection means the full film', async t => {
  const { project, presenters, subtitles } = await fixture(t);
  const portraits = await preparePreviewOverlays(project, story, timing, full, { presenters });
  assert.equal(composition(portraits.html).querySelectorAll('[data-preview-presenter]').length, 2);
  assert.equal(composition(portraits.html).querySelectorAll('[data-preview-subtitle]').length, 0);
  const captions = await preparePreviewOverlays(project, story, timing, full, { subtitles });
  assert.equal(composition(captions.html).querySelectorAll('[data-preview-subtitle]').length, 3);
  assert.deepEqual(captions.assets, []);
});

test('portrait crop uses a fixed top-centred cover frame and rectangle radius', async t => {
  const { project, presenters } = await fixture(t);
  await writeFile(presenters, JSON.stringify({ ...plan(), frame: { x: 1400, y: 100, width: 400, height: 600, shape: 'rectangle', radius: 50, zoom: 1.5 } }));
  const root = composition((await preparePreviewOverlays(project, story, timing, full, { presenters })).html);
  const frame = root.querySelector('[data-preview-presenter]')!;
  assert.match(frame.getAttribute('style')!, /border-radius:50px/);
  const portrait = frame.querySelector('img')!;
  assert.equal(portrait.hasAttribute('data-layout-allow-overflow'), true);
  assert.equal(frame.hasAttribute('data-layout-allow-overflow'), false);
  assert.match(portrait.getAttribute('style')!, /object-fit:cover/);
  assert.match(portrait.getAttribute('style')!, /object-position:50% 0/);
  assert.match(portrait.getAttribute('style')!, /transform:scale\(1.5\)/);
  assert.match(portrait.getAttribute('style')!, /transform-origin:50% 0/);
});

test('the entire presenter plan is validated before selection filters any windows', async t => {
  const { project, presenters } = await fixture(t);
  const valid = plan();
  const invalid: Array<[string, unknown]> = [
    ['unknown plan field', { ...valid, extra: true }],
    ['missing portrait', { frame: valid.frame, appearances: valid.appearances }],
    ['unknown frame field', { ...valid, frame: { ...valid.frame, colour: 'red' } }],
    ['invalid shape', { ...valid, frame: { ...valid.frame, shape: 'oval' } }],
    ['off-canvas frame', { ...valid, frame: { ...valid.frame, x: 1800 } }],
    ['negative position', { ...valid, frame: { ...valid.frame, y: -1 } }],
    ['empty frame', { ...valid, frame: { ...valid.frame, width: 0 } }],
    ['nonsquare circle', { ...valid, frame: { ...valid.frame, height: 300 } }],
    ['circle radius', { ...valid, frame: { ...valid.frame, radius: 0 } }],
    ['excess rectangle radius', { ...valid, frame: { ...valid.frame, shape: 'rectangle', radius: 201 } }],
    ['negative radius', { ...valid, frame: { ...valid.frame, shape: 'rectangle', radius: -1 } }],
    ['small zoom', { ...valid, frame: { ...valid.frame, zoom: .5 } }],
    ['null numeric', { ...valid, frame: { ...valid.frame, zoom: null } }],
    ['empty appearances', { ...valid, appearances: [] }],
    ['unknown composition outside selection', { ...valid, appearances: [{ composition: 'missing', start: 0, end: 2 }] }],
    ['unknown appearance field', { ...valid, appearances: [{ composition: 'a', start: 0, end: 2, extra: true }] }],
    ['outside composition', { ...valid, appearances: [{ composition: 'a', start: 0, end: 9 }] }],
    ['negative time', { ...valid, appearances: [{ composition: 'a', start: -1, end: 2 }] }],
    ['zero window', { ...valid, appearances: [{ composition: 'a', start: 2, end: 2 }] }],
    ['film-clock overlap', { ...valid, appearances: [{ composition: 'a', start: 7, end: 8 }, { composition: 'b', start: 1, end: 3 }] }],
  ];
  for (const [label, value] of invalid) {
    await writeFile(presenters, JSON.stringify(value));
    await assert.rejects(preparePreviewOverlays(project, story, timing, selected, { presenters }), /presenter/i, label);
  }
  await writeFile(presenters, JSON.stringify(valid).replace('1400', '1e999'));
  await assert.rejects(preparePreviewOverlays(project, story, timing, selected, { presenters }), /finite/i);
});

test('portrait validation rejects missing, non-image, directory, absolute and escaping symlink paths', async t => {
  const { base, project, presenters } = await fixture(t);
  await writeFile(join(project, 'assets/portrait.svg'), '<svg/>');
  await mkdir(join(project, 'assets/directory.png'));
  await writeFile(join(base, 'outside.png'), 'outside');
  await symlink(join(base, 'outside.png'), join(project, 'assets/escaped.png'));
  for (const portrait of ['assets/missing.png', 'assets/portrait.svg', 'assets/directory.png', join(project, 'assets/portrait.png'), '../outside.png', 'assets/escaped.png', 'https://example.com/portrait.png']) {
    await writeFile(presenters, JSON.stringify({ ...plan(), portrait }));
    await assert.rejects(preparePreviewOverlays(project, story, timing, full, { presenters }), /portrait|presenter/i, portrait);
  }
});

test('adjacent appearances are valid and subtitles outside the selected range are still validated', async t => {
  const { project, presenters, subtitles } = await fixture(t);
  await writeFile(presenters, JSON.stringify({ ...plan(), appearances: [{ composition: 'a', start: 0, end: 2 }, { composition: 'a', start: 2, end: 3 }] }));
  await preparePreviewOverlays(project, story, timing, full, { presenters });
  await writeFile(subtitles, 'WEBVTT\n\n00:01.000 --> 00:02.000\n<b>styled</b>\n');
  await assert.rejects(preparePreviewOverlays(project, story, timing, selected, { subtitles }), /plain-text/);
});

test('GSAP seeking keeps portraits and captions half-open through direct, backward and forward jumps', async t => {
  const { project, presenters, subtitles } = await fixture(t);
  const root = composition((await preparePreviewOverlays(project, story, timing, full, { presenters, subtitles })).html);
  const window = { __timelines: {} as Record<string, gsap.core.Timeline> };
  runInNewContext(root.querySelector('script')!.textContent!, { gsap, window, document: root });
  const timeline = window.__timelines['explainery-preview-overlays'];
  t.after(() => timeline.kill());
  assert.equal(timeline.paused(), true);
  const clips = [...root.querySelectorAll('[data-preview-presenter], [data-preview-subtitle]')];
  for (const time of [0, 7, 2, 6, 11, 1, 8, 9, 12, 0, 10, 2]) {
    timeline.seek(time);
    for (const clip of clips) {
      const start = Number(clip.getAttribute('data-start'));
      const end = start + Number(clip.getAttribute('data-duration'));
      const content = clip.querySelector('[data-preview-content]')!;
      assert.equal(Number(content.getAttribute('style')!.match(/opacity:([^;]+)/)?.[1]), Number(time >= start && time < end), `${clip.id} at ${time}`);
    }
  }
});


test('overlay endpoints preserve the rebased endpoint without summing rounded durations', async t => {
  const { project, presenters } = await fixture(t);
  await writeFile(presenters, JSON.stringify({ ...plan(), appearances: [{ composition: 'a', start: .2, end: .9 }] }));
  const root = composition((await preparePreviewOverlays(project, story, timing, full, { presenters })).html);
  const clip = root.querySelector('[data-preview-presenter]')!;
  assert.equal(clip.getAttribute('data-preview-end'), '0.9');
  const window = { __timelines: {} as Record<string, gsap.core.Timeline> };
  runInNewContext(root.querySelector('script')!.textContent!, { gsap, window, document: root });
  const timeline = window.__timelines['explainery-preview-overlays'];
  t.after(() => timeline.kill());
  const image = clip.querySelector('img')!;
  for (const [time, opacity] of [[.9, 0], [.2, 1], [.1, 0], [.8, 1], [.9, 0], [.2, 1]]) {
    timeline.seek(time);
    assert.equal(Number(image.style.opacity), opacity, `decimal boundary at ${time}`);
  }
});
