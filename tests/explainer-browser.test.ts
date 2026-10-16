import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { exportExplainer, exportExplainerFile } from '../src/index.ts';
import { core, fixtureProject } from './support/fixture.ts';

// Proves the exported folder works where it must: served over http and played by HyperFrames' own player in
// HyperFrames' managed headless Chrome, with the page's scrubber driving a scene player.
const run = promisify(execFile);
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.wav': 'audio/wav', '.png': 'image/png' };
// The page callbacks run in the browser. The Node project has no DOM lib, so this module declares only the members
// they use: HyperFrames' <hyperframes-player> element, the scrubber input, and document lookups.
interface Player { ready: boolean; currentTime: number; paused: boolean; playbackRate: number; seek(time: number): void; play(): void; pause(): void }
declare function getComputedStyle(element: unknown): { opacity: string; cursor: string };
interface Scrubber { value: string; dispatchEvent(event: Event): boolean }
declare const document: { fullscreenElement: { className: string } | null; querySelector(selector: string): unknown; querySelectorAll(selector: string): Iterable<unknown>; getElementById(id: string): unknown };

function serve(root: string): Promise<Server> {
  const server = createServer(async (request, response) => {
    try {
      const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)).replace(/^\/+/, '') || 'index.html';
      response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      response.end(await readFile(join(root, path)));
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise<Server>(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function centrePixel(png: Buffer, dir: string) {
  const file = join(dir, `pixel-${Date.now()}.png`);
  await writeFile(file, png);
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'crop=1:1:in_w/2:in_h/2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' });
  return [...stdout];
}

/**
 * Opens a page in HyperFrames' managed headless Chrome and checks that a scene player shows and scrubs its scene.
 * `offline` blocks and records every http(s) request, which must then be none.
 */
async function checkScenePlayer(url: string, project: string, { offline = false } = {}) {
  const executablePath = (await run(process.execPath, [join(core, 'node_modules/hyperframes/dist/cli.js'), 'browser', 'path'])).stdout.trim().split('\n').pop();
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests: string[] = [];
    if (offline) await page.context().route(/^https?:/, route => (requests.push(route.request().url()), route.abort()));
    await page.goto(url);
    await page.waitForFunction(() => [...document.querySelectorAll('hyperframes-player')].every(player => (player as Player).ready), null, { timeout: 60000 });
    const player = page.locator('#probe-player');
    assert.equal(await page.evaluate(() => (document.getElementById('probe-player') as Player).currentTime), 0, 'opens at the scene entrance');
    const scene = page.locator('#probe');
    const sceneButton = scene.locator('.explainer-scene-play');
    const sceneStatus = scene.locator('.explainer-scene-status');
    const sceneScrub = scene.locator('.explainer-scrub');
    assert.equal(await sceneStatus.textContent(), 'Paused · silent');
    const label = await sceneButton.evaluateHandle(button => button.firstChild);
    await page.waitForTimeout(120);
    assert.equal(await sceneButton.evaluate((button, label) => button.firstChild === label, label), true, 'an unchanged button label must survive between pointer down and up');
    await label.dispose();
    await player.evaluate<void, void, Player>(player => { player.playbackRate = .25; }, undefined);
    await sceneButton.click({ delay: 120 });
    await page.waitForFunction(() => !(document.getElementById('probe-player') as Player).paused);
    assert.ok(await player.evaluate<number, void, Player>(player => player.currentTime, undefined) < .5, 'first play starts at the scene entrance');
    assert.equal(await sceneButton.textContent(), 'Pause');
    await page.waitForFunction(() => Number((document.querySelector('#probe .explainer-scrub') as Scrubber).value) > 5);
    await player.click();
    assert.equal(await sceneButton.textContent(), 'Play scene');
    assert.equal(await sceneStatus.textContent(), 'Paused · silent');
    const stopped = await player.evaluate<number, void, Player>(player => player.currentTime, undefined);
    assert.ok(Math.abs(Number(await sceneScrub.inputValue()) / 30 - stopped) <= 1 / 30);
    const scrubTo = async (seconds: number) => {
      await page.locator('[data-player="probe-player"]').evaluate<void, string, Scrubber>((scrub, frame) => {
        scrub.value = frame;
        scrub.dispatchEvent(new Event('input'));
      }, String(seconds * 30));
      await page.waitForFunction(value => (document.getElementById('probe-player') as Player).currentTime === value, seconds);
      await page.waitForTimeout(300);
    };
    await scrubTo(0.5);
    assert.deepEqual(await centrePixel(await player.screenshot(), project), [0, 0, 0], 'before the beat');
    await scrubTo(1.5);
    assert.deepEqual(await centrePixel(await player.screenshot(), project), [255, 0, 0], 'after the beat');
    await player.evaluate<void, void, Player>(player => { player.playbackRate = 1; }, undefined);
    await sceneButton.click();
    await page.waitForFunction(() => (document.getElementById('probe-player') as Player).paused);
    assert.equal(await sceneButton.textContent(), 'Replay scene');
    assert.equal(await sceneScrub.inputValue(), '60');
    assert.equal(await scene.locator('.explainer-scene-time').textContent(), '0:02 / 0:02');
    await sceneButton.click();
    await page.waitForFunction(() => !(document.getElementById('probe-player') as Player).paused);
    assert.ok(await player.evaluate<number, void, Player>(player => player.currentTime, undefined) < .5);
    await player.click();
    const main = page.locator('.explainer-film');
    const caption = page.locator('.explainer-caption');
    const compactChapterMenu = async () => {
      const bounds = await page.locator('.explainer-chapters').boundingBox();
      assert.ok(bounds && bounds.width <= 280, 'chapter selector must remain compact on wide screens');
    };
    await compactChapterMenu();
    const cc = page.getByRole('button', { name: 'Subtitles', exact: true });
    assert.equal(await cc.getAttribute('aria-pressed'), 'false');
    assert.equal(await caption.isVisible(), false);
    const seekMain = async (time: number) => {
      await main.evaluate<void, number, Player>((player, time) => player.seek(time), time);
    };
    const captionIs = async (text: string) => {
      await page.waitForFunction(text => (document.querySelector('.explainer-caption-text') as { textContent: string }).textContent === text, text, { timeout: 5000 });
    };
    await seekMain(1.5);
    await cc.focus();
    await page.keyboard.press('Space');
    await captionIs('Second <literal> & line\nContinued.');
    const stableCaptionLayout = async () => {
      const bounds = async () => Promise.all([main, caption, page.locator('.explainer-tools')].map(element => element.boundingBox()));
      await seekMain(.25);
      await captionIs('First.');
      const oneLine = await bounds();
      await seekMain(1.5);
      await captionIs('Second <literal> & line\nContinued.');
      assert.deepEqual(await bounds(), oneLine, 'two-line captions must not resize the video, caption area or controls');
      await seekMain(.75);
      await captionIs('');
      assert.deepEqual(await bounds(), oneLine, 'subtitle gaps must keep the same layout');
    };
    await stableCaptionLayout();
    await seekMain(.75);
    await captionIs('');
    await seekMain(.25);
    await captionIs('First.');
    await page.locator('.explainer-chapters').selectOption('0');
    assert.equal(await main.evaluate<number, void, Player>(player => player.currentTime, undefined), 0);
    await main.evaluate<void, void, Player>(player => player.play(), undefined);
    await page.waitForFunction(() => (document.querySelector('.explainer-film') as Player).currentTime > 1.25, null, { timeout: 5000 });
    await main.evaluate<void, void, Player>(player => player.pause(), undefined);
    await captionIs('Second <literal> & line\nContinued.');
    const paused = await main.evaluate<number, void, Player>(player => player.currentTime, undefined);
    await page.waitForTimeout(200);
    assert.equal(await main.evaluate<number, void, Player>(player => player.currentTime, undefined), paused);
    await seekMain(2);
    await captionIs('');
    await page.locator('.explainer-chapters').selectOption('0');
    await captionIs('First.');
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement?.className === 'explainer-viewer', null, { timeout: 5000 });
    await compactChapterMenu();
    await stableCaptionLayout();
    const toolbar = page.locator('.explainer-tools');
    const nativeControls = main.locator('.hfp-controls');
    const controlsOpacity = async (opacity: string) => {
      await page.waitForFunction(opacity => getComputedStyle(document.querySelector('.explainer-tools')).opacity === opacity, opacity, { timeout: 6000 });
      assert.equal(await nativeControls.evaluate(element => getComputedStyle(element).opacity), opacity, 'native volume and playback controls share the toolbar visibility');
      const cursors = await main.locator('iframe').evaluate(element => {
        const frame = element as unknown as { contentDocument: { documentElement: unknown; body: unknown } };
        return [getComputedStyle(frame.contentDocument.documentElement).cursor, getComputedStyle(frame.contentDocument.body).cursor];
      });
      for (const cursor of cursors) assert.equal(cursor === 'none', opacity === '0', 'the composition cursor follows control visibility');
    };
    await main.evaluate<void, void, Player>(player => { player.playbackRate = .1; player.seek(0); player.play(); }, undefined);
    const filmBounds = (await main.boundingBox())!;
    await page.mouse.move(filmBounds.x + filmBounds.width / 2, filmBounds.y + filmBounds.height / 2);
    const shownLayout = await Promise.all([main, caption, toolbar].map(element => element.boundingBox()));
    await controlsOpacity('0');
    assert.deepEqual(await Promise.all([main, caption, toolbar].map(element => element.boundingBox())), shownLayout, 'hiding controls must not resize the film or subtitles');
    assert.equal(await caption.isVisible(), true, 'subtitles remain visible while controls hide');
    await main.evaluate<void, void, Player>(player => player.pause(), undefined);
    await controlsOpacity('1');
    await main.evaluate<void, void, Player>(player => player.play(), undefined);
    await controlsOpacity('0');
    await page.mouse.move(filmBounds.x + filmBounds.width / 2 + 10, filmBounds.y + filmBounds.height / 2);
    await controlsOpacity('1');
    await cc.focus();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(3200);
    await controlsOpacity('1');
    await main.evaluate<void, void, Player>(player => { player.pause(); player.playbackRate = 1; }, undefined);
    assert.equal(await caption.isVisible(), true);
    assert.equal(await cc.isVisible(), true);
    assert.equal(await page.locator('.explainer-chapters').isVisible(), true);
    await cc.click();
    assert.equal(await cc.getAttribute('aria-pressed'), 'false');
    assert.equal(await caption.isVisible(), false);
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 5000 });
    await page.setViewportSize({ width: 390, height: 844 });
    const menuBounds = await page.locator('.explainer-chapters').boundingBox();
    assert.ok(menuBounds && menuBounds.width >= 120, 'chapter titles remain readable on a narrow viewport');
    await cc.click();
    await stableCaptionLayout();
    const sceneLink = page.getByRole('navigation', { name: 'Individual scenes' }).getByRole('link', { name: 'Story copy' });
    await sceneLink.click();
    assert.equal(new URL(page.url()).hash, '#probe');
    const sceneBounds = (await page.locator('#probe').boundingBox())!;
    assert.ok(sceneBounds.y >= 0 && sceneBounds.y < 844, 'the scene link scrolls to its target');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [], 'no network requests');
  } finally {
    await browser.close();
  }
}

test('the folder export supports scene scrubbing, chapter navigation and optional subtitles', { timeout: 120000 }, async () => {
  const project = await fixtureProject('scene-runtime', html => html.replace('</head>', '<link rel="stylesheet" href="node_modules/explainery-core/themes/dark/theme.css"></head>'));
  const out = join(project, 'explainer');
  const subtitles = await captionFile(project);
  await exportExplainer(project, out, { subtitles });
  const server = await serve(out);
  try {
    await checkScenePlayer(`http://127.0.0.1:${(server.address() as AddressInfo).port}/index.html`, project);
  } finally {
    server.close();
  }
});

// The double-click case: a file:// page with no server, which must not fall back to the player's CDN runtime.
test('the single-file export supports chapters and optional subtitles offline from file://', { timeout: 120000 }, async () => {
  const project = await fixtureProject('scene-runtime', html => html.replace('</head>', '<link rel="stylesheet" href="node_modules/explainery-core/themes/dark/theme.css"></head>'));
  const out = join(project, 'explainer.html');
  const subtitles = await captionFile(project);
  await exportExplainerFile(project, out, { subtitles });
  await checkScenePlayer(pathToFileURL(out).href, project, { offline: true });
});

async function captionFile(project: string): Promise<string> {
  const file = join(project, 'captions.vtt');
  await writeFile(file, 'WEBVTT\n\n00:00.000 --> 00:00.500\nFirst.\n\n00:01.000 --> 00:01.900\nSecond &lt;literal&gt; &amp; line\nContinued.\n');
  return file;
}
