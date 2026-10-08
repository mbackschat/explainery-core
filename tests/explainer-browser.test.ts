import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { exportExplainer } from '../src/index.ts';
import { core, fixtureProject } from './support/fixture.ts';

// Proves the exported folder works where it must: served over http and played by HyperFrames' own player in
// HyperFrames' managed headless Chrome, with the page's scrubber driving a scene player.
const run = promisify(execFile);
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.wav': 'audio/wav', '.png': 'image/png' };
// The page callbacks run in the browser. The Node project has no DOM lib, so this module declares only the members
// they use: HyperFrames' <hyperframes-player> element, the scrubber input, and document lookups.
interface Player { ready: boolean; currentTime: number }
interface Scrubber { value: string; dispatchEvent(event: Event): boolean }
declare const document: { querySelectorAll(selector: string): Iterable<unknown>; getElementById(id: string): unknown };

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

test('the exported page shows a scene through its own player, scrubbed within the scene', { timeout: 120000 }, async () => {
  const project = await fixtureProject('scene-runtime');
  const out = join(project, 'explainer');
  await exportExplainer(project, out);
  const server = await serve(out);
  const executablePath = (await run(process.execPath, [join(core, 'node_modules/hyperframes/dist/cli.js'), 'browser', 'path'])).stdout.trim().split('\n').pop();
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/index.html`);
    await page.waitForFunction(() => [...document.querySelectorAll('hyperframes-player')].every(player => (player as Player).ready), null, { timeout: 60000 });
    const player = page.locator('#probe-player');
    assert.equal(await page.evaluate(() => (document.getElementById('probe-player') as Player).currentTime), 1, 'opens on the middle frame');
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
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
