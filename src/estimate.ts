import { spokenWords } from './narration.ts';
import { toMillisecond as round } from './time.ts';
import type { SceneTiming, Story, Timing } from './types.ts';

// The pilot project's recorded narration runs at 2.4–2.5 words per second (measured on its subtitle cues, 2026-10-09).
export const DEFAULT_WORDS_PER_SECOND = 2.5;

/**
 * Estimates timing from the narration alone, for animating before any voice exists.
 *
 * A scene lasts for its spoken words at `wordsPerSecond` plus its hold, and each beat falls after the words spoken
 * before its marker. Scenes follow in story order; a scene's overlap starts the next one that much earlier, and the
 * last scene's overlap is ignored. Times are rounded to the millisecond. Throws when an overlap is not shorter than
 * its scene, since the next scene would then start before it.
 */
export function estimateTiming(story: Story, { wordsPerSecond = DEFAULT_WORDS_PER_SECOND }: { wordsPerSecond?: number } = {}): Timing {
  const scenes: Record<string, SceneTiming> = {};
  let start = 0;
  let end = 0;
  story.scenes.forEach((scene, index) => {
    const { words, markers } = spokenWords(scene.narration);
    const duration = round(words.length / wordsPerSecond + (scene.hold ?? 0));
    const beats = Object.fromEntries(markers.map(({ beat, before }) => [beat, round(before / wordsPerSecond)]));
    scenes[scene.id] = { start, duration, beats };
    end = round(start + duration);
    const overlap = index < story.scenes.length - 1 ? scene.overlap ?? 0 : 0;
    if (overlap >= duration) throw new Error(`scene "${scene.id}": overlap ${overlap}s is not shorter than its ${duration}s duration`);
    start = round(end - overlap);
  });
  return { source: 'estimate', duration: end, scenes };
}
