import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { assembleIndex } from '../src/assemble.ts';
import { hyperframesDist } from '../src/hyperframes.ts';
import { prepareSceneProject } from '../src/scene-project.ts';
import { loadStory, validateProject } from '../src/validate.ts';
import { core, fixtureProject } from './support/fixture.ts';

const run = promisify(execFile);
const times = [.5, 1.4, 1.8, 2.2, 1.8, .5];

async function captureHelpers(project: string): Promise<Record<string, (...args: any[]) => Promise<any>>> {
  const wanted = ['bundleWithLocalizedFonts', 'serveStaticProjectHtml', 'openSettledCompositionPage', 'seekCompositionTimeline'];
  const helpers: Record<string, (...args: any[]) => Promise<any>> = {};
  const dist = hyperframesDist(project);
  for (const name of await readdir(dist)) {
    if (!name.endsWith('.js')) continue;
    const source = await readFile(join(dist, name), 'utf8');
    const exports = wanted.filter(symbol => !helpers[symbol] && source.includes(`function ${symbol}(`));
    if (!exports.length) continue;
    const module = await import(pathToFileURL(join(dist, name)).href);
    for (const symbol of exports) if (typeof module[symbol] === 'function') helpers[symbol] = module[symbol];
  }
  assert.deepEqual(Object.keys(helpers).sort(), wanted.sort());
  return helpers;
}

async function pixels(path: string): Promise<Buffer> {
  return (await run('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', timeout: 10000, maxBuffer: 1024 * 1024 })).stdout;
}
const pixel = (bytes: Buffer, x: number, y: number) => [...bytes.subarray((y * 640 + x) * 3, (y * 640 + x) * 3 + 3)];

async function frames(project: string, html: string, helpers: Awaited<ReturnType<typeof captureHelpers>>, prefix: string, samples = times): Promise<Buffer[]> {
  const server = await helpers.serveStaticProjectHtml(project, html);
  const errors: string[] = [];
  try {
    const { browser, page, renderReadyTimedOut } = await helpers.openSettledCompositionPage(html, server.url, {
      renderReadyTimeoutMs: 5000, navigationTimeoutMs: 10000, browserGpuMode: 'software',
      beforeNavigate: (page: any) => {
        page.on('pageerror', (error: Error) => errors.push(error.message));
        page.on('requestfailed', (request: any) => errors.push(request.url()));
        page.on('response', (response: any) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      },
    });
    const watchdog = setTimeout(() => browser.process()?.kill('SIGKILL'), 25000);
    try {
      assert.equal(renderReadyTimedOut, false, `${prefix} runtime becomes ready`);
      const captured: Buffer[] = [];
      for (const [index, time] of samples.entries()) {
        await helpers.seekCompositionTimeline(page, time, { exactTime: true, fallbackToBridgeAndTimelines: true });
        const path = join(project, `${prefix}-${index}.png`);
        await page.screenshot({ path });
        captured.push(await pixels(path));
      }
      assert.deepEqual(errors, [], `${prefix} loads all resources and scoped scripts`);
      return captured;
    } finally { clearTimeout(watchdog); await browser.close(); }
  } finally { await server.close(); }
}

// HyperFrames 0.8.142 has separate compiler and runtime URL selection, so source moves need pixels from both paths.
test('source relocation preserves preview, runtime-loader and rendered resource bytes and scoped beats', { timeout: 150000 }, async t => {
  const project = await fixtureProject('scene-sources');
  t.after(() => rm(project, { recursive: true, force: true }));
  const inline = await loadStory(project);
  assert.ok(inline.value, inline.errors.join('\n'));
  const timingBytes = await readFile(join(project, 'timing.json'));
  const timing = JSON.parse(timingBytes.toString());
  const source = await readFile(join(project, 'index.html'), 'utf8');
  const assembled = assembleIndex(source, inline.value, timing);
  assert.deepEqual(assembled.errors, []);
  await writeFile(join(project, 'index.html'), assembled.html);
  const helpers = await captureHelpers(project);
  const baseline = await frames(project, await helpers.bundleWithLocalizedFonts(project), helpers, 'inline');
  assert.deepEqual(pixel(baseline[0], 50, 50), [255, 0, 0], 'root image bytes');
  assert.deepEqual(pixel(baseline[0], 150, 50), [0, 0, 255], 'scene image bytes');
  assert.deepEqual(pixel(baseline[0], 250, 50), [0, 255, 0], 'style-block URL bytes');
  assert.deepEqual(pixel(baseline[0], 350, 50), [255, 0, 0], 'inline-style URL bytes');
  assert.deepEqual(pixel(baseline[0], 200, 260), [0, 0, 0], 'before local beat');
  assert.deepEqual(pixel(baseline[1], 200, 260), [255, 0, 0], 'after local beat');
  assert.deepEqual(pixel(baseline[2], 500, 220), [255, 0, 255], 'incoming scene appears during overlap');
  assert.deepEqual(pixel(baseline[3], 200, 260), [0, 0, 0], 'outgoing scene ends without an added fade');
  assert.deepEqual(pixel(baseline[3], 620, 340), [255, 255, 0], 'shared layer spans both scenes');
  for (const scene of inline.value.scenes) {
    assert.ok('compositions' in scene);
    const id = scene.compositions[0].id;
    await mkdir(join(project, 'scenes', id), { recursive: true });
    await writeFile(join(project, 'scenes', id, 'scene.yaml'), JSON.stringify({ ...scene, compositions: scene.compositions.map(part => ({ ...part, source: `${part.id}.html` })) }));
    await rename(join(project, 'compositions', `${id}.html`), join(project, 'scenes', id, `${id}.html`));
  }
  await writeFile(join(project, 'story.yaml'), JSON.stringify({ ...inline.value, scenes: [{ source: 'scenes/first/scene.yaml' }, { source: 'scenes/second/scene.yaml' }] }));
  const moved = await loadStory(project);
  assert.ok(moved.value, moved.errors.join('\n'));
  const relocated = assembleIndex(source, moved.value, timing, moved.resolved);
  assert.equal(relocated.html, assembled.html.replaceAll('compositions/first.html', 'scenes/first/first.html').replaceAll('compositions/second.html', 'scenes/second/second.html'));
  await writeFile(join(project, 'index.html'), relocated.html);
  assert.deepEqual(await readFile(join(project, 'timing.json')), timingBytes);
  assert.deepEqual((await validateProject(project)).errors, []);
  const preview = await frames(project, await helpers.bundleWithLocalizedFonts(project), helpers, 'referenced');
  assert.deepEqual(preview, baseline, 'pure path relocation is pixel-identical through direct, forward and backward seeks');
  const runtime = relocated.html.replace('<head>', '<head><script src="node_modules/hyperframes/dist/hyperframe-runtime.js"></script>');
  assert.deepEqual(await frames(project, runtime, helpers, 'runtime'), baseline, 'runtime loader agrees with the preview compiler');
  const together = await prepareSceneProject(project, ['first-scene', 'second-scene']);
  assert.deepEqual(await frames(together.directory, await helpers.bundleWithLocalizedFonts(together.directory), helpers, 'adjacent'), baseline, 'adjacent-scene preview preserves both overlap contributions');
  const isolated = await prepareSceneProject(project, ['second-scene']);
  assert.deepEqual((await frames(isolated.directory, await helpers.bundleWithLocalizedFonts(isolated.directory), helpers, 'isolated', [.7]))[0], baseline[3], 'isolated scene matches the full film after the outgoing scene ends');
  const video = join(project, 'out.mp4');
  const result = await run(process.execPath, [join(core, 'node_modules/hyperframes/dist/cli.js'), 'render', '--output', video, '--workers', '1', '--no-browser-gpu'], { cwd: project, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  t.diagnostic(result.stdout);
  for (const [index, time] of times.slice(0, 4).entries()) {
    const frame = join(project, `video-${index}.png`);
    await run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', video, '-frames:v', '1', frame], { timeout: 10000 });
    const bytes = await pixels(frame);
    for (const [x, y] of [[50, 50], [150, 50], [250, 50], [350, 50], [200, 260], [500, 220], [620, 340]]) {
      const actual = pixel(bytes, x, y), expected = pixel(baseline[index], x, y);
      assert.ok(actual.every((channel, channelIndex) => Math.abs(channel - expected[channelIndex]) <= 8), `video ${time}s pixel ${x},${y}: ${actual} vs ${expected}; tolerance 8/255`);
    }
  }
});
