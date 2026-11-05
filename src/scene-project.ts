import { cp, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { assembleIndex } from './assemble.ts';
import { filmFiles } from './film-files.ts';
import { addPreviewNarration } from './preview-narration.ts';
import { preparePreviewOverlays } from './preview-overlays.ts';
import { audioDuration } from './hyperframes.ts';
import { cardLayerVariables } from './cards.ts';
import { checkTiming } from './schemas.ts';
import { selectCompositions, selectionName, selectScenes, storyCompositions, type SceneSelection } from './story.ts';
import { loadStory, validateStoryTiming } from './validate.ts';
import type { ResolvedFilm, Story, Timing } from './types.ts';

export interface PreparedSceneProject {
  directory: string;
  start: number;
  duration: number;
  /** The selected scenes; for a composition selection, the one scene containing it. */
  sceneIds: string[];
  /** The selected compositions, empty unless the view selects compositions inside one scene. */
  compositionIds: string[];
}

export interface SceneProjectOptions {
  narration?: boolean;
  compositionIds?: string[];
  /** Preview-only presenter plan and WebVTT paths, relative to the caller's working directory. */
  presenters?: string;
  subtitles?: string;
}

const seconds = (value: number) => String(Number(value.toFixed(6)));
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const excluded = new Set(['index.html', 'story.yaml', 'timing.json', 'renders', 'explainer', 'explainer.html', 'original-material', 'reference', 'verification', 'docs', 'scripts', 'tests']);

async function synchronize(source: string, destination: string, include: (path: string) => boolean): Promise<void> {
  const sourceStat = await stat(source);
  const existing = await lstat(destination).catch(error => { if (!missing(error)) throw error; return undefined; });
  if (existing?.isSymbolicLink() || (existing && existing.isDirectory() !== sourceStat.isDirectory())) await rm(destination, { recursive: true, force: true });
  if (sourceStat.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const names = (await readdir(source)).filter(name => include(join(source, name)));
    for (const name of await readdir(destination)) if (!names.includes(name)) await rm(join(destination, name), { recursive: true, force: true });
    for (const name of names) await synchronize(join(source, name), join(destination, name), include);
  } else {
    // HyperFrames 0.8.142 core/safePath resolves realpaths; source symlinks fail its project-root boundary.
    await cp(source, destination, { dereference: true, force: true });
  }
}

async function refreshSources(project: string, directory: string, resolved: ResolvedFilm): Promise<void> {
  await mkdir(directory, { recursive: true });
  const definitions = new Set(resolved.mode === 'referenced' ? [...resolved.sources.values()].map(source => resolve(project, source.definition)) : []);
  const include = (path: string): boolean => !definitions.has(path) && !(resolved.mode === 'referenced' && /\.(?:md|markdown)$/i.test(path));
  const names = (await readdir(project)).filter(name => !name.startsWith('.') && !excluded.has(name) && include(join(project, name)));
  for (const name of await readdir(directory)) {
    if (!name.startsWith('.') && name !== 'index.html' && !names.includes(name)) await rm(join(directory, name), { recursive: true, force: true });
  }
  for (const name of names) {
    const destination = join(directory, name);
    if (name === 'node_modules') {
      const target = relative(directory, join(project, name));
      const existing = await lstat(destination).catch(error => { if (!missing(error)) throw error; return undefined; });
      if (existing?.isSymbolicLink() && await readlink(destination) === target) continue;
      await rm(destination, { recursive: true, force: true });
      await symlink(target, destination);
    } else {
      await synchronize(join(project, name), destination, include);
    }
  }
}

type Page = ReturnType<typeof parseHTML>['document'];
type PageElement = Page['documentElement'];

interface AudioClip {
  start: number;
  offset: number;
  rate: number;
  duration: number;
}

async function loadSource(project: string): Promise<{ story: Story; resolved: ResolvedFilm; timing: Timing; sourceHTML: string }> {
  const [loadedStory, timingText, sourceHTML] = await Promise.all([
    loadStory(project), readFile(join(project, 'timing.json'), 'utf8'), readFile(join(project, 'index.html'), 'utf8'),
  ]);
  if (!loadedStory.value) throw new Error(loadedStory.errors.join('\n'));
  const story = loadedStory.value;
  const parsedTiming: unknown = JSON.parse(timingText);
  const timingErrors = checkTiming(parsedTiming);
  if (timingErrors.length) throw new Error(timingErrors.map(error => `timing.json ${error}`).join('\n'));
  const timing = parsedTiming as Timing;
  const errors = validateStoryTiming(story, timing);
  if (errors.length) throw new Error(errors.join('\n'));
  return { story, resolved: loadedStory.resolved, timing, sourceHTML };
}

function assembledPage(sourceHTML: string, story: Story, timing: Timing, resolved: ResolvedFilm): Page {
  const assembled = assembleIndex(sourceHTML, story, timing, resolved);
  if (assembled.errors.length) throw new Error(assembled.errors.join('\n'));
  return parseHTML(assembled.html).document;
}

function retimeRoot(document: Page, { duration }: SceneSelection): void {
  const root = document.querySelector('[data-composition-id]:not([data-composition-src])');
  if (!root) throw new Error('index.html: no root composition');
  root.setAttribute('data-start', '0');
  root.setAttribute('data-duration', seconds(duration));
}

function retimeHosts(document: Page, story: Story, timing: Timing, { start, compositionIds }: SceneSelection): void {
  const allCompositionIds = new Set(storyCompositions(story).map(composition => composition.id));
  for (const host of document.querySelectorAll('[data-composition-src]')) {
    const id = host.getAttribute('data-composition-id') ?? '';
    if (compositionIds.has(id)) host.setAttribute('data-start', seconds(timing.scenes[id].start - start));
    else if (allCompositionIds.has(id) || !host.hasAttribute('data-story-span')) host.remove();
  }
}

// Audio is excluded because its clip window is intersected separately.
function retimeSharedElements(document: Page, { duration }: SceneSelection): void {
  for (const shared of document.querySelectorAll('[data-story-span]')) {
    if (shared.localName === 'audio') continue;
    shared.setAttribute('data-start', '0');
    shared.setAttribute('data-duration', seconds(duration));
  }
}

function retimeCards(document: Page, story: Story, timing: Timing, selection: SceneSelection): void {
  for (const layer of document.querySelectorAll('[data-story-cards]')) layer.setAttribute('data-variable-values', JSON.stringify(cardLayerVariables(story, timing, selection)));
}

// The local file behind a clip, or undefined when it names none.
function localAudioPath(project: string, audio: PageElement): string | undefined {
  const src = audio.getAttribute('src') ?? audio.querySelector('source[src]')?.getAttribute('src');
  if (!src) return undefined;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) throw new Error(`scene isolation requires local audio: ${src}`);
  return isAbsolute(src) ? src : resolve(project, src.split(/[?#]/)[0]);
}

function readAudioClip(audio: PageElement, sourceDuration: number): AudioClip {
  const offset = Number(audio.getAttribute('data-playback-start') ?? audio.getAttribute('data-media-start') ?? 0);
  const rate = Number(audio.getAttribute('data-playback-rate') ?? 1);
  return { start: Number(audio.getAttribute('data-start') ?? 0), offset, rate, duration: Number(audio.getAttribute('data-duration') ?? (sourceDuration - offset) / rate) };
}

// Intersects the clip with the selected range and the media tail that really exists, advancing the source offset by the part cut off the front.
function clipWithin(clip: AudioClip, sourceDuration: number, { start, end }: SceneSelection): { from: number; to: number; mediaStart: number } | undefined {
  const from = Math.max(start, clip.start);
  const to = Math.min(end, clip.start + clip.duration, clip.start + (sourceDuration - clip.offset) / clip.rate);
  if (!(to > from)) return undefined;
  return { from, to, mediaStart: clip.offset + (from - clip.start) * clip.rate };
}

async function retimeAudio(document: Page, project: string, selection: SceneSelection): Promise<void> {
  const mediaLengths = new Map<string, number>();
  for (const audio of document.querySelectorAll('audio')) {
    if (audio.closest('[data-composition-src]')) continue;
    const media = localAudioPath(project, audio);
    if (!media) { audio.remove(); continue; }
    let sourceDuration = mediaLengths.get(media);
    if (sourceDuration === undefined) {
      sourceDuration = await audioDuration(project, media);
      mediaLengths.set(media, sourceDuration);
    }
    const kept = clipWithin(readAudioClip(audio, sourceDuration), sourceDuration, selection);
    if (!kept) { audio.remove(); continue; }
    audio.setAttribute('data-start', seconds(kept.from - selection.start));
    audio.setAttribute('data-duration', seconds(kept.to - kept.from));
    // HyperFrames 0.8.142 docs/data-attributes.md defines this as a source offset; playback-start is its legacy alias.
    audio.setAttribute('data-media-start', seconds(kept.mediaStart));
    audio.removeAttribute('data-playback-start');
  }
}

/**
 * Prepares a local HyperFrames project containing consecutive editorial scenes and the shared frame.
 *
 * Its index is assembled in memory from current story/timing and shifted to zero; the source project is never
 * rewritten. Runtime files are independent copies refreshed on every invocation, including animation/style
 * edits; node_modules keeps the project's normal dependency link. Audio is intersected with both the selected
 * range and the actual media tail, preserving source offsets. Authoring stays in the source project.
 * Optional review overlays are validated before refreshing the disposable view; an empty selection with any
 * overlay previews the full film, including leading and trailing gaps. `compositionIds` replaces the scene list with
 * consecutive compositions of one scene, on their own enclosing range.
 */
export async function prepareSceneProject(projectDir: string, sceneIds: string[], { narration = false, compositionIds = [], presenters, subtitles }: SceneProjectOptions = {}): Promise<PreparedSceneProject> {
  const project = resolve(projectDir);
  if (sceneIds.length && compositionIds.length) throw new Error('select either scenes or compositions, not both');
  if (narration && subtitles !== undefined) throw new Error('--narration and --subtitles are mutually exclusive');
  const { story, resolved, timing, sourceHTML } = await loadSource(project);
  const compositionSelection = compositionIds.length ? selectCompositions(story, timing, compositionIds) : undefined;
  const selectedSceneIds = compositionSelection ? [compositionSelection.sceneId] : sceneIds;
  const selection = compositionSelection ?? (!sceneIds.length && (narration || presenters !== undefined || subtitles !== undefined)
    ? { start: 0, end: timing.duration, duration: timing.duration, compositionIds: new Set(storyCompositions(story).map(part => part.id)) }
    : selectScenes(story, timing, sceneIds));
  const document = assembledPage(sourceHTML, story, timing, resolved);
  if (resolved.mode === 'referenced') await filmFiles(project, { resolved, rootHTML: document.toString() });
  retimeRoot(document, selection);
  retimeHosts(document, story, timing, selection);
  retimeSharedElements(document, selection);
  retimeCards(document, story, timing, selection);
  await retimeAudio(document, project, selection);

  const overlays = await preparePreviewOverlays(project, story, timing, selection, { presenters, subtitles });
  if (overlays.html) {
    if (document.querySelector('[id="explainery-preview-overlays"], [data-composition-id="explainery-preview-overlays"]')) throw new Error('explainery-preview-overlays is reserved for preview overlays');
    if (await lstat(join(project, 'explainery-preview')).catch(error => { if (!missing(error)) throw error; return undefined; })) throw new Error('explainery-preview is reserved for generated preview files');
    const host = document.createElement('div');
    for (const [name, value] of Object.entries({
      id: 'explainery-preview-overlays', class: 'clip', 'data-composition-id': 'explainery-preview-overlays',
      'data-composition-src': 'explainery-preview/overlays.html', 'data-start': '0', 'data-duration': seconds(selection.duration),
      'data-width': String(story.canvas.width), 'data-height': String(story.canvas.height),
      style: 'position:absolute;inset:0;width:100%;height:100%;z-index:2147483646;pointer-events:none',
    })) host.setAttribute(name, value);
    document.querySelector('[data-composition-id]:not([data-composition-src])')!.appendChild(host);
  }
  if (narration) addPreviewNarration(document, story, timing, selection);
  const directory = selectedSceneIds.length
    ? join(project, '.explainery', 'scenes', `${story.id}--${selectionName(selectedSceneIds, compositionIds)}`)
    : join(project, '.explainery', 'preview', `${story.id}--full`);
  await refreshSources(project, directory, resolved);
  if (overlays.html) {
    await mkdir(join(directory, 'explainery-preview'), { recursive: true });
    for (const asset of overlays.assets) await cp(asset.source, join(directory, asset.destination));
    await writeFile(join(directory, 'explainery-preview/overlays.html'), overlays.html);
  }
  await writeFile(join(directory, 'index.html'), document.toString());
  return { directory, start: selection.start, duration: selection.duration, sceneIds: [...selectedSceneIds], compositionIds: [...compositionIds] };
}
