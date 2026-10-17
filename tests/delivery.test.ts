import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deliverFilm, type DeliveryServices } from '../src/delivery.ts';
import type { Story, Timing } from '../src/types.ts';

const hash = (data: string) => createHash('sha256').update(data).digest('hex');
const story: Story = { id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, pronunciations: { API: 'ay pee eye' }, scenes: [{ id: 'intro', copy: { headline: 'Introduction' }, narration: '{start} The API works.' }] };
const timing: Timing = { source: 'aligned', audio: 'voice.wav', audioDuration: 2, duration: 3, scenes: { intro: { start: 0, duration: 3, beats: { start: .1 } } } };

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const project = await mkdtemp(join(tmpdir(), 'explainery-delivery-test-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const out = join(project, 'final');
  const transcript = JSON.stringify(['The', 'ay', 'pee', 'eye', 'works.'].map((text, index) => ({ text, start: .1 + index * .3, end: .3 + index * .3 })));
  const segments = JSON.stringify({ segments: [{ id: 'intro', start: 0, end: 2 }] });
  await writeFile(join(project, 'transcript.json'), transcript);
  await writeFile(join(project, 'segments.json'), segments);
  const record = { transcript: { path: 'transcript.json', sha256: hash(transcript) }, transcriptMode: 'spoken' as const, segments: { path: 'segments.json', sha256: hash(segments) } };
  const calls: string[] = [];
  const services: DeliveryServices = {
    preflight: async () => { calls.push('preflight'); return { errors: [], record }; },
    validate: async () => ({ errors: [], story, timing }),
    fingerprint: async () => 'stable',
    reusable: async () => false,
    recordRender: async () => { calls.push('record-render'); },
    silences: async () => [],
    verifyVideo: async () => { calls.push('verify-video'); return { passed: true, failures: [], receiptPath: 'video-receipt.json' }; },
    exportHtml: async (_project, file, options) => { calls.push('export-html'); assert.match(await readFile(options.subtitles!, 'utf8'), /The API works\./); await writeFile(file, 'offline html'); },
    verifyHtml: async (_file, options) => { calls.push('verify-html'); assert.equal(options.expectAudio, true); assert.equal(options.expectSubtitles, true); return { passed: true, failures: [], receiptPath: 'html-receipt.json' }; },
  };
  const render = async (file: string) => { calls.push('render'); await writeFile(file, 'video'); };
  return { project, out, record, calls, services, render };
}

test('delivery writes verified film, canonical subtitles, chapters and checksum receipt', async t => {
  const f = await fixture(t);
  const result = await deliverFilm(f.project, { out: f.out, render: f.render, services: f.services });
  assert.deepEqual(f.calls, ['preflight', 'render', 'verify-video', 'record-render', 'export-html', 'verify-html', 'preflight']);
  assert.equal(result.humanReview, 'pending');
  assert.equal(result.reusedRender, false);
  assert.deepEqual(result.chapters, [{ title: 'Introduction', start: 0, end: 3 }]);
  assert.match(await readFile(`${f.out}.srt`, 'utf8'), /The API works\./);
  assert.match(await readFile(`${f.out}-chapters.txt`, 'utf8'), /00:00:00\.000 Introduction/);
  for (const file of Object.values(result.files)) assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(await readFile(result.manifestFile, 'utf8')).files.mp4.sha256, hash('video'));
});

test('delivery reuses the verified render but verifies its bytes again', async t => {
  const f = await fixture(t);
  await writeFile(`${f.out}.mp4`, 'cached video');
  f.services.reusable = async () => true;
  const result = await deliverFilm(f.project, { out: f.out, render: f.render, services: f.services });
  assert.equal(result.reusedRender, true);
  assert.ok(!f.calls.includes('render'));
  assert.ok(f.calls.includes('verify-video'));
});

test('delivery preflight refuses stale production without rendering', async t => {
  const f = await fixture(t);
  f.services.preflight = async () => ({ errors: ['timing is stale'] });
  await assert.rejects(deliverFilm(f.project, { out: f.out, render: f.render, services: f.services }), /timing is stale/);
  assert.deepEqual(f.calls, []);
});

test('delivery refuses tampered transcript and segment bytes before render', async t => {
  for (const file of ['transcript.json', 'segments.json']) {
    const f = await fixture(t);
    await writeFile(join(f.project, file), 'tampered');
    await assert.rejects(deliverFilm(f.project, { out: f.out, render: f.render, services: f.services }), /hash/);
    assert.ok(!f.calls.includes('render'));
  }
});

test('failed video verification never records render reuse or publishes delivery success', async t => {
  const f = await fixture(t);
  f.services.verifyVideo = async () => ({ passed: false, failures: ['decode failed'], receiptPath: 'video-receipt.json' });
  await assert.rejects(deliverFilm(f.project, { out: f.out, render: f.render, services: f.services }), /decode failed/);
  assert.ok(!f.calls.includes('record-render'));
  assert.ok(!f.calls.includes('export-html'));
  await assert.rejects(readFile(`${f.out}-delivery.json`), { code: 'ENOENT' });
});

test('source mutation during render prevents caching and delivery', async t => {
  const f = await fixture(t);
  let changed = false;
  f.services.fingerprint = async () => changed ? 'changed' : 'stable';
  const render = async (file: string) => { await f.render(file); changed = true; };
  await assert.rejects(deliverFilm(f.project, { out: f.out, render, services: f.services }), /sources changed/);
  assert.ok(!f.calls.includes('record-render'));
});

test('HTML failure or changed production at the final check leaves no success manifest', async t => {
  for (const failure of ['html', 'production']) {
    const f = await fixture(t);
    if (failure === 'html') f.services.verifyHtml = async () => ({ passed: false, failures: ['external request'], receiptPath: 'html-receipt.json' });
    else {
      let checks = 0;
      f.services.preflight = async () => ++checks === 1 ? { errors: [], record: f.record } : { errors: ['audio changed'] };
    }
    await writeFile(`${f.out}-delivery.json`, 'old success');
    await assert.rejects(deliverFilm(f.project, { out: f.out, render: f.render, services: f.services }), /external request|audio changed/);
    await assert.rejects(readFile(`${f.out}-delivery.json`), { code: 'ENOENT' });
  }
});

test('delivery refuses HTML or subtitle bytes changed after their checks', async t => {
  for (const extension of ['html', 'vtt']) {
    const f = await fixture(t);
    f.services.verifyHtml = async () => {
      await writeFile(`${f.out}.${extension}`, 'changed during verification');
      return { passed: true, failures: [], receiptPath: 'html-receipt.json' };
    };
    await assert.rejects(deliverFilm(f.project, { out: f.out, render: f.render, services: f.services }), /changed after/);
    await assert.rejects(readFile(`${f.out}-delivery.json`), { code: 'ENOENT' });
  }
});

test('delivery accepts segment arrays as well as voice manifests', async t => {
  const f = await fixture(t);
  const data = JSON.stringify([{ id: 'intro', start: 0, end: 2 }]);
  await writeFile(join(f.project, 'segments.json'), data);
  f.record.segments.sha256 = hash(data);
  await deliverFilm(f.project, { out: f.out, render: f.render, services: f.services });
  assert.ok(f.calls.includes('render'));
});
