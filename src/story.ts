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
