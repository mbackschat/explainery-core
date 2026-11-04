import englishTechnicalTerms from '../data/english-technical-terms.json' with { type: 'json' };
import type { Pronunciation } from './types.ts';

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
const termPattern = (terms: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...terms].filter(Boolean).sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
const englishCanonicalPattern = termPattern(Object.keys(englishTechnicalTerms));
const englishSpokenPattern = termPattern([...Object.keys(englishTechnicalTerms), ...Object.values(englishTechnicalTerms)]);

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
    const pattern = termPattern(words);
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

export const KOKORO_LANGUAGES: Readonly<Record<string, string>> = { a: 'en-us', b: 'en-gb', e: 'es', f: 'fr-fr', h: 'hi', i: 'it', j: 'ja', p: 'pt-br', z: 'zh' };
interface PronunciationStory { voice?: { name?: string; lang?: string }; pronunciations?: Record<string, Pronunciation> }
export interface VoiceRun { text: string; lang: string }
export interface StoryVoicePlan extends VoicedNarration { runs: VoiceRun[] }
export interface ResolvedVoiceInput { text: string; runs?: VoiceRun[] }

/** Stored language also applies to narration prepared for an external or human voice. */
export const storyLanguage = (story: PronunciationStory): string => story.voice?.lang ?? KOKORO_LANGUAGES[story.voice?.name?.[0]?.toLowerCase() ?? ''] ?? 'en-us';

function pronunciationEntries(story: PronunciationStory): Record<string, VoiceRun> {
  const lang = storyLanguage(story);
  const english = lang.split('-')[0] === 'en';
  const defaults = english ? COMMON_PRONUNCIATIONS : englishTechnicalTerms;
  const entries: Record<string, VoiceRun> = Object.fromEntries(Object.entries(defaults).map(([term, text]) => [term, { text, lang: english ? lang : 'en-us' }]));
  if (lang === 'de') entries.KI = { text: 'K I', lang };
  for (const [term, reading] of Object.entries(story.pronunciations ?? {})) {
    const knownEnglish = Object.hasOwn(englishTechnicalTerms, term);
    if (typeof reading !== 'string' && knownEnglish && reading.lang.split('-')[0] !== 'en') {
      throw new Error(`pronunciation of "${term}" must use an English language because it is a known English technical term`);
    }
    entries[term] = typeof reading === 'string' ? { text: reading, lang: knownEnglish && !english ? 'en-us' : lang } : reading;
  }
  return entries;
}

/** Resolved text substitutions also drive spoken alignment, retaining canonical caption words. */
export function storyPronunciations(story: PronunciationStory): Record<string, string> {
  return Object.fromEntries(Object.entries(pronunciationEntries(story)).map(([term, reading]) => [term, reading.text]));
}

/** Resolves each term once so exported, synthesized and hashed speech retain the same language boundaries. */
export function storyVoicePlan(narration: string, story: PronunciationStory): StoryVoicePlan {
  const entries = pronunciationEntries(story);
  const mapping = voicedNarration(narration, Object.fromEntries(Object.entries(entries).map(([term, reading]) => [term, reading.text])));
  const runs: VoiceRun[] = [];
  const languages = mapping.spans.map(span => entries[mapping.written.slice(span.writtenStart, span.writtenEnd)]?.lang ?? storyLanguage(story));
  const guardEnglish = (text: string, pattern: RegExp, startKey: 'writtenStart' | 'spokenStart', endKey: 'writtenEnd' | 'spokenEnd') => {
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      while (cursor < mapping.spans.length && mapping.spans[cursor][endKey] <= match.index) cursor++;
      for (let index = cursor; index < mapping.spans.length && mapping.spans[index][startKey] < match.index + match[0].length; index++) {
        if (languages[index].split('-')[0] !== 'en') {
          const span = mapping.spans[index];
          const term = mapping.written.slice(span.writtenStart, span.writtenEnd);
          throw new Error(`pronunciation of "${term}" must use an English language for known English technical term "${match[0]}"`);
        }
      }
    }
  };
  guardEnglish(mapping.written, englishCanonicalPattern, 'writtenStart', 'writtenEnd');
  guardEnglish(mapping.text, englishSpokenPattern, 'spokenStart', 'spokenEnd');
  for (const [index, span] of mapping.spans.entries()) {
    const text = mapping.text.slice(span.spokenStart, span.spokenEnd);
    const lang = languages[index];
    const previous = runs.at(-1);
    if (previous?.lang === lang) previous.text += text;
    else runs.push({ text, lang });
  }
  return { ...mapping, runs };
}

/** Omits redundant runs to preserve the historical English cache and production hashes. */
export function resolvedVoiceInput(narration: string, story: PronunciationStory): ResolvedVoiceInput {
  const plan = storyVoicePlan(narration, story);
  return { text: plan.text, ...(plan.runs.some(run => run.lang !== storyLanguage(story)) ? { runs: plan.runs } : {}) };
}

/** Checks story-local readings in their resolved language and reports forbidden English-term overrides. */
export function storyPronunciationErrors(story: PronunciationStory, narrations: string[] = []): string[] {
  const errors: string[] = [];
  for (const [term, reading] of Object.entries(story.pronunciations ?? {})) {
    try {
      const entry = pronunciationEntries({ ...story, pronunciations: { [term]: reading } })[term];
      errors.push(...pronunciationErrors({ [term]: entry.text }, entry.lang));
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  if (!errors.length) {
    for (const narration of narrations) {
      try { storyVoicePlan(narration, story); }
      catch (error) { errors.push((error as Error).message); }
    }
  }
  return [...new Set(errors)];
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
