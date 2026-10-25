import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { hyperframesDist } from '../src/hyperframes.ts';
import { prepareSceneProject } from '../src/scene-project.ts';
import { fixtureProject } from './support/fixture.ts';

const run = promisify(execFile);
const host = '#explainery-preview-overlays';

// HyperFrames 0.8.142 exposes its compiler and capture adapter in hashed CLI chunks (src/verification.ts).
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
  assert.deepEqual(Object.keys(helpers).sort(), wanted.sort(), 'the pinned HyperFrames compiler/capture contract must still exist');
  return helpers;
}

function silence(seconds: number): Buffer {
  const rate = 8000;
  const bytes = rate * seconds * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF'); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
  return wav;
}

async function overlayFixture(t: test.TestContext) {
  const project = await fixtureProject('scene-runtime', html => html.replace('</div>\n    <script>', '<audio id="review-audio" src="assets/narration.wav" data-start="0" data-duration="8" data-media-start="0" data-story-audio data-story-span></audio></div>\n    <script>'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const geometry = (await readFile(new URL('../themes/base.css', import.meta.url), 'utf8')).replace(/@font-face\s*\{[^}]+\}/g, '').replace('Roboto, sans-serif', 'sans-serif');
  const index = join(project, 'index.html');
  await writeFile(index, (await readFile(index, 'utf8'))
    .replace('</head>', `<style>${geometry}</style></head>`)
    .replace('<audio id="review-audio"', '<div style="position:absolute;inset:0;transform:scale(.3333333333);transform-origin:0 0;width:1920px;height:1080px"><section class="copy"><div class="accent-rule"></div><p class="category">Example</p><h1>Example headline</h1><p id="review-support" class="support">First supporting line.<br>Second supporting line.</p></section></div><audio id="review-audio"'));
  await mkdir(join(project, 'assets'));
  await writeFile(join(project, 'assets/narration.wav'), silence(8));
  await writeFile(join(project, 'timing.json'), JSON.stringify({ source: 'imported', audio: 'assets/narration.wav', duration: 8, scenes: { probe: { start: 2, duration: 4, beats: { show: 1 } } } }));
  const composition = join(project, 'compositions/probe.html');
  await writeFile(composition, (await readFile(composition, 'utf8')).replace('background: #ff0000', 'background: #000000'));
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=80x160,format=rgb24,drawbox=y=80:w=80:h=80:color=blue:t=fill', '-frames:v', '1', join(project, 'assets/portrait.png')], { timeout: 10000 });
  const presenters = join(project, 'presenters.json');
  await writeFile(presenters, JSON.stringify({ portrait: 'assets/portrait.png', frame: { x: 480, y: 20, width: 120, height: 120, shape: 'rectangle', radius: 12, zoom: 1.5 }, appearances: [{ composition: 'probe', start: .25, end: 1 }, { composition: 'probe', start: 1.5, end: 3.5 }] }));
  const subtitles = join(project, 'review.vtt');
  await writeFile(subtitles, 'WEBVTT\n\n00:01.500 --> 00:02.500\nOpening.\n\n00:03.000 --> 00:04.000\nSecond &lt;literal&gt; &amp; line\nContinued.\n\n00:05.500 --> 00:06.500\nClosing.\n');
  const names = ['index.html', 'story.yaml', 'timing.json', 'compositions/probe.html', 'assets/narration.wav', 'assets/portrait.png', 'presenters.json', 'review.vtt'];
  const retained = await Promise.all(names.map(async name => ({ name, bytes: await readFile(join(project, name)) })));
  return { project, presenters, subtitles, retained };
}

test('compiled review overlays mount, crop retained portraits and seek on the selected or full film clock', { timeout: 60000 }, async t => {
  const { project, presenters, subtitles, retained } = await overlayFixture(t);
  const { bundleWithLocalizedFonts: bundle, serveStaticProjectHtml: serve, openSettledCompositionPage: open, seekCompositionTimeline: seek } = await captureHelpers(project);
  for (const selected of [true, false]) {
    const prepared = await prepareSceneProject(project, selected ? ['probe'] : [], { presenters, subtitles });
    assert.equal(prepared.start, selected ? 2 : 0);
    assert.equal(prepared.duration, selected ? 4 : 8);
    const html = await bundle(prepared.directory);
    const server = await serve(prepared.directory, html);
    const failures: string[] = [];
    try {
      const { browser, page, renderReadyTimedOut } = await open(html, server.url, {
        renderReadyTimeoutMs: 5000, navigationTimeoutMs: 10000, browserGpuMode: 'software',
        beforeNavigate: (page: any) => {
          page.on('pageerror', (error: Error) => failures.push(error.message));
          page.on('requestfailed', (request: any) => failures.push(request.url()));
          page.on('response', (response: any) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
        },
      });
      const watchdog = setTimeout(() => browser.process()?.kill('SIGKILL'), 25000);
      try {
        assert.equal(renderReadyTimedOut, false, 'compiled overlay becomes render-ready');
        page.setDefaultTimeout(5000);
        await page.waitForFunction((selector: string) => {
          const image = Reflect.get(globalThis, 'document').querySelector(`${selector} img`);
          return image?.complete && image.naturalWidth === 80 && image.naturalHeight === 160;
        }, { timeout: 5000 }, host);
        const offset = selected ? 0 : 2;
        const stateAt = async (local: number) => {
          await seek(page, local + offset, { exactTime: true });
          return page.evaluate((selector: string) => {
            const document = Reflect.get(globalThis, 'document');
            const style = Reflect.get(globalThis, 'getComputedStyle');
            const root = document.querySelector(selector);
            const visible = (element: any): boolean => {
              for (let current = element; current; current = current.parentElement) {
                const css = style(current);
                if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
              }
              return element.getBoundingClientRect().width > 0;
            };
            const images = [...root.querySelectorAll('[data-preview-presenter] img')];
            const image = images.find(visible) ?? images[0];
            const frame = image.parentElement;
            const captions = [...root.querySelectorAll('[data-preview-subtitle] p')];
            const caption = captions.find(visible);
            const captionBounds = (caption ?? captions[0]).getBoundingClientRect();
            const audio = document.querySelector('#review-audio');
            return { supportBottom: document.querySelector('#review-support').getBoundingClientRect().bottom, captionFits: captions.every((p: any) => p.scrollHeight <= p.clientHeight), portrait: images.some(visible), caption: caption?.textContent ?? '', whiteSpace: style(captions[0]).whiteSpace,
              captionBounds: { x: captionBounds.x, y: captionBounds.y, width: captionBounds.width, height: captionBounds.height },
              bounds: { x: frame.getBoundingClientRect().x, y: frame.getBoundingClientRect().y, width: frame.getBoundingClientRect().width, height: frame.getBoundingClientRect().height },
              radius: style(frame).borderRadius, zoom: style(image).transform, audioOffset: audio.getAttribute('data-media-start') };
          }, host);
        };
        const expected = (local: number) => ({ portrait: local >= .25 && local < 1 || local >= 1.5 && local < 3.5,
          caption: local >= (selected ? 0 : -.5) && local < .5 ? 'Opening.' : local >= 1 && local < 2 ? 'Second <literal> & line\nContinued.' : local >= 3.5 && local < (selected ? 4 : 4.5) ? 'Closing.' : '' });
        const direct = await stateAt(1.75);
        assert.deepEqual({ portrait: direct.portrait, caption: direct.caption }, expected(1.75), 'direct seek mounts both layers');
        assert.deepEqual(direct.bounds, { x: 480, y: 20, width: 120, height: 120 });
        assert.equal(direct.radius, '12px');
        assert.equal(direct.zoom, 'matrix(1.5, 0, 0, 1.5, 0, 0)');
        assert.match(direct.whiteSpace, /pre/);
        assert.ok(direct.captionBounds.y >= direct.supportBottom, 'subtitle band must clear the standard two-line support block');
        assert.equal(direct.captionBounds.x, 32, 'caption band begins 5% from the left');
        assert.equal(direct.captionBounds.width, 416, 'caption band uses 65% of the canvas and leaves the presenter area free');
        assert.ok(Math.abs(direct.captionBounds.height - 80 / 3) < .1, 'caption band scales with canvas height');
        assert.ok(Math.abs(direct.captionBounds.y - (360 - 80 / 3)) < .1, 'caption band stays at the bottom despite authored .clip inset:0');
        assert.equal(direct.captionFits, true, 'two subtitle lines fit inside their band');
        assert.equal(direct.audioOffset, selected ? '2' : '0');
        const screenshot = join(project, `crop-${selected}.png`);
        await page.screenshot({ path: screenshot });
        const pixels = (await run('ffmpeg', ['-v', 'error', '-i', screenshot, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeout: 10000, encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
        const pixel = (x: number, y: number) => [...pixels.subarray((y * 640 + x) * 3, (y * 640 + x) * 3 + 3)];
        assert.deepEqual(pixel(540, 130), [255, 0, 0], 'top-centred zoomed cover crop shows the upper portrait instead of its blue lower half');
        assert.deepEqual(pixel(480, 20), [0, 0, 0], 'rounded frame clips the portrait corner');
        assert.deepEqual(pixel(610, 80), [0, 0, 0], 'zoomed portrait cannot spill beyond its fixed frame');
        for (const local of [0, .25, .5, 1, 1.5, 2, 3.5, 3.75, 4, 3.5, 3, 2, 1.5, 1, .5, .25, 0, 1.75]) {
          const state = await stateAt(local);
          assert.deepEqual({ portrait: state.portrait, caption: state.caption }, expected(local), `${selected ? 'selected' : 'full'} seek ${local}: half-open boundaries and gaps are independent of seek history`);
        }
        if (!selected) for (const local of [-1, -.5, 4.5, 5]) {
          const state = await stateAt(local);
          assert.deepEqual({ portrait: state.portrait, caption: state.caption }, expected(local), `full film leading/trailing gap at ${local}`);
        }
        assert.deepEqual(failures, [], 'overlay runtime and retained assets load without errors');
      } finally {
        clearTimeout(watchdog);
        await browser.close();
      }
    } finally {
      await server.close();
    }
  }
  for (const { name, bytes } of retained) assert.deepEqual(await readFile(join(project, name)), bytes, `${name} remains byte-identical after selected and full previews`);
});
