import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { Story, Timing } from '../src/types.ts';

const cli = fileURLToPath(new URL('../bin/explainery.ts', import.meta.url));

test('production commands reject missing provenance and invalid worker counts before rendering', async t => {
  const { project, run } = await fixture(t);
  const checked = await run(['preflight', project]);
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /production.json/);
  for (const count of ['0', '1.5', 'NaN']) {
    const result = await run(['render', project, '--workers', count]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /positive integer/);
    assert.equal(result.argv, undefined);
  }
});

test('render forwards an explicitly chosen worker count', async t => {
  const { project, run } = await fixture(t);
  const result = await run(['render', project, '--scene', 'lead', '--workers', '2']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.argv?.[result.argv.indexOf('--workers') + 1], '2');
});

test('reusable rendering rejects draft quality and stale full-film assembly before spawning', async t => {
  const { project, run } = await fixture(t);
  const draft = await run(['render', project, '--reuse']);
  assert.match(draft.stderr, /requires render --quality delivery/);
  const stale = await run(['render', project, '--reuse', '--quality', 'delivery']);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /assemble/);
  assert.equal(stale.argv, undefined);
});
const story: Story = {
  id: 'demo', title: 'Demo film', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 24 },
  scenes: [
    { id: 'lead', copy: { headline: 'Lead' }, narration: 'Lead.' },
    { id: 'chapter', title: 'The chapter', compositions: [
      { id: 'part-a', copy: { headline: 'First part' }, narration: 'First {move}.' },
      { id: 'part-b', copy: { headline: 'Second part' }, narration: 'Second.' },
    ] },
    { id: 'final', copy: { headline: 'Final thought' }, narration: 'Final.' },
  ],
};
const timing: Timing = {
  source: 'imported', duration: 13,
  scenes: { lead: { start: 0, duration: 2, beats: {} }, 'part-a': { start: 2, duration: 5, beats: { move: 1 } }, 'part-b': { start: 6, duration: 4, beats: {} }, final: { start: 10, duration: 3, beats: {} } },
};

async function fixture(t: test.TestContext) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'explainery-scene-cli-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const project = join(cwd, 'film');
  const fake = join(project, 'node_modules/hyperframes');
  await mkdir(join(project, 'compositions'), { recursive: true });
  await mkdir(join(fake, 'dist'), { recursive: true });
  await writeFile(join(project, 'package.json'), '{"type":"module"}');
  await writeFile(join(fake, 'package.json'), '{"name":"hyperframes","type":"module"}');
  await writeFile(join(fake, 'dist/cli.js'), `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
    import { join } from 'node:path';
    const args = process.argv.slice(2);
    writeFileSync(process.env.HF_CAPTURE, JSON.stringify(args));
    console.log('Fake HyperFrames: ' + args.join(' '));
    if (Number(process.env.HF_EXIT ?? 0)) process.exit(Number(process.env.HF_EXIT));
    if (args[0] === 'transcribe') writeFileSync(join(args[args.indexOf('--dir') + 1], 'transcript.json'), JSON.stringify([{ text: 'Lead.', start: 0.1, end: 0.4 }]));
    if (args[0] === 'render') {
      const duration = readFileSync(join(args[1], 'index.html'), 'utf8').match(/data-duration="([^"]+)"/)[1];
      const output = args[args.indexOf('--output') + 1];
      const rendered = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=s=16x16:r=24', '-t', duration, '-c:v', 'libx264', output], { encoding: 'utf8', timeout: 5000 });
      if (rendered.status !== 0) { console.error(rendered.stderr); process.exit(1); }
    }
  `);
  await writeFile(join(project, 'story.yaml'), JSON.stringify(story));
  await writeFile(join(project, 'timing.json'), JSON.stringify(timing));
  for (const id of Object.keys(timing.scenes)) await writeFile(join(project, 'compositions', `${id}.html`), `<template><div data-composition-id="${id}"></div></template>`);
  await writeFile(join(project, 'index.html'), `<!DOCTYPE html><html><head></head><body><div data-composition-id="main" data-duration="13">${Object.keys(timing.scenes).map(id => `<div id="${id}" class="clip" data-composition-id="${id}" data-composition-src="compositions/${id}.html"></div>`).join('')}<div class="background">Shared</div></div></body></html>`);
  const capture = join(cwd, 'hf-argv.json');
  async function run(args: string[], env: Record<string, string> = {}) {
    await rm(capture, { force: true });
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, HF_CAPTURE: capture, ...env }, encoding: 'utf8', timeout: 10000 });
    let argv: string[] | undefined;
    try { argv = JSON.parse(await readFile(capture, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { ...result, argv };
  }
  return { cwd, project, run };
}

test('transcribe recognizes each voice manifest clip once with the pinned HyperFrames and writes the shifted transcript', async t => {
  const { project, run } = await fixture(t);
  await mkdir(join(project, '.explainery/voice/cache'), { recursive: true });
  await mkdir(join(project, 'assets'));
  const segments = [];
  for (const [id, start] of [['lead', 0.25], ['final', 3]] as const) {
    const clip = Buffer.from(`${id} clip`);
    await writeFile(join(project, `.explainery/voice/cache/${id}.wav`), clip);
    segments.push({ id, start, end: start + 1, audio: `.explainery/voice/cache/${id}.wav`, audioSha256: createHash('sha256').update(clip).digest('hex') });
  }
  await writeFile(join(project, 'assets/narration.wav.voice.json'), JSON.stringify({ segments }));
  const args = ['transcribe', project, '--segments', 'film/assets/narration.wav.voice.json', '--out', 'film/drafts/transcript.json'];
  const first = await run(args);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(first.argv?.slice(0, 2), ['transcribe', join(project, '.explainery/voice/cache/final.wav')]);
  assert.match(first.stdout, /recognized 2 of 2 clips/);
  assert.deepEqual(JSON.parse(await readFile(join(project, 'drafts/transcript.json'), 'utf8')), [{ text: 'Lead.', start: 0.35, end: 0.65 }, { text: 'Lead.', start: 3.1, end: 3.4 }]);
  const again = await run(args);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.argv, undefined);
  assert.match(again.stdout, /recognized 0 of 2 clips/);
  const missing = await run(['transcribe', project]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--segments/);
});

test('scenes lists editorial titles and ranges, and narration traverses grouped compositions', async t => {
  const { project, run } = await fixture(t);
  const listed = await run(['scenes', project]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /lead.*Lead.*0.*2/);
  assert.match(listed.stdout, /chapter.*The chapter.*2.*10/);
  assert.match(listed.stdout, /final.*Final thought.*10.*13/);
  assert.doesNotMatch(listed.stdout, /part-a|part-b/);
  const narrated = await run(['narration', project]);
  assert.equal(narrated.status, 0, narrated.stderr);
  assert.equal(narrated.stdout, 'Lead.\n\nFirst.\n\nSecond.\n\nFinal.\n');
});

test('focus switches by title, reports the sticky scope, and clears to the full film', async t => {
  const { project, run } = await fixture(t);
  const selected = await run(['focus', project, '--scene', 'THE CHAPTER']);
  assert.equal(selected.status, 0, selected.stderr);
  assert.match(selected.stdout, /chapter.*The chapter/);
  assert.deepEqual(JSON.parse(await readFile(join(project, '.explainery/focus.json'), 'utf8')), { sceneId: 'chapter' });
  assert.match((await run(['focus', project])).stdout, /chapter.*The chapter/);
  assert.equal((await run(['focus', project, '--film'])).status, 0);
  assert.match((await run(['focus', project])).stdout, /full film/i);
});

test('preview honors sticky focus and runs supported background, status, and stop commands', async t => {
  const { project, run } = await fixture(t);
  await run(['focus', project, '--scene', 'chapter']);
  const started = await run(['preview', project]);
  const directory = join(project, '.explainery/scenes/demo--chapter');
  assert.equal(started.status, 0, started.stderr);
  assert.deepEqual(started.argv, ['preview', directory, '--background', '--no-open']);
  assert.match(started.stdout, /Scope:.*chapter.*2.*10/);
  assert.ok(started.stdout.indexOf('Scope:') < started.stdout.indexOf('Fake HyperFrames:'));
  for (const flag of ['--status', '--stop']) {
    const result = await run(['preview', project, flag]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.argv, ['preview', directory, flag]);
  }
});

test('render defaults to draft and uses software capture, story fps, and repository output paths', async t => {
  const { cwd, project, run } = await fixture(t);
  await run(['focus', project, '--scene', 'chapter']);
  const rendered = await run(['render', project]);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.deepEqual(rendered.argv, ['render', join(project, '.explainery/scenes/demo--chapter'), '--quality', 'draft', '--no-browser-gpu', '--workers', '1', '--fps', '24', '--output', join(cwd, 'renders/demo-chapter.mp4')]);
  assert.match(rendered.stdout, /Scope:.*chapter/);
  assert.deepEqual(chapterTitles(join(cwd, 'renders/demo-chapter.mp4')), ['The chapter']);
  assert.equal(chapterEntries(join(cwd, 'renders/demo-chapter.mp4'))[0].start_time, '0.000000');
  const output = join(cwd, 'review/custom.mp4');
  const full = await run(['render', project, '--film', '--quality', 'delivery', '--out', output]);
  assert.equal(full.status, 0, full.stderr);
  assert.deepEqual(full.argv, ['render', project, '--quality', 'delivery', '--no-browser-gpu', '--workers', '1', '--fps', '24', '--output', output]);
  assert.match(full.stdout, /Scope:.*full film/i);
  assert.deepEqual(chapterTitles(output), ['Lead', 'The chapter', 'Final thought']);
  assert.equal(JSON.parse(await readFile(join(project, '.explainery/focus.json'), 'utf8')).sceneId, 'chapter');
  const focused = await run(['render', project, '--quality', 'looks']);
  assert.equal(focused.argv?.[3], 'looks');
});

test('scene lists and full-film overrides are one-off and preserve sticky focus', async t => {
  const { cwd, project, run } = await fixture(t);
  await run(['focus', project, '--scene', 'lead']);
  const selected = await run(['preview', project, '--scene', 'chapter,final']);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.argv?.[1], join(project, '.explainery/scenes/demo--chapter--final'));
  assert.match(selected.stdout, /chapter.*final.*2.*13/);
  assert.equal(JSON.parse(await readFile(join(project, '.explainery/focus.json'), 'utf8')).sceneId, 'lead');
  await run(['focus', project, '--film']);
  const full = await run(['render', project]);
  assert.equal(full.status, 0, full.stderr);
  assert.equal(full.argv?.[1], project);
  assert.equal(full.argv?.[3], 'draft');
  assert.equal(full.argv?.at(-1), join(cwd, 'renders/demo-full.mp4'));
});

test('a composition selection previews and renders inside its scene without chapters and leaves focus unchanged', async t => {
  const { cwd, project, run } = await fixture(t);
  await run(['focus', project, '--scene', 'lead']);
  const previewed = await run(['preview', project, '--composition', 'part-a,part-b']);
  assert.equal(previewed.status, 0, previewed.stderr);
  assert.deepEqual(previewed.argv, ['preview', join(project, '.explainery/scenes/demo--chapter.part-a--part-b'), '--background', '--no-open']);
  assert.match(previewed.stdout, /Scope: compositions part-a,part-b of scene chapter — The chapter \(2–10s\)/);
  const rendered = await run(['render', project, '--composition', 'part-b']);
  assert.equal(rendered.status, 0, rendered.stderr);
  const output = join(cwd, 'renders/demo-chapter.part-b.mp4');
  assert.deepEqual(rendered.argv, ['render', join(project, '.explainery/scenes/demo--chapter.part-b'), '--quality', 'draft', '--no-browser-gpu', '--workers', '1', '--fps', '24', '--output', output]);
  assert.match(rendered.stdout, /Scope: composition part-b of scene chapter — The chapter \(6–10s\)/);
  assert.match(rendered.stdout, /no chapters/);
  assert.deepEqual(chapterEntries(output), []);
  assert.equal(JSON.parse(await readFile(join(project, '.explainery/focus.json'), 'utf8')).sceneId, 'lead');
});

test('composition selections across scenes, out of order, or beside another scope fail before spawning HyperFrames', async t => {
  const { project, run } = await fixture(t);
  for (const [args, message] of [
    [['--composition', 'part-b,final'], /composition selection must lie within one editorial scene; "part-b" belongs to "chapter" and "final" to "final"/],
    [['--composition', 'part-b,part-a'], /consecutive compositions of scene "chapter" in story order/],
    [['--composition', 'nowhere'], /unknown composition "nowhere"/],
    [['--composition', 'part-a,'], /Composition selection contains an empty ID/],
    [['--composition', 'part-a', '--scene', 'chapter'], /--composition selects its own scene; omit --scene and --film/],
    [['--composition', 'part-a', '--film'], /--composition selects its own scene; omit --scene and --film/],
  ] as const) {
    for (const command of ['preview', 'render']) {
      const result = await run([command, project, ...args]);
      assert.equal(result.status, 1, `${command} ${args.join(' ')}`);
      assert.match(result.stderr, message, `${command} ${args.join(' ')}`);
      assert.equal(result.argv, undefined, `${command} ${args.join(' ')}`);
    }
  }
});

test('bad options, stale focus, and invalid scene ranges fail before spawning HyperFrames', async t => {
  const { project, run } = await fixture(t);
  for (const args of [['focus', '--scene'], ['render', '--quality'], ['render', '--out'], ['preview', '--scene', '--film'], ['preview', '--scene', 'lead', '--film'], ['render', '--quality', 'high'], ['preview', '--stop', '--status'], ['render', '--stop'], ['preview', '--quality', 'draft'], ['preview', '--scene', 'lead,final'], ['preview', '--scene', 'missing']]) {
    const result = await run([args[0], project, ...args.slice(1)]);
    assert.notEqual(result.status, 0, args.join(' '));
    assert.equal(result.argv, undefined, args.join(' '));
  }
  await mkdir(join(project, '.explainery'), { recursive: true });
  await writeFile(join(project, '.explainery/focus.json'), '{"sceneId":"gone"}');
  const stale = await run(['preview', project]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /stale.*gone/i);
  assert.equal(stale.argv, undefined);
  assert.equal((await run(['preview', project, '--film'])).status, 0);
});

test('conflicting scope and preview flags fail with their messages, and unknown options exit 2', async t => {
  const { project, run } = await fixture(t);
  const rejected: [string[], string][] = [
    [['focus', '--scene', 'lead', '--film'], 'Use either --scene or --film, not both'],
    [['preview', '--stop', '--status'], 'Use either --stop or --status, not both'],
    [['render', '--stop'], '--stop and --status apply only to preview'],
    [['render', '--status'], '--stop and --status apply only to preview'],
    [['preview', '--quality', 'draft'], '--quality and --out apply only to render'],
    [['preview', '--out', 'review.mp4'], '--quality and --out apply only to render'],
    [['render', '--quality', 'high'], '--quality must be draft, looks, or delivery'],
  ];
  for (const [args, message] of rejected) {
    const result = await run([args[0], project, ...args.slice(1)]);
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(result.stderr, `${message}\n`, args.join(' '));
  }
  const unknown = await run(['preview', project, '--bogus']);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stderr, 'Unknown option --bogus\n');
});

test('HyperFrames failures preserve their exit code', async t => {
  const { project, run } = await fixture(t);
  const result = await run(['render', project, '--film'], { HF_EXIT: '7' });
  assert.equal(result.status, 7, result.stderr);
});

function chapterEntries(file: string): Array<{ start_time: string; end_time: string; tags: { title: string } }> {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).chapters;
}
const chapterTitles = (file: string) => chapterEntries(file).map(chapter => chapter.tags.title);

test('chapter refresh defaults to the full film despite focus and supports an explicit selected range', async t => {
  const { cwd, project, run } = await fixture(t);
  await run(['focus', project, '--scene', 'lead']);
  const file = join(cwd, 'renders/demo-full.mp4');
  const full = await run(['render', project, '--film']);
  assert.equal(full.status, 0, full.stderr);
  const refreshed = await run(['chapters', project, '--video', file]);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.equal(refreshed.argv, undefined);
  assert.deepEqual(chapterTitles(file), ['Lead', 'The chapter', 'Final thought']);
  assert.equal(JSON.parse(await readFile(join(project, '.explainery/focus.json'), 'utf8')).sceneId, 'lead');
  const selectedFile = join(cwd, 'renders/demo-chapter--final.mp4');
  assert.equal((await run(['render', project, '--scene', 'chapter,final'])).status, 0);
  assert.equal((await run(['chapters', project, '--scene', 'chapter,final', '--video', selectedFile])).status, 0);
  assert.deepEqual(chapterEntries(selectedFile).map(chapter => [chapter.tags.title, Number(chapter.start_time)]), [['The chapter', 0], ['Final thought', 8]]);
  const original = await readFile(file);
  const wrong = await run(['chapters', project, '--scene', 'chapter', '--video', file]);
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /duration/);
  assert.deepEqual(await readFile(file), original);
  assert.notEqual((await run(['chapters', project])).status, 0);
});

test('narration preview follows focus, never edits source, and is removed before render', async t => {
  const { project, run } = await fixture(t);
  const source = await readFile(join(project, 'index.html'), 'utf8');
  await run(['focus', project, '--scene', 'chapter']);
  const preview = await run(['preview', project, '--narration']);
  assert.equal(preview.status, 0, preview.stderr);
  const prepared = await readFile(join(preview.argv![1], 'index.html'), 'utf8');
  assert.match(prepared, /data-preview-narration/);
  assert.match(prepared, /Draft narration/);
  assert.doesNotMatch(prepared, /\{move\}/);
  assert.equal(await readFile(join(project, 'index.html'), 'utf8'), source);
  const rendered = await run(['render', project]);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.doesNotMatch(await readFile(join(rendered.argv![1], 'index.html'), 'utf8'), /data-preview-narration/);
  const rejected = await run(['render', project, '--narration']);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /--narration applies only to preview/);
  const full = await run(['preview', project, '--film', '--narration']);
  assert.equal(full.status, 0, full.stderr);
  assert.notEqual(full.argv![1], project);
  assert.match(await readFile(join(full.argv![1], 'index.html'), 'utf8'), /data-preview-narration/);
});

test('snapshot resolves beat addresses on the full-film clock despite focus and never asks for frame descriptions', async t => {
  const { cwd, project, run } = await fixture(t);
  assert.equal((await run(['assemble', project])).status, 0);
  await run(['focus', project, '--scene', 'chapter']);
  const shot = await run(['snapshot', project, '--at', 'part-a:move+0.5,lead,3']);
  assert.equal(shot.status, 0, shot.stderr);
  assert.deepEqual(shot.argv, ['snapshot', project, '--at', '3.5,0,3', '--no-end', '--no-browser-gpu', '--describe', 'false', '--output', join(cwd, 'renders/snapshots')]);
  assert.match(shot.stdout, /frame-00\t3\.500s\tpart-a:move\+0\.5\nframe-01\t0\.000s\tlead\nframe-02\t3\.000s\t3\n/);
  const zoomed = await run(['snapshot', project, '--at', 'part-b', '--out', 'review/shots', '--zoom', '#co-ledger']);
  assert.equal(zoomed.status, 0, zoomed.stderr);
  assert.deepEqual(zoomed.argv?.slice(2), ['--at', '6', '--no-end', '--no-browser-gpu', '--describe', 'false', '--output', join(cwd, 'review/shots'), '--zoom', '#co-ledger']);
});

test('snapshot rejects stale assembly, unknown addresses and scene scope before spawning HyperFrames', async t => {
  const { project, run } = await fixture(t);
  const stale = await run(['snapshot', project, '--at', '1']);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /index\.html is stale; run explainery assemble/);
  assert.equal(stale.argv, undefined);
  assert.equal((await run(['assemble', project])).status, 0);
  for (const [args, message] of [
    [['--at', 'part-a:moev'], /composition "part-a" has no beat "moev"; its beats are move/],
    [['--at', 'nowhere:move'], /unknown composition "nowhere"/],
    [['--at', 'final+5'], /resolves to 15s, outside the film \(0–13s\)/],
    [[], /snapshot requires --at/],
    [['--at', '1', '--scene', 'chapter'], /snapshot always uses the full-film clock; omit --scene and --film/],
    [['--at', '1', '--film'], /full-film clock/],
  ] as const) {
    const result = await run(['snapshot', project, ...args]);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, message, args.join(' '));
    assert.equal(result.argv, undefined, args.join(' '));
  }
});

test('verify rejects a composition outside the selected scene, and a pixel tolerance with --quick, before capturing', async t => {
  const { project, run } = await fixture(t);
  const outside = await run(['verify', project, '--scene', 'chapter', '--composition', 'final', '--quick']);
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /composition "final" is not in the selected scene "chapter"/);
  const tolerance = await run(['verify', project, '--quick', '--pixel-tolerance', '2']);
  assert.equal(tolerance.status, 1);
  assert.equal(tolerance.stderr, '--pixel-tolerance applies only to the isolation comparisons that --quick skips\n');
});
