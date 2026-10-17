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

/** UTF-16 offsets in the marker-free written text and the generated spoken text. */
export interface PronunciationSpan {
  writtenStart: number;
  writtenEnd: number;
  spokenStart: number;
  spokenEnd: number;
}

export interface VoicedNarration {
  written: string;
  text: string;
  spans: PronunciationSpan[];
}

/** Retains replacement spans so recorded pronunciation expansions can recover canonical caption words. */
export function voicedNarration(narration: string, pronunciations: Record<string, string> = {}): VoicedNarration {
  const written = spokenText(narration);
  const words = Object.keys(pronunciations).filter(Boolean).sort((a, b) => b.length - a.length);
  const spans: PronunciationSpan[] = [];
  let text = '';
  let cursor = 0;
  const append = (start: number, end: number, value: string) => {
    if (start === end) return;
    spans.push({ writtenStart: start, writtenEnd: end, spokenStart: text.length, spokenEnd: text.length + value.length });
    text += value;
  };
  if (words.length) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
    for (const match of written.matchAll(pattern)) {
      append(cursor, match.index, written.slice(cursor, match.index));
      append(match.index, match.index + match[0].length, pronunciations[match[0]]);
      cursor = match.index + match[0].length;
    }
  }
  append(cursor, written.length, written.slice(cursor));
  return { written, text, spans };
}

/**
 * Applies case-sensitive whole-term pronunciations only to voice input; readers retain the written text.
 * Letters or digits adjoining a term prevent replacement, so "SQLs" and "MSSQL" do not match "SQL".
 */
export function voicedText(narration: string, pronunciations: Record<string, string> = {}): string {
  return voicedNarration(narration, pronunciations).text;
}

/**
 * Splits a narration into its spoken words and, per {beat} marker, the number of words spoken before it.
 *
 * Both timing sources build on this: an estimate counts the words, and an alignment finds them in a transcript. Words
 * are whitespace-separated and keep their punctuation.
 */
export function spokenWords(narration: string): { words: string[]; markers: { beat: string; before: number }[] } {
  const words = spokenText(narration).split(/\s+/).filter(Boolean);
  const markers = [...narration.matchAll(MARKER)].map(marker => ({
    beat: marker[1],
    before: spokenText(narration.slice(0, marker.index)).split(/\s+/).filter(Boolean).length,
  }));
  return { words, markers };
}
