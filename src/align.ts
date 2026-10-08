import { spokenWords } from './narration.ts';
import { toMillisecond as round } from './time.ts';
import type { SceneTiming, Story, Timing } from './types.ts';

/** One word of a `hyperframes transcribe` transcript, in seconds from the start of the audio. */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

// Speech recognition mishears some words; far fewer matches mean the audio is not this narration.
const MIN_MATCHED = 0.75;

const normal = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Pairs narration words with transcript words by longest common subsequence; unmatched entries stay -1. */
function matchWords(narration: string[], transcript: string[]): number[] {
  const n = narration.length;
  const m = transcript.length;
  const lengths = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] = narration[i] === transcript[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const matches = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (narration[i] === transcript[j]) matches[i++] = j++;
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  return matches;
}

/** Gives every narration word a time: its transcript word's, or a share of the gap between its matched neighbours. */
function wordTimes(matches: number[], transcript: TranscriptWord[]): { start: number; end: number }[] {
  return matches.map((match, index) => {
    if (match >= 0) return transcript[match];
    let previous = index - 1;
    while (previous >= 0 && matches[previous] < 0) previous--;
    let next = index + 1;
    while (next < matches.length && matches[next] < 0) next++;
    const gapStart = previous >= 0 ? transcript[matches[previous]].end : next < matches.length ? transcript[matches[next]].start : 0;
    const gapEnd = next < matches.length ? transcript[matches[next]].start : gapStart;
    const share = (gapEnd - gapStart) / (next - previous - 1);
    return { start: gapStart + share * (index - previous - 1), end: gapStart + share * (index - previous) };
  });
}

/**
 * Times the story to a recorded narration from its word-level transcript.
 *
 * The story's narration words are matched to the transcript in order, tolerating misheard words, and a word the
 * recogniser missed gets a share of the gap between its matched neighbours. A beat falls where the word after its
 * marker starts, or where the scene's last word ends when the marker closes the narration. The first scene starts at
 * 0; a scene ends its hold after its last word, and the next scene starts its overlap earlier. Throws when fewer than
 * three quarters of the narration words are found, or when a scene's narration would start before the scene does.
 */
export function alignTiming(story: Story, transcript: TranscriptWord[], { audio }: { audio: string }): Timing {
  const parts = story.scenes.map(scene => spokenWords(scene.narration));
  const narration = parts.flatMap(part => part.words);
  const matches = matchWords(narration.map(normal), transcript.map(word => normal(word.text)));
  const matched = matches.filter(match => match >= 0).length;
  if (matched < narration.length * MIN_MATCHED) {
    throw new Error(`the transcript matches only ${matched} of ${narration.length} narration words; does the audio speak this story's narration?`);
  }
  const times = wordTimes(matches, transcript);

  const scenes: Record<string, SceneTiming> = {};
  let start = 0;
  let end = 0;
  let first = 0;
  story.scenes.forEach((scene, index) => {
    const { words, markers } = parts[index];
    if (!words.length) throw new Error(`scene "${scene.id}" has no narration words to align`);
    const spoken = times.slice(first, first + words.length);
    first += words.length;
    if (index > 0 && round(spoken[0].start) < start) {
      const previous = story.scenes[index - 1].id;
      throw new Error(`scene "${scene.id}": its narration starts at ${round(spoken[0].start)}s, before the scene starts at ${start}s; shorten the hold or overlap of "${previous}"`);
    }
    const lastWordEnd = spoken[spoken.length - 1].end;
    const beats = Object.fromEntries(markers.map(({ beat, before }) => [beat, round((before < words.length ? spoken[before].start : lastWordEnd) - start)]));
    end = round(lastWordEnd + (scene.hold ?? 0));
    const duration = round(end - start);
    scenes[scene.id] = { start, duration, beats };
    const overlap = index < story.scenes.length - 1 ? scene.overlap ?? 0 : 0;
    if (overlap >= duration) throw new Error(`scene "${scene.id}": overlap ${overlap}s is not shorter than its ${duration}s duration`);
    start = round(end - overlap);
  });
  return { source: 'aligned', audio, duration: end, scenes };
}
