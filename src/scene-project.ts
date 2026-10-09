import { cp, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { assembleIndex } from './assemble.ts';
import { audioDuration } from './hyperframes.ts';
import { checkTiming } from './schemas.ts';
import { sceneRange, storyCompositions, storyScenes } from './story.ts';
import { loadStory, validateStoryTiming } from './validate.ts';
import type { Timing } from './types.ts';

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

/**
 * Prepares a local HyperFrames project containing consecutive editorial scenes and the shared frame.
 *
 * Its index is assembled in memory from current story/timing and shifted to zero; the source project is never
 * rewritten. Runtime files are independent copies refreshed on every invocation, including animation/style
 * edits; node_modules keeps the project's normal dependency link. Audio is intersected with both the selected
 * range and the actual media tail, preserving source offsets. Authoring stays in the source project.
 */
export async function prepareSceneProject(projectDir: string, sceneIds: string[]): Promise<PreparedSceneProject> {
  const project = resolve(projectDir);
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

  const scenes = storyScenes(story);
  if (!sceneIds.length) throw new Error('scene selection must contain at least one scene id');
  if (new Set(sceneIds).size !== sceneIds.length) throw new Error('scene selection contains duplicate scene ids');
  const positions = sceneIds.map(id => {
    const position = scenes.findIndex(scene => scene.id === id);
    if (position < 0) throw new Error(`unknown scene "${id}"`);
    return position;
  });
  if (positions.some((position, index) => index > 0 && position !== positions[index - 1] + 1)) throw new Error('scene selection must be consecutive scenes in story order');
  const selected = positions.map(position => scenes[position]);
  const ranges = selected.map(scene => sceneRange(scene, timing));
  const start = Math.min(...ranges.map(range => range.start));
  const end = Math.max(...ranges.map(range => range.start + range.duration));
  const duration = end - start;
  const compositionIds = new Set(selected.flatMap(scene => scene.compositions.map(composition => composition.id)));
  const allCompositionIds = new Set(storyCompositions(story).map(composition => composition.id));
  const assembled = assembleIndex(sourceHTML, story, timing);
  if (assembled.errors.length) throw new Error(assembled.errors.join('\n'));
  const { document } = parseHTML(assembled.html);
  const root = document.querySelector('[data-composition-id]:not([data-composition-src])');
  if (!root) throw new Error('index.html: no root composition');
  root.setAttribute('data-start', '0');
  root.setAttribute('data-duration', seconds(duration));

  for (const host of document.querySelectorAll('[data-composition-src]')) {
    const id = host.getAttribute('data-composition-id') ?? '';
    if (compositionIds.has(id)) host.setAttribute('data-start', seconds(timing.scenes[id].start - start));
    else if (allCompositionIds.has(id) || !host.hasAttribute('data-story-span')) host.remove();
  }
  for (const shared of document.querySelectorAll('[data-story-span]')) {
    if (shared.localName === 'audio') continue;
    shared.setAttribute('data-start', '0');
    shared.setAttribute('data-duration', seconds(duration));
  }

  const mediaLengths = new Map<string, number>();
  for (const audio of document.querySelectorAll('audio')) {
    if (audio.closest('[data-composition-src]')) continue;
    const src = audio.getAttribute('src') ?? audio.querySelector('source[src]')?.getAttribute('src');
    if (!src) { audio.remove(); continue; }
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) throw new Error(`scene isolation requires local audio: ${src}`);
    const media = isAbsolute(src) ? src : resolve(project, src.split(/[?#]/)[0]);
    let sourceDuration = mediaLengths.get(media);
    if (sourceDuration === undefined) {
      sourceDuration = await audioDuration(project, media);
      mediaLengths.set(media, sourceDuration);
    }
    const clipStart = Number(audio.getAttribute('data-start') ?? 0);
    const offset = Number(audio.getAttribute('data-playback-start') ?? audio.getAttribute('data-media-start') ?? 0);
    const rate = Number(audio.getAttribute('data-playback-rate') ?? 1);
    const clipDuration = Number(audio.getAttribute('data-duration') ?? (sourceDuration - offset) / rate);
    const from = Math.max(start, clipStart);
    const to = Math.min(end, clipStart + clipDuration, clipStart + (sourceDuration - offset) / rate);
    if (!(to > from)) { audio.remove(); continue; }
    audio.setAttribute('data-start', seconds(from - start));
    audio.setAttribute('data-duration', seconds(to - from));
    // HyperFrames 0.8.142 docs/data-attributes.md defines this as a source offset; playback-start is its legacy alias.
    audio.setAttribute('data-media-start', seconds(offset + (from - clipStart) * rate));
    audio.removeAttribute('data-playback-start');
  }

  const directory = join(project, '.explainery', 'scenes', `${story.id}--${sceneIds.join('--')}`);
  await refreshSources(project, directory);
  await writeFile(join(directory, 'index.html'), document.toString());
  return { directory, start, duration, sceneIds: [...sceneIds] };
}
