import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parseHTML } from 'linkedom';
import { parseExportSubtitles } from './export-subtitles.ts';
import { storyCompositions, type SceneSelection } from './story.ts';
import type { Story, Timing } from './types.ts';

interface Frame {
  x: number; y: number; width: number; height: number;
  shape: 'circle' | 'rectangle'; radius: number; zoom: number;
}
interface Appearance { composition: string; start: number; end: number }
interface Presenter { source: string; destination: string; frame: Frame; appearances: Appearance[] }

function fields(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`presenter ${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`presenter ${label}: unknown field "${key}"`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Error(`presenter ${label} must be finite and >= ${minimum}`);
  return value;
}

function within(project: string, path: string): boolean {
  const local = relative(project, path);
  return local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

async function presenterPlan(path: string, project: string, story: Story, timing: Timing): Promise<Presenter> {
  let input: unknown;
  try { input = JSON.parse(await readFile(resolve(path), 'utf8')); }
  catch (error) { throw new Error(`presenter plan could not be read: ${path}`, { cause: error }); }
  const plan = fields(input, ['portrait', 'frame', 'appearances'], 'plan');
  const frameInput = fields(plan.frame, ['x', 'y', 'width', 'height', 'shape', 'radius', 'zoom'], 'frame');
  const x = number(frameInput.x, 'frame.x');
  const y = number(frameInput.y, 'frame.y');
  const width = number(frameInput.width, 'frame.width');
  const height = number(frameInput.height, 'frame.height');
  if (!width || !height || x + width > story.canvas.width || y + height > story.canvas.height) throw new Error('presenter frame must have positive dimensions and fit within the canvas');
  if (frameInput.shape !== 'circle' && frameInput.shape !== 'rectangle') throw new Error('presenter frame.shape must be circle or rectangle');
  if (frameInput.shape === 'circle' && (width !== height || 'radius' in frameInput)) throw new Error('presenter circle must be square and must not specify radius');
  const radius = frameInput.radius === undefined ? 0 : number(frameInput.radius, 'frame.radius');
  if (radius > Math.min(width, height) / 2) throw new Error('presenter rectangle radius cannot exceed half its shorter edge');
  const frame: Frame = { x, y, width, height, shape: frameInput.shape, radius, zoom: frameInput.zoom === undefined ? 1 : number(frameInput.zoom, 'frame.zoom', 1) };
  if (!Array.isArray(plan.appearances) || !plan.appearances.length) throw new Error('presenter appearances must be a nonempty array');
  const compositions = new Set(storyCompositions(story).map(composition => composition.id));
  const appearances = plan.appearances.map((input, index): Appearance => {
    const appearance = fields(input, ['composition', 'start', 'end'], `appearance ${index}`);
    if (typeof appearance.composition !== 'string' || !compositions.has(appearance.composition)) throw new Error(`presenter appearance ${index}: unknown composition`);
    const slot = timing.scenes[appearance.composition];
    if (!slot) throw new Error(`presenter appearance ${index}: missing composition timing`);
    const start = number(appearance.start, `appearance ${index}.start`);
    const end = number(appearance.end, `appearance ${index}.end`);
    if (end <= start || end > slot.duration) throw new Error(`presenter appearance ${index} must be a positive window within its composition`);
    return { composition: appearance.composition, start: slot.start + start, end: slot.start + end };
  }).sort((a, b) => a.start - b.start);
  if (appearances.some((appearance, index) => index > 0 && appearance.start < appearances[index - 1].end)) throw new Error('presenter appearances overlap on the film clock');
  if (typeof plan.portrait !== 'string' || !plan.portrait || isAbsolute(plan.portrait) || /^[a-z][a-z\d+.-]*:/i.test(plan.portrait)) throw new Error('presenter portrait must be a local path relative to the project');
  const extension = extname(plan.portrait).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('presenter portrait must be PNG, JPEG or WebP');
  const projectPath = resolve(project);
  const portraitPath = resolve(projectPath, plan.portrait);
  if (!within(projectPath, portraitPath)) throw new Error('presenter portrait must resolve within the project');
  let source: string;
  try {
    source = await realpath(portraitPath);
    if (!within(await realpath(projectPath), source) || !(await stat(source)).isFile()) throw new Error('not a project-local file');
  } catch (error) {
    throw new Error('presenter portrait must be an existing file within the project', { cause: error });
  }
  return { source, destination: `explainery-preview/portrait${extension}`, frame, appearances };
}

/** Validates review inputs and builds a disposable, seekable overlay composition without changing the project. */
export async function preparePreviewOverlays(project: string, story: Story, timing: Timing, selection: SceneSelection, options: { presenters?: string; subtitles?: string }): Promise<{ html: string; assets: Array<{ source: string; destination: string }> }> {
  if (options.presenters === undefined && options.subtitles === undefined) return { html: '', assets: [] };
  const presenter = options.presenters === undefined ? undefined : await presenterPlan(options.presenters, project, story, timing);
  const cues = options.subtitles === undefined ? [] : parseExportSubtitles(await readFile(resolve(options.subtitles), 'utf8'), timing.duration);
  const { document } = parseHTML('<html><head></head><body></body></html>');
  const template = document.createElement('template');
  const root = document.createElement('div');
  root.id = 'explainery-preview-overlays';
  root.setAttribute('data-composition-id', root.id);
  root.setAttribute('data-duration', String(selection.duration));
  root.setAttribute('data-width', String(story.canvas.width));
  root.setAttribute('data-height', String(story.canvas.height));
  root.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;');
  template.appendChild(root);
  const style = document.createElement('style');
  const unit = story.canvas.height / 1080;
  style.textContent = `[data-preview-subtitle] { position:absolute;top:auto;right:auto;left:5%;bottom:1.3%;width:65%;height:${112 * unit}px; }
[data-preview-subtitle] p { margin:0;box-sizing:border-box;width:100%;height:100%;padding:${12 * unit}px ${20 * unit}px;background:rgba(0,0,0,.9);color:#fff;font-family:var(--font-family,sans-serif);font-size:${32 * unit}px;line-height:${40 * unit}px;font-weight:400;white-space:pre-wrap;text-align:left; }`;
  root.appendChild(style);
  let clipIndex = 0;
  const addClip = (kind: 'presenter' | 'subtitle', start: number, end: number) => {
    start = Math.max(start, selection.start);
    end = Math.min(end, selection.end);
    if (end <= start) return undefined;
    const clip = document.createElement('div');
    clip.id = `explainery-preview-${kind}-${clipIndex++}`;
    clip.className = 'clip';
    clip.setAttribute(`data-preview-${kind}`, '');
    clip.setAttribute('data-start', String(start - selection.start));
    clip.setAttribute('data-duration', String(end - start));
    clip.setAttribute('data-preview-end', String(end - selection.start));
    root.appendChild(clip);
    return clip;
  };
  if (presenter) {
    const frame = presenter.frame;
    for (const appearance of presenter.appearances) {
      if (selection.compositionIds.size && !selection.compositionIds.has(appearance.composition)) continue;
      const clip = addClip('presenter', appearance.start, appearance.end);
      if (!clip) continue;
      clip.setAttribute('style', `position:absolute;left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;overflow:hidden;border-radius:${frame.shape === 'circle' ? '50%' : `${frame.radius}px`};`);
      const image = document.createElement('img');
      image.setAttribute('src', presenter.destination);
      image.setAttribute('data-preview-content', '');
      if (frame.zoom > 1) image.setAttribute('data-layout-allow-overflow', '');
      image.setAttribute('style', `display:block;width:100%;height:100%;object-fit:cover;object-position:50% 0;transform:scale(${frame.zoom});transform-origin:50% 0;opacity:0;`);
      clip.appendChild(image);
    }
  }
  for (const cue of cues) {
    const clip = addClip('subtitle', cue.start, cue.end);
    if (!clip) continue;
    const text = document.createElement('p');
    text.setAttribute('data-preview-content', '');
    text.setAttribute('style', 'opacity:0;');
    text.textContent = cue.text;
    clip.appendChild(text);
  }
  const script = document.createElement('script');
  // The proposal's half-open intervals use child opacity because HyperFrames owns .clip visibility (hyperframes-core skill).
  script.textContent = `const timeline = gsap.timeline({ paused: true });
for (const clip of document.querySelectorAll('[data-preview-presenter], [data-preview-subtitle]')) {
  const start = Number(clip.getAttribute('data-start'));
  const end = Number(clip.getAttribute('data-preview-end'));
  const style = clip.querySelector('[data-preview-content]').style;
  style.opacity = start === 0 ? '1' : '0';
  if (start > 0) timeline.set(style, { opacity: 1 }, start);
  timeline.set(style, { opacity: 0 }, end);
}
timeline.to({}, { duration: ${selection.duration} }, 0);
timeline.seek(0);
window.__timelines['explainery-preview-overlays'] = timeline;`;
  root.appendChild(script);
  return { html: template.toString(), assets: presenter ? [{ source: presenter.source, destination: presenter.destination }] : [] };
}
