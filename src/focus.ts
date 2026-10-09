import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { storyScenes } from './story.ts';
import type { Scene, Story } from './types.ts';

const focusFile = (project: string) => join(project, '.explainery', 'focus.json');

/** Resolves an editorial scene by exact ID or case-insensitive title; IDs take precedence. */
export function resolveScene(story: Story, selector: string): Scene {
  const scenes = storyScenes(story);
  const exact = scenes.find(scene => scene.id === selector);
  if (exact) return exact;
  const matches = scenes.filter(scene => scene.title.toLowerCase() === selector.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Ambiguous scene title "${selector}": ${matches.map(scene => scene.id).join(', ')}; use an exact scene ID`);
  throw new Error(`Unknown scene "${selector}"; run explainery scenes to see available IDs and titles`);
}

/** Reads the local active scene, refusing stale or malformed state rather than widening the scope. */
export async function readFocus(project: string, story: Story): Promise<Scene | undefined> {
  const file = focusFile(project);
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let state: unknown;
  try {
    state = JSON.parse(source);
  } catch {
    throw new Error(`Invalid focus state in ${file}; use explainery focus --scene <id> or --film`);
  }
  if (!state || typeof state !== 'object' || !('sceneId' in state) || typeof state.sceneId !== 'string' || !state.sceneId) {
    throw new Error(`Invalid focus state in ${file}; use explainery focus --scene <id> or --film`);
  }
  const scene = storyScenes(story).find(scene => scene.id === state.sceneId);
  if (!scene) throw new Error(`Stale focus scene "${state.sceneId}"; use explainery focus --scene <id> to switch or --film for the full film`);
  return scene;
}

/** Persists one resolved scene ID outside the authored story and timing files. */
export async function writeFocus(project: string, story: Story, selector: string): Promise<Scene> {
  const scene = resolveScene(story, selector);
  await mkdir(join(project, '.explainery'), { recursive: true });
  await writeFile(focusFile(project), JSON.stringify({ sceneId: scene.id }, null, 2) + '\n');
  return scene;
}

/** Clears the local active scene, returning subsequent commands to the full film. */
export async function clearFocus(project: string): Promise<void> {
  await rm(focusFile(project), { force: true });
}
