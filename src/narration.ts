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
 * English readings of recurring acronyms; a story's own entry wins.
 *
 * Letters are hyphenated into one token and the letter I is written "eye", following pronunciationErrors.
 */
export const COMMON_PRONUNCIATIONS: Readonly<Record<string, string>> = { AI: 'A-eye', API: 'A-P-eye', CLI: 'C-L-eye', ID: 'eye-D', 'I/O': 'eye-O', SPI: 'S-P-eye' };

// German eSpeak letter names preserve I as /iː/; unlike English they need no "eye" workaround
// (phoneme inspection on 2026-11-04; see docs/adr/0014-language-aware-pronunciation.md).
const germanPronunciations: Readonly<Record<string, string>> = { AI: 'A-I', API: 'A-P-I', CLI: 'C-L-I', ID: 'I-D', 'I/O': 'I-O', SPI: 'S-P-I', KI: 'K-I' };

export const KOKORO_LANGUAGES: Readonly<Record<string, string>> = { a: 'en-us', b: 'en-gb', e: 'es', f: 'fr-fr', h: 'hi', i: 'it', j: 'ja', p: 'pt-br', z: 'zh' };
interface PronunciationStory { voice?: { name?: string; lang?: string }; pronunciations?: Record<string, string> }

/** Stored language also applies to narration prepared for an external or human voice. */
export const storyLanguage = (story: PronunciationStory): string => story.voice?.lang ?? KOKORO_LANGUAGES[story.voice?.name?.[0]?.toLowerCase() ?? ''] ?? 'en-us';

/** Language-specific defaults, overridden by the story's own readings; canonical text is never changed. */
export function storyPronunciations(story: PronunciationStory): Record<string, string> {
  const language = storyLanguage(story).split('-')[0];
  const common = language === 'en' ? COMMON_PRONUNCIATIONS : language === 'de' ? germanPronunciations : {};
  return { ...common, ...story.pronunciations };
}

/**
 * Reports readings the local voice speaks wrongly in running text.
 *
 * Its espeak front end reads a letter I written as "I" as the unstressed pronoun when a verb follows, even inside a
 * hyphenated token: "The C L I blocks" became `sˈiː ˈɛl aɪ` and was heard as "C-L" (kokoro-onnx phonemes, checked on
 * 2026-10-18). A lone A is read as the article. "eye", and an A hyphenated to the next letter, stay stressed.
 */
export function pronunciationErrors(pronunciations: Record<string, string>, language = 'en-us'): string[] {
  if (language.split('-')[0] !== 'en') return [];
  const errors: string[] = [];
  for (const [term, reading] of Object.entries(pronunciations)) {
    if (reading.split(/\s+/).includes('A')) errors.push(`pronunciation of "${term}" spells the letter A as a separate word, which the voice reads as the article; hyphenate it to the next letter (for example "A-eye")`);
    if (reading.split(/[\s-]+/).includes('I')) errors.push(`pronunciation of "${term}" spells the letter I as "I", which the voice reads as an unstressed pronoun; write "eye", hyphenated to its neighbours (for example "C-L-eye")`);
  }
  return errors;
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

/**
 * The written words spoken from each {beat} marker up to the next marker, keyed by beat id, so review evidence can
 * show what the voice says over a beat. Words keep their punctuation, as in `spokenWords`.
 */
export function beatNarration(narration: string): Record<string, string> {
  const { words, markers } = spokenWords(narration);
  return Object.fromEntries(markers.map((marker, index) => [marker.beat, words.slice(marker.before, markers[index + 1]?.before ?? words.length).join(' ')]));
}
