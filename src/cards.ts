import { toMillisecond as round } from './time.ts';
import { storyCompositions, storyScenes, type SceneSelection } from './story.ts';
import type { Composition, Copy, Story, Timing } from './types.ts';

/** One card as the theme's card layer draws it, on the layer's clock. */
export interface CardSlot {
  kind: NonNullable<Composition['card']>;
  scene: number;
  start: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  copy: Copy;
}

/** The composition variables of the `[data-story-cards]` layer. */
export interface CardLayerVariables {
  duration: number;
  scenes: string[];
  cards: CardSlot[];
}

/**
 * Lists the story's cards for the card layer, which draws them in place of composition files.
 *
 * A card fades in over the previous composition's overlap and out over the next one's, so the crossfades follow
 * timing rather than a fixed theme value, capped at half the card. `scene` indexes `scenes`, every editorial title in
 * film order, which the layer uses for chapter numbers and the roadmap. A selection keeps only its own cards and
 * moves them onto its clock, matching the retimed hosts of a scene preview.
 */
export function cardLayerVariables(story: Story, timing: Timing, selection?: SceneSelection): CardLayerVariables {
  const scenes = storyScenes(story);
  const sceneOf = new Map(scenes.flatMap((scene, index) => scene.compositions.map(composition => [composition.id, index] as const)));
  const compositions = storyCompositions(story);
  const end = (id: string) => timing.scenes[id].start + timing.scenes[id].duration;
  const cards = compositions.flatMap((composition, index): CardSlot[] => {
    if (!composition.card || (selection && !selection.compositionIds.has(composition.id))) return [];
    const { start, duration } = timing.scenes[composition.id];
    const previous = compositions[index - 1];
    const next = compositions[index + 1];
    const fade = (seconds: number) => round(Math.min(Math.max(seconds, 0), duration / 2));
    return [{
      kind: composition.card,
      scene: sceneOf.get(composition.id)!,
      start: round(start - (selection?.start ?? 0)),
      duration,
      fadeIn: previous ? fade(end(previous.id) - start) : 0,
      fadeOut: next ? fade(start + duration - timing.scenes[next.id].start) : 0,
      copy: composition.copy,
    }];
  });
  return { duration: selection?.duration ?? timing.duration, scenes: scenes.map(scene => scene.title), cards };
}
