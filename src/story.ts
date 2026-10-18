import type { Composition, Scene, Story, Timing } from './types.ts';

/** Normalizes a schema-valid story into editorial scenes, preserving flat entries as one-composition scenes. */
export function storyScenes(story: Story): Scene[] {
  return story.scenes.map(entry => 'compositions' in entry ? entry : { id: entry.id, title: entry.copy.headline, compositions: [entry] });
}

/** Returns the compositions in narration and playback order, regardless of editorial grouping. */
export function storyCompositions(story: Story): Composition[] {
  return storyScenes(story).flatMap(scene => scene.compositions);
}

/** Derives a scene's enclosing range from its composition timings, including overlaps and gaps. */
export function sceneRange(scene: Scene, timing: Timing): { start: number; duration: number } {
  if (!scene.compositions.length) throw new Error(`scene "${scene.id}" has no compositions`);
  const slots = scene.compositions.map(composition => {
    const slot = timing.scenes[composition.id];
    if (!slot) throw new Error(`timing.json: no timing for composition "${composition.id}"`);
    return slot;
  });
  const start = Math.min(...slots.map(slot => slot.start));
  const end = Math.max(...slots.map(slot => slot.start + slot.duration));
  return { start, duration: end - start };
}

export interface SceneSelection {
  start: number;
  end: number;
  duration: number;
  compositionIds: Set<string>;
}

/** Selects consecutive editorial scenes on the same clock used by isolated playback and chapter metadata. */
export function selectScenes(story: Story, timing: Timing, sceneIds: string[]): SceneSelection {
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
  const compositionIds = new Set(selected.flatMap(scene => scene.compositions.map(composition => composition.id)));
  return { start, end, duration: end - start, compositionIds };
}

export interface CompositionSelection extends SceneSelection {
  /** The editorial scene that contains every selected composition. */
  sceneId: string;
}

/**
 * Selects consecutive compositions inside one editorial scene, on the clock a scene selection uses: the enclosing
 * range of the selected compositions, with their authored overlaps and gaps. Compositions outside it, including an
 * overlapping neighbour, are not part of the selection.
 */
export function selectCompositions(story: Story, timing: Timing, compositionIds: string[]): CompositionSelection {
  if (!compositionIds.length) throw new Error('composition selection must contain at least one composition id');
  if (new Set(compositionIds).size !== compositionIds.length) throw new Error('composition selection contains duplicate composition ids');
  const scenes = storyScenes(story);
  const owners = compositionIds.map(id => {
    const owner = scenes.find(scene => scene.compositions.some(composition => composition.id === id));
    if (!owner) throw new Error(`unknown composition "${id}"`);
    return owner;
  });
  const scene = owners[0];
  const other = owners.findIndex(owner => owner !== scene);
  if (other >= 0) throw new Error(`composition selection must lie within one editorial scene; "${compositionIds[0]}" belongs to "${scene.id}" and "${compositionIds[other]}" to "${owners[other].id}"`);
  const positions = compositionIds.map(id => scene.compositions.findIndex(composition => composition.id === id));
  if (positions.some((position, index) => index > 0 && position !== positions[index - 1] + 1)) throw new Error(`composition selection must be consecutive compositions of scene "${scene.id}" in story order`);
  const { start, duration } = sceneRange({ ...scene, compositions: positions.map(position => scene.compositions[position]) }, timing);
  return { start, end: start + duration, duration, compositionIds: new Set(compositionIds), sceneId: scene.id };
}

/**
 * Names a selection in render files and scene views: scene IDs joined by `--`, or `<scene>.<composition>--…` for a
 * composition selection. IDs are slugs (story schema), which contain neither `.` nor `--`, so the two forms never
 * collide, even where a flat scene and its composition share one ID.
 */
export function selectionName(sceneIds: string[], compositionIds: string[] = []): string {
  return compositionIds.length ? `${sceneIds.join('--')}.${compositionIds.join('--')}` : sceneIds.join('--');
}
