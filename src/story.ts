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
