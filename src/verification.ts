import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { renderChapters } from './chapters.ts';
import { hyperframesDist } from './hyperframes.ts';
import { prepareSceneProject } from './scene-project.ts';
import { beatNarration } from './narration.ts';
import { storyScenes, selectScenes } from './story.ts';
import { validateProject } from './validate.ts';
import type { Scene, Story, Timing } from './types.ts';

const run = promisify(execFile);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const digest = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
interface Receipt { passed: boolean; failures: string[]; humanReview: 'pending'; receiptPath: string }
function base(out: string, name: string): Receipt { return { passed: false, failures: [], humanReview: 'pending', receiptPath: join(resolve(out), `${name}.json`) }; }
async function save<T extends Receipt>(receipt: T): Promise<T> {
  receipt.passed = receipt.failures.length === 0;
  await mkdir(dirname(receipt.receiptPath), { recursive: true });
  await writeFile(receipt.receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

export interface VideoVerificationReceipt extends Receipt {
  kind: 'video'; video: string; sha256?: string; decode: boolean; metadata?: MediaProbe;
}
interface MediaProbe {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; avg_frame_rate?: string; field_order?: string }>;
  chapters?: Array<{ start_time: string; end_time: string; tags?: { title?: string } }>;
}
/** Checks the delivered bytes; success records machine checks and never implies a person watched the film. */
export async function verifyVideo(video: string, options: { out: string; story: Story; timing: Timing; sceneIds?: string[]; compositionIds?: string[]; expectedSha256?: string; timeoutMs?: number }): Promise<VideoVerificationReceipt> {
  const receipt: VideoVerificationReceipt = { ...base(options.out, 'video-receipt'), kind: 'video', video: resolve(video), decode: false };
  const timeout = options.timeoutMs ?? 60000;
  try {
    receipt.sha256 = await fileHash(video);
    if (options.expectedSha256 && options.expectedSha256 !== receipt.sha256) receipt.failures.push('video hash does not match expected SHA-256');
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_chapters', '-show_entries', 'format=duration', '-of', 'json', resolve(video)], { timeout: Math.min(timeout, 30000), maxBuffer: 4 * 1024 * 1024 });
    const metadata: MediaProbe = JSON.parse(stdout);
    receipt.metadata = metadata;
    const { chapters, duration: selectedDuration } = renderChapters(options.story, options.timing, options);
    const duration = Number(metadata.format?.duration);
    if (!Number.isFinite(duration) || Math.abs(duration - selectedDuration) > 1 / options.story.canvas.fps + .01) receipt.failures.push('video duration does not match selected timing');
    const videoStream = metadata.streams?.find(stream => stream.codec_type === 'video');
    if (videoStream?.codec_name !== 'h264') receipt.failures.push('video codec must be h264');
    if (videoStream?.width !== options.story.canvas.width || videoStream?.height !== options.story.canvas.height) receipt.failures.push('video dimensions do not match the story canvas');
    const [numerator, denominator] = (videoStream?.avg_frame_rate ?? '').split('/').map(Number);
    const fps = numerator / denominator;
    if (!Number.isFinite(fps) || Math.abs(fps - options.story.canvas.fps) > .001) receipt.failures.push('video frame rate does not match the story canvas');
    if (videoStream?.pix_fmt !== 'yuv420p') receipt.failures.push('video pixel format must be yuv420p');
    if (videoStream?.field_order !== 'progressive') receipt.failures.push('video must be progressive');
    if (metadata.streams?.some(stream => stream.codec_type === 'audio' && stream.codec_name !== 'aac')) receipt.failures.push('audio codec must be aac');
    if (options.timing.audio && !metadata.streams?.some(stream => stream.codec_type === 'audio')) receipt.failures.push('expected narration audio stream is missing');
    if (metadata.chapters?.length !== chapters.length || chapters.some((expected, index) => {
      const actual = metadata.chapters?.[index];
      const end = index === chapters.length - 1 ? duration : expected.end;
      return !actual || actual.tags?.title !== expected.title || Math.abs(Number(actual.start_time) - expected.start) > .001 || Math.abs(Number(actual.end_time) - end) > .001;
    })) receipt.failures.push('video chapters do not match editorial scene chapters');
    await run('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', resolve(video), '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'], { timeout, maxBuffer: 4 * 1024 * 1024 });
    receipt.decode = true;
    if (await fileHash(video) !== receipt.sha256) receipt.failures.push('video changed during verification');
  } catch (error) { receipt.failures.push(message(error)); }
  return save(receipt);
}

interface FrameEvidence { composition: string; context: 'full' | 'isolated'; cue: string; at: number; file: string; sha256: string; narration?: string }
interface Comparison { composition: string; context: 'full' | 'isolated'; forward: boolean; backward: boolean; isolationMaxChannelDifference?: number }
export interface FilmVerificationOptions {
  out: string;
  sceneIds?: string[];
  /** Captures only this composition's frames; it must belong to a selected scene. */
  composition?: string;
  /** Captures only beat and closing frames, skipping the seek-history and isolation comparisons. */
  quick?: boolean;
  timeoutMs?: number;
  isolationTolerance?: number;
}
export interface FilmVerificationReceipt extends Receipt {
  kind: 'film'; project: string; sceneIds: string[]; composition?: string; quick: boolean; isolationTolerance: number; frames: FrameEvidence[]; comparisons: Comparison[]; contactSheetPath: string; sourceHashes: Record<string, string>;
}
// HyperFrames 0.8.142 ships capture helpers only in hashed CLI chunks, just like its bundler (explainer-file.ts).
async function helper(project: string, symbol: string): Promise<any> {
  const dist = hyperframesDist(project);
  for (const name of await readdir(dist)) {
    if (!name.endsWith('.js')) continue;
    const source = await readFile(join(dist, name), 'utf8');
    if (!source.includes(`function ${symbol}(`)) continue;
    const module = await import(pathToFileURL(join(dist, name)).href);
    if (typeof module[symbol] === 'function') return module[symbol];
  }
  throw new Error(`project-pinned HyperFrames no longer exports ${symbol}; verification adapter needs updating`);
}
async function pixels(file: string): Promise<Buffer> {
  return (await run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { encoding: 'buffer', timeout: 10000, maxBuffer: 64 * 1024 * 1024 })).stdout;
}
async function pixelDifference(left: string, right: string): Promise<number> {
  const [a, b] = await Promise.all([pixels(left), pixels(right)]);
  if (a.length !== b.length) throw new Error('isolated/full frame sizes differ');
  let maximum = 0;
  for (let index = 0; index < a.length; index++) maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
  return maximum;
}
/**
 * Counts the rendered lines of a composition's headline from its text's line boxes, which neither the copy wipe's
 * clip-path nor stage transforms change. A wrapped headline pushes the support line out of the theme's copy block.
 */
const headlineLines = (page: any, composition: string): Promise<number> => page.evaluate((id: string) => {
  const document = Reflect.get(globalThis, 'document');
  const element = document.querySelector(`[data-composition-id="${id}"] [data-copy="headline"]`);
  if (!element) return 0;
  const range = document.createRange();
  range.selectNodeContents(element);
  return new Set([...range.getClientRects()].filter((rect: any) => rect.width > 0).map((rect: any) => Math.round(rect.top))).size;
}, composition);
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Captures selected scenes without changing focus, recording the explicit per-channel isolation tolerance. */
export async function verifyFilm(project: string, options: FilmVerificationOptions): Promise<FilmVerificationReceipt> {
  const out = resolve(options.out);
  const quick = options.quick ?? false;
  const receipt: FilmVerificationReceipt = { ...base(out, 'film-receipt'), kind: 'film', project: resolve(project), sceneIds: options.sceneIds ?? [], ...(options.composition === undefined ? {} : { composition: options.composition }), quick, isolationTolerance: options.isolationTolerance ?? 1, frames: [], comparisons: [], sourceHashes: {}, contactSheetPath: join(out, 'contact-sheet.html') };
  await mkdir(out, { recursive: true });
  try {
    if (!Number.isInteger(receipt.isolationTolerance) || receipt.isolationTolerance < 0 || receipt.isolationTolerance > 255) throw new Error('isolationTolerance must be an integer from 0 to 255');
    const validated = await validateProject(project);
    if (validated.errors.length || !validated.story || !validated.timing) throw new Error(validated.errors.join('\n') || 'story and timing are required');
    const { story, timing } = validated;
    const scenes = storyScenes(story);
    const requested = options.sceneIds ?? [];
    if (requested.length) selectScenes(story, timing, requested);
    const selected = requested.length ? scenes.filter(scene => requested.includes(scene.id)) : scenes;
    const verified = options.composition === undefined ? selected : [compositionScene(selected, scenes, options.composition)];
    receipt.sceneIds = verified.map(scene => scene.id);
    for (const name of ['story.yaml', 'timing.json', 'index.html']) receipt.sourceHashes[name] = await fileHash(join(project, name));
    const bundle = await helper(project, 'bundleWithLocalizedFonts');
    const serve = await helper(project, 'serveStaticProjectHtml');
    const open = await helper(project, 'openSettledCompositionPage');
    const seekTimeline = await helper(project, 'seekCompositionTimeline');
    const fullHtml = await bundle(project);
    receipt.sourceHashes.bundle = digest(fullHtml);
    const full = await serve(project, fullHtml);
    try {
      for (const scene of verified) {
        const compositions = scene.compositions.filter(composition => options.composition === undefined || composition.id === options.composition);
        // The isolated scene view exists only for the isolation comparison, which a quick check skips.
        const prepared = quick ? undefined : await prepareSceneProject(project, [scene.id]);
        const isolatedHtml = prepared && await bundle(prepared.directory);
        const isolated = prepared && await serve(prepared.directory, isolatedHtml);
        const views = [
          { context: 'full' as const, html: fullHtml, url: full.url, offset: 0, end: timing.duration },
          ...(prepared ? [{ context: 'isolated' as const, html: isolatedHtml, url: isolated.url, offset: prepared.start, end: prepared.duration }] : []),
        ];
        const fullMidpoints = new Map<string, FrameEvidence>();
        try {
          for (const { context, html, url, offset, end } of views) {
            const { browser, page, renderReadyTimedOut } = await open(html, url, { renderReadyTimeoutMs: 5000, navigationTimeoutMs: 10000, browserGpuMode: 'software', beforeNavigate: (page: { on(event: string, listener: (error: Error) => void): void }) => page.on('pageerror', error => receipt.failures.push(`${scene.id}/${context}: ${message(error)}`)) });
            const watchdog = setTimeout(() => browser.process()?.kill('SIGKILL'), options.timeoutMs ?? 60000);
            try {
              if (renderReadyTimedOut) receipt.failures.push(`${scene.id}/${context}: runtime did not become ready`);
              page.setDefaultTimeout(10000);
              const seek = (at: number) => seekTimeline(page, at, { exactTime: true });
              const capture = async (composition: string, cue: string, at: number, narration?: string): Promise<FrameEvidence> => {
                await seek(at - offset);
                const data = await page.screenshot({ timeout: 10000 });
                const file = `${receipt.frames.length.toString().padStart(4, '0')}-${composition}-${context}.png`;
                await writeFile(join(out, file), data);
                const frame: FrameEvidence = { composition, context, cue, at, file, sha256: digest(data), ...(narration === undefined ? {} : { narration }) };
                receipt.frames.push(frame);
                return frame;
              };
              for (const [compositionIndex, composition] of compositions.entries()) {
                const slot = timing.scenes[composition.id];
                if (!quick) {
                  if (compositionIndex > 0) {
                    await page.reload({ waitUntil: 'load', timeout: 10000 });
                    await page.waitForFunction(() => Reflect.get(globalThis, '__renderReady') === true, { timeout: 10000 });
                  }
                  const at = slot.start + slot.duration / 2;
                  const direct = await capture(composition.id, 'direct', at);
                  await seek(0);
                  await seek(Math.max(0, at - offset - 2));
                  const forward = await capture(composition.id, 'forward', at);
                  await seek(Math.max(0, end - 1 / story.canvas.fps));
                  const backward = await capture(composition.id, 'backward', at);
                  const comparison: Comparison = { composition: composition.id, context, forward: direct.sha256 === forward.sha256, backward: direct.sha256 === backward.sha256 };
                  if (!comparison.forward || !comparison.backward) receipt.failures.push(`${composition.id}/${context}: seek history changes midpoint pixels`);
                  if (context === 'full') fullMidpoints.set(composition.id, direct);
                  else {
                    const original = fullMidpoints.get(composition.id)!;
                    comparison.isolationMaxChannelDifference = original.sha256 === direct.sha256 ? 0 : await pixelDifference(join(out, original.file), join(out, direct.file));
                    if (comparison.isolationMaxChannelDifference > receipt.isolationTolerance) receipt.failures.push(`${composition.id}: isolated/full pixels differ by more than ${receipt.isolationTolerance} channel levels`);
                  }
                  receipt.comparisons.push(comparison);
                }
                if (context === 'full') {
                  const spoken = beatNarration(composition.narration);
                  for (const [cue, seconds] of Object.entries(slot.beats)) await capture(composition.id, cue, Math.min(slot.start + seconds + .3, slot.start + slot.duration - 1 / story.canvas.fps), spoken[cue]);
                  await capture(composition.id, 'closing', slot.start + slot.duration - 1 / story.canvas.fps);
                  const lines = await headlineLines(page, composition.id);
                  if (lines > 1) receipt.failures.push(`${composition.id}: headline wraps onto ${lines} lines; shorten it to fit one line`);
                }
              }
              if (context === 'full' && !quick) {
                const index = scenes.indexOf(scene);
                const joins = [...scene.compositions.slice(index > 0 ? 0 : 1), ...(scenes[index + 1]?.compositions.slice(0, 1) ?? [])];
                for (const composition of joins.filter(composition => options.composition === undefined || composition.id === options.composition)) for (const delta of [-.1, .3]) await capture(composition.id, `join ${delta}`, Math.max(0, Math.min(timing.duration - 1 / story.canvas.fps, timing.scenes[composition.id].start + delta)));
              }
            } finally { try { await browser.close(); } finally { clearTimeout(watchdog); } }
          }
        } finally { await isolated?.close(); }
      }
    } finally { await full.close(); }
  } catch (error) { receipt.failures.push(message(error)); }
  await writeFile(receipt.contactSheetPath, contactSheet(receipt));
  return save(receipt);
}

// The selected scene that owns a composition filter; a composition elsewhere in the film is reported as such.
function compositionScene(selected: Scene[], scenes: Scene[], composition: string): Scene {
  const owner = scenes.find(scene => scene.compositions.some(candidate => candidate.id === composition));
  if (!owner) throw new Error(`unknown composition "${composition}"`);
  if (!selected.includes(owner)) throw new Error(`composition "${composition}" is not in the selected scene${selected.length === 1 ? '' : 's'} ${selected.map(scene => `"${scene.id}"`).join(', ')}; it belongs to "${owner.id}"`);
  return owner;
}

/** The HTML review sheet: one captioned image per frame, with the narration spoken in each beat frame's beat. */
export function contactSheet(receipt: Pick<FilmVerificationReceipt, 'frames' | 'failures' | 'quick'>): string {
  const caption = (frame: FrameEvidence) => `${escape(`${frame.composition} · ${frame.context} · ${frame.cue} · ${frame.at.toFixed(3)}s`)}${frame.narration ? `<br><q>${escape(frame.narration)}</q>` : ''}`;
  const scope = receipt.quick ? '<p>Quick check: beat and closing frames only; no seek-history or isolation comparisons.</p>' : '';
  return `<!doctype html><meta charset="utf-8"><title>Verification evidence</title><style>body{font:16px sans-serif;background:#eee}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}figure{margin:0}img{width:100%}</style><h1>Machine captures — human review pending</h1>${scope}<p>${escape(receipt.failures.join('; '))}</p><main>${receipt.frames.map(frame => `<figure><img src="${escape(frame.file)}"><figcaption>${caption(frame)}</figcaption></figure>`).join('')}</main>`;
}

export interface HtmlVerificationReceipt extends Receipt { kind: 'html'; file: string; sha256?: string; networkRequests: string[]; nonEmbeddedRequests: string[]; players: number; chapters: number; embeddedAudio: number; decodedAudio: number; subtitles: boolean }
/** Opens a standalone delivery with network access blocked and exercises its actual player controls. */
export async function verifyHtml(file: string, options: { out: string; project?: string; expectAudio?: boolean; expectSubtitles?: boolean }): Promise<HtmlVerificationReceipt> {
  const receipt: HtmlVerificationReceipt = { ...base(options.out, 'html-receipt'), kind: 'html', file: resolve(file), networkRequests: [], nonEmbeddedRequests: [], players: 0, chapters: 0, embeddedAudio: 0, decodedAudio: 0, subtitles: false };
  try {
    receipt.sha256 = await fileHash(file);
    const { stdout } = await run(process.execPath, [join(hyperframesDist(options.project ?? dirname(resolve(file))), 'cli.js'), 'browser', 'path'], { timeout: 15000 });
    const browser = await chromium.launch({ executablePath: stdout.trim().split('\n').at(-1), args: ['--disable-gpu'], timeout: 15000 });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => receipt.failures.push(error.message));
      const entryUrl = pathToFileURL(resolve(file)).href;
      const embedded = (url: string) => /^(?:data|blob|about):/i.test(url);
      let initialNavigation = true;
      page.on('request', request => {
        if (initialNavigation && request.isNavigationRequest() && request.frame() === page.mainFrame() && request.url() === entryUrl) {
          initialNavigation = false;
          return;
        }
        if (embedded(request.url())) return;
        receipt.nonEmbeddedRequests.push(request.url());
        receipt.failures.push(`nonembedded resource: ${request.url()}`);
        if (/^https?:/i.test(request.url())) receipt.networkRequests.push(request.url());
      });
      page.on('requestfailed', request => receipt.failures.push(`resource request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown error'})`));
      await page.route('**/*', route => {
        const request = route.request();
        if (embedded(request.url()) || (request.isNavigationRequest() && request.frame() === page.mainFrame() && request.url() === entryUrl)) return route.continue();
        return route.abort();
      });
      await page.goto(entryUrl, { waitUntil: 'load', timeout: 15000 });
      receipt.players = await page.locator('hyperframes-player').count();
      if (!receipt.players) receipt.failures.push('delivery contains no players');
      for (let index = 0; index < receipt.players; index++) {
        await page.locator('hyperframes-player').nth(index).scrollIntoViewIfNeeded();
        await page.waitForFunction(`document.querySelectorAll('hyperframes-player')[${index}].ready`, null, { timeout: 15000 });
      }
      const chapters = page.locator('.explainer-chapters option');
      receipt.chapters = await chapters.count();
      for (let index = 0; index < receipt.chapters; index++) {
        const value = await chapters.nth(index).getAttribute('value');
        await page.locator('.explainer-chapters').selectOption(value!);
        await page.waitForFunction(`Math.abs(document.querySelector('.explainer-film').currentTime - ${Number(value)}) < .05`);
      }
      const decodedSources = new Set<string>();
      for (const frame of page.frames()) {
        await frame.waitForLoadState('load', { timeout: 10000 });
        const failedImages = await frame.locator('img').evaluateAll(elements => elements.filter((element: any) => !element.complete || element.naturalWidth === 0).map((element: any) => String(element.currentSrc || element.src || '(no source)')));
        for (const source of failedImages) receipt.failures.push(`image failed to load: ${source.slice(0, 200)}`);
        receipt.embeddedAudio += await frame.locator('audio[src^="data:audio/"], audio:has(source[src^="data:audio/"])').count();
        if (options.expectAudio) for (const audio of await frame.locator('audio[src^="data:audio/"], audio:has(source[src^="data:audio/"])').all()) {
          const source = await audio.evaluate((element: any) => String(element.currentSrc || element.src || element.querySelector('source')?.src));
          const key = digest(source);
          if (decodedSources.has(key)) continue;
          await audio.evaluate(async (_element: unknown, source: string) => {
            const AudioContext = Reflect.get(globalThis, 'AudioContext');
            const context = new AudioContext();
            const timeout = setTimeout(() => { void context.close(); }, 10000);
            try {
              const response = await fetch(source);
              const decoded = await context.decodeAudioData(await response.arrayBuffer());
              if (!(decoded.duration > 0)) throw new Error('embedded audio decoded to an empty buffer');
            } finally { clearTimeout(timeout); await context.close(); }
          }, source);
          decodedSources.add(key);
          receipt.decodedAudio++;
        }
      }
      if (options.expectAudio && receipt.embeddedAudio === 0) receipt.failures.push('expected embedded narration audio is missing');
      const cc = page.getByRole('button', { name: 'Subtitles', exact: true });
      receipt.subtitles = await cc.count() > 0;
      if (receipt.subtitles) { await cc.click(); if (await cc.getAttribute('aria-pressed') !== 'true') receipt.failures.push('subtitle toggle did not activate'); }
      if (options.expectSubtitles && !receipt.subtitles) receipt.failures.push('expected subtitles are missing');
      if (receipt.networkRequests.length) receipt.failures.push('standalone HTML requested network resources');
      if (!receipt.chapters) receipt.failures.push('chapter selector is missing');
      if (await fileHash(file) !== receipt.sha256) receipt.failures.push('HTML changed during verification');
    } finally { await browser.close(); }
  } catch (error) { receipt.failures.push(message(error)); }
  return save(receipt);
}
