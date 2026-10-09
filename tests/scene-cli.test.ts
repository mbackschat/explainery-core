import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { Story, Timing } from '../src/types.ts';

const cli = fileURLToPath(new URL('../bin/explainery.ts', import.meta.url));
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
  await writeFile(join(fake, 'dist/cli.js'), `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.HF_CAPTURE, JSON.stringify(process.argv.slice(2))); console.log('Fake HyperFrames: ' + process.argv.slice(2).join(' ')); process.exit(Number(process.env.HF_EXIT ?? 0));`);
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
  const output = join(cwd, 'review/custom.mp4');
  const full = await run(['render', project, '--film', '--quality', 'delivery', '--out', output]);
  assert.equal(full.status, 0, full.stderr);
  assert.deepEqual(full.argv, ['render', project, '--quality', 'delivery', '--no-browser-gpu', '--workers', '1', '--fps', '24', '--output', output]);
  assert.match(full.stdout, /Scope:.*full film/i);
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
