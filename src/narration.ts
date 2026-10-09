const MARKER = /\{([^{}]*)\}/g;
const BEAT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Extracts the {beat-id} markers of a narration in spoken order.
 *
 * Markers are the only link between narration and animation: scene tweens anchor to these ids, and timing assigns
 * each one a second. A marker that is not a kebab-case id, or an id marked twice, is reported rather than skipped,
 * because a silently dropped beat would leave its tweens anchored to nothing.
 */
export function narrationBeats(narration: string): { beats: string[]; errors: string[] } {
  const beats: string[] = [];
  const errors: string[] = [];
  for (const [marker, id] of narration.matchAll(MARKER)) {
    if (!BEAT_ID.test(id)) errors.push(`malformed beat marker "${marker}"`);
    else if (beats.includes(id)) errors.push(`beat "${id}" is marked twice`);
    else beats.push(id);
  }
  return { beats, errors };
}

/** The narration as spoken and shown to readers: beat markers removed, whitespace and punctuation tidied. */
export const spokenText = (narration: string) => narration.replace(MARKER, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The narration as a synthetic draft voice should speak it: the spoken text with each whole word that has a
 * pronunciation replaced by it.
 *
 * Words match case-sensitively and only where no letter or digit adjoins them, so "SPI" changes but "SPIs" and "ESPI"
 * do not. Only the draft voice gets these spellings; readers, transcripts and alignment keep the written words.
 */
export function voicedText(narration: string, pronunciations: Record<string, string> = {}): string {
  const words = Object.keys(pronunciations).sort((a, b) => b.length - a.length);
  const text = spokenText(narration);
  if (!words.length) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  return text.replace(pattern, word => pronunciations[word]);
}

/**
 * Splits a narration into its spoken words and, per {beat} marker, the number of words spoken before it.
 *
 * Both timing sources build on this: an estimate counts the words, and an alignment finds them in a transcript. Words
 * are whitespace-separated and keep their punctuation.
 */
export function spokenWords(narration: string): { words: string[]; markers: { beat: string; before: number }[] } {
  const words: string[] = [];
  const markers: { beat: string; before: number }[] = [];
  let last = 0;
  for (const marker of narration.matchAll(MARKER)) {
    words.push(...narration.slice(last, marker.index).split(/\s+/).filter(Boolean));
    markers.push({ beat: marker[1], before: words.length });
    last = marker.index + marker[0].length;
  }
  words.push(...narration.slice(last).split(/\s+/).filter(Boolean));
  return { words, markers };
}
