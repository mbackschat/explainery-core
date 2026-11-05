import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { checkSceneSource, checkStory } from './schemas.ts';
import { storyCompositions } from './story.ts';
import type { Composition, CompositionSource, FilmSource, LoadStoryResult, Scene, SceneReference, SceneSource, Story } from './types.ts';

const message = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : (error as Error).message.split('\n')[0];
const inside = (boundary: string, file: string) => {
  const path = relative(boundary, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

async function definition(dir: string, file: string, check: (value: unknown) => string[]): Promise<{ value?: unknown; errors: string[] }> {
  try {
    const value: unknown = parseYaml(await readFile(join(dir, file), 'utf8'));
    const errors = check(value).map(error => {
      let owner = file;
      if (check === checkSceneSource && value && typeof value === 'object') {
        const scene = value as Partial<SceneSource>;
        if (typeof scene.id === 'string') owner += ` scene "${scene.id}"`;
        const index = /^\/compositions\/(\d+)(?:\/|:)/.exec(error)?.[1];
        const composition = index !== undefined && Array.isArray(scene.compositions) ? scene.compositions[Number(index)] : undefined;
        if (typeof composition?.id === 'string') owner += ` composition "${composition.id}"`;
      }
      return `${owner} ${error}`;
    });
    return errors.length ? { errors } : { value, errors };
  } catch (error) {
    return { errors: [`${file}: ${message(error)}`] };
  }
}

async function sourcePath(dir: string, root: string, base: string, source: string, where: string, errors: string[]): Promise<{ path: string; real: string } | undefined> {
  if (source.trim() === '' || /[\\?#\0]/.test(source) || source.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(source)) {
    errors.push(`${where}: source "${source}" must name a local file without a URL, query or fragment`);
    return;
  }
  const path = posix.normalize(posix.join(base, source));
  const absolute = resolve(dir, path);
  const boundary = resolve(dir, base);
  if (!inside(boundary, absolute)) {
    errors.push(`${where}: source "${source}" escapes its directory boundary`);
    return;
  }
  try {
    const real = await realpath(absolute);
    const realBoundary = await realpath(boundary);
    if (!inside(root, real) || !inside(realBoundary, real)) {
      errors.push(`${where}: source "${source}" escapes its real directory boundary`);
      return;
    }
    if (!(await stat(real)).isFile()) {
      errors.push(`${where}: source "${source}" must name a file`);
      return;
    }
    return { path, real };
  } catch (error) {
    errors.push(`${where}: source "${source}": ${message(error)}`);
    return;
  }
}

/** Resolves the authored film into one canonical story and explicit project-relative source ownership. */
export async function loadStory(dir: string): Promise<LoadStoryResult> {
  const loaded = await definition(dir, 'story.yaml', checkStory);
  if (loaded.errors.length) return { errors: loaded.errors };
  const input = loaded.value as FilmSource;
  const sources = new Map<string, CompositionSource>();
  if (!('source' in input.scenes[0])) {
    const story = input as Story;
    for (const composition of storyCompositions(story)) {
      sources.set(composition.id, { definition: 'story.yaml', ...(!composition.card ? { html: `compositions/${composition.id}.html` } : {}) });
    }
    return { value: story, resolved: { story, mode: 'inline', sources }, errors: [] };
  }

  const errors: string[] = [];
  const scenes: Scene[] = [];
  const scenePaths = new Map<string, string>();
  const visualPaths = new Map<string, string>();
  const sceneIds = new Map<string, string>();
  const compositionIds = new Map<string, string>();
  const root = await realpath(dir);
  for (const reference of input.scenes as SceneReference[]) {
    const resolved = await sourcePath(dir, root, '.', reference.source, 'story.yaml', errors);
    if (!resolved) continue;
    const previous = scenePaths.get(resolved.real);
    if (previous) {
      errors.push(`story.yaml: scene source "${resolved.path}" is already referenced as "${previous}"`);
      continue;
    }
    scenePaths.set(resolved.real, resolved.path);
    const loadedScene = await definition(dir, resolved.path, checkSceneSource);
    errors.push(...loadedScene.errors);
    if (loadedScene.errors.length) continue;
    const scene = loadedScene.value as SceneSource;
    const where = `${resolved.path} scene "${scene.id}"`;
    const previousScene = sceneIds.get(scene.id);
    if (previousScene) errors.push(`${where}: scene id "${scene.id}" is used twice (first in ${previousScene})`);
    sceneIds.set(scene.id, resolved.path);
    const compositions: Composition[] = [];
    for (const authored of scene.compositions) {
      const owner = `${where} composition "${authored.id}"`;
      const previousComposition = compositionIds.get(authored.id);
      if (previousComposition) errors.push(`${owner}: composition id "${authored.id}" is used twice (first in ${previousComposition})`);
      compositionIds.set(authored.id, resolved.path);
      const { source, ...composition } = authored;
      compositions.push(composition);
      const ownership: CompositionSource = { definition: resolved.path };
      if (source !== undefined) {
        const visual = await sourcePath(dir, root, posix.dirname(resolved.path), source, owner, errors);
        if (visual) {
          const previousVisual = visualPaths.get(visual.real);
          if (previousVisual) errors.push(`${owner}: visual source "${visual.path}" is already owned by ${previousVisual}`);
          visualPaths.set(visual.real, owner);
          ownership.html = visual.path;
        }
      }
      sources.set(authored.id, ownership);
    }
    scenes.push({ id: scene.id, title: scene.title, compositions });
  }
  if (errors.length) return { errors };
  const story: Story = { ...input, scenes };
  return { value: story, resolved: { story, mode: 'referenced', sources }, errors: [] };
}
