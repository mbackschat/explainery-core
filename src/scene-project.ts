import { cp, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { assembleIndex } from './assemble.ts';
import { addPreviewNarration } from './preview-narration.ts';
import { audioDuration } from './hyperframes.ts';
import { checkTiming } from './schemas.ts';
import { selectScenes, storyCompositions, type SceneSelection } from './story.ts';
import { loadStory, validateStoryTiming } from './validate.ts';
import type { Story, Timing } from './types.ts';

export interface PreparedSceneProject {
  directory: string;
  start: number;
  duration: number;
  sceneIds: string[];
}

const seconds = (value: number) => String(Number(value.toFixed(6)));
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const excluded = new Set(['index.html', 'story.yaml', 'timing.json', 'renders', 'explainer', 'explainer.html', 'original-material', 'reference', 'verification', 'docs', 'scripts', 'tests']);

async function synchronize(source: string, destination: string): Promise<void> {
  const sourceStat = await stat(source);
  const existing = await lstat(destination).catch(error => { if (!missing(error)) throw error; return undefined; });
  if (existing?.isSymbolicLink() || (existing && existing.isDirectory() !== sourceStat.isDirectory())) await rm(destination, { recursive: true, force: true });
  if (sourceStat.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const names = await readdir(source);
    for (const name of await readdir(destination)) if (!names.includes(name)) await rm(join(destination, name), { recursive: true, force: true });
    for (const name of names) await synchronize(join(source, name), join(destination, name));
  } else {
    // HyperFrames 0.8.142 core/safePath resolves realpaths; source symlinks fail its project-root boundary.
    await cp(source, destination, { dereference: true, force: true });
  }
}

async function refreshSources(project: string, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const names = (await readdir(project)).filter(name => !name.startsWith('.') && !excluded.has(name));
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
      await synchronize(join(project, name), destination);
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

async function loadSource(project: string): Promise<{ story: Story; timing: Timing; sourceHTML: string }> {
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
  return { story, timing, sourceHTML };
}

function assembledPage(sourceHTML: string, story: Story, timing: Timing): Page {
  const assembled = assembleIndex(sourceHTML, story, timing);
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
 * Optional narration adds estimated script captions only to this disposable view; an empty selection in that
 * mode previews the full film, including leading and trailing gaps.
 */
export async function prepareSceneProject(projectDir: string, sceneIds: string[], { narration = false }: { narration?: boolean } = {}): Promise<PreparedSceneProject> {
  const project = resolve(projectDir);
  const { story, timing, sourceHTML } = await loadSource(project);
  const selection = !sceneIds.length && narration
    ? { start: 0, end: timing.duration, duration: timing.duration, compositionIds: new Set(storyCompositions(story).map(part => part.id)) }
    : selectScenes(story, timing, sceneIds);
  const document = assembledPage(sourceHTML, story, timing);
  retimeRoot(document, selection);
  retimeHosts(document, story, timing, selection);
  retimeSharedElements(document, selection);
  await retimeAudio(document, project, selection);

  if (narration) addPreviewNarration(document, story, timing, selection);
  const directory = sceneIds.length
    ? join(project, '.explainery', 'scenes', `${story.id}--${sceneIds.join('--')}`)
    : join(project, '.explainery', 'preview', `${story.id}--full`);
  await refreshSources(project, directory);
  await writeFile(join(directory, 'index.html'), document.toString());
  return { directory, start: selection.start, duration: selection.duration, sceneIds: [...sceneIds] };
}
