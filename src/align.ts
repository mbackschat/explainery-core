import { spokenWords, voicedNarration } from './narration.ts';
import { toMillisecond as round } from './time.ts';
import { storyCompositions } from './story.ts';
import type { SceneTiming, Story, Timing } from './types.ts';

/** One word of a `hyperframes transcribe` transcript, in seconds from the start of the audio. */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

/** A pause in the audio, in seconds from its start. */
export interface Silence {
  start: number;
  end: number;
}

/** Known composition audio boundaries on the full-film clock, excluding inserted pauses. */
export interface AudioSegment {
  id: string;
  start: number;
  end: number;
}

export interface AlignmentOptions {
  silences?: Silence[];
  segments?: AudioSegment[];
  transcriptMode?: 'canonical' | 'spoken';
}

export interface AlignedStoryWords {
  words: TranscriptWord[];
  inferred: boolean[];
}

/** Beat time is composition-local, like the corresponding timing.scenes entry. */
export interface AlignmentDiagnostic {
  compositionId: string;
  beat: string;
  time: number;
  reason: 'inferred-word';
}

export interface TimingAlignmentOptions extends AlignmentOptions {
  audio: string;
  audioDuration?: number;
}

export interface TimingAlignmentReport {
  timing: Timing;
  diagnostics: AlignmentDiagnostic[];
}

// Speech recognition mishears some words; far fewer matches mean the audio is not this narration.
const MIN_MATCHED = 0.75;

const normal = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

interface WordMatch { start: number; end: number }

/** Finds an equal lexical span even when recognition splits or merges whitespace-separated words. */
function matchingSpan(narration: string[], transcript: string[], i: number, j: number): [number, number] | undefined {
  let endI = i + 1;
  let endJ = j + 1;
  let left = narration[i];
  let right = transcript[j];
  if (!left || !right) return undefined;
  while (left !== right) {
    if (left.startsWith(right) && endJ < transcript.length) right += transcript[endJ++];
    else if (right.startsWith(left) && endI < narration.length) left += narration[endI++];
    else return undefined;
  }
  return [endI, endJ];
}

/** Pairs script words with transcript spans; lexical length supplies sub-word positions for merged tokens. */
function matchWords(narration: string[], transcript: TranscriptWord[]): Array<WordMatch | undefined> {
  const normalized = transcript.map(word => normal(word.text));
  const n = narration.length;
  const m = transcript.length;
  const lengths = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const span = matchingSpan(narration, normalized, i, j);
      const score = span ? span[0] - i + lengths[span[0]][span[1]] : 0;
      lengths[i][j] = Math.max(score, lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const matches = new Array<WordMatch | undefined>(n);
  for (let i = 0, j = 0; i < n && j < m;) {
    const span = matchingSpan(narration, normalized, i, j);
    if (span && span[0] - i + lengths[span[0]][span[1]] === lengths[i][j]) {
      const [endI, endJ] = span;
      const start = transcript[j].start;
      const duration = transcript[endJ - 1].end - start;
      const total = narration.slice(i, endI).join('').length;
      let offset = 0;
      for (; i < endI; i++) {
        matches[i] = { start: start + duration * offset / total, end: start + duration * (offset + narration[i].length) / total };
        offset += narration[i].length;
      }
      j = endJ;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  return matches;
}

/** Gives an unrecognized script word a share of the gap between recognized neighbours. */
function wordTimes(matches: Array<WordMatch | undefined>, bounds?: WordMatch): WordMatch[] {
  return Array.from(matches, (match, index) => {
    if (match) return match;
    let previous = index - 1;
    while (previous >= 0 && !matches[previous]) previous--;
    let next = index + 1;
    while (next < matches.length && !matches[next]) next++;
    const gapStart = previous >= 0 ? matches[previous]!.end : bounds?.start ?? (next < matches.length ? matches[next]!.start : 0);
    const gapEnd = next < matches.length ? matches[next]!.start : bounds?.end ?? gapStart;
    const share = (gapEnd - gapStart) / (next - previous - 1);
    return { start: gapStart + share * (index - previous - 1), end: gapStart + share * (index - previous) };
  });
}

// Whisper drifts the words before a pause into it, sometimes several words deep (a scene's last three words reported
// up to 2.4 s into a 2.1 s pause, measured 2026-10-09), which would end a scene's narration where the next one begins.
// Nobody speaks during a pause, so the run of words reaching into one is scaled back to end where the pause begins.
// A word starting within PAUSE_EDGE of a pause's end is the next speech beginning, not drift: silence detection and
// whisper each place that boundary to within a fraction of a second.
const PAUSE_EDGE = 0.25;
function fitBeforePauses(times: { start: number; end: number }[], silences: Silence[]): { start: number; end: number }[] {
  const fitted = times.map(time => ({ ...time }));
  for (const pause of silences) {
    let first = fitted.findIndex(time => time.end > pause.start);
    if (first < 0 || fitted[first].start >= pause.end - PAUSE_EDGE) continue;
    let last = first;
    while (last + 1 < fitted.length && fitted[last + 1].start < pause.end - PAUSE_EDGE) last++;
    while (first > 0 && fitted[first].start >= pause.start) first--;
    const from = fitted[first].start;
    if (from >= pause.start) continue;
    const scale = (pause.start - from) / (fitted[last].end - from);
    for (const time of fitted.slice(first, last + 1)) {
      time.start = from + (time.start - from) * scale;
      time.end = from + (time.end - from) * scale;
    }
  }
  return fitted;
}

/**
 * Times the story to a recorded narration from its word-level transcript.
 *
 * The story's narration words are matched to the transcript in order, tolerating misheard words, and a word the
 * recogniser missed gets a share of the gap between its matched neighbours. Words that reach into one of the audio's
 * `silences` are fitted back to end where that pause begins. A beat falls where the word after its
 * marker starts, or where the composition's last word ends when the marker closes the narration. Compositions follow
 * flattened story order, independent of editorial grouping. The first starts at 0; each ends its hold after its last
 * word, and the next starts its overlap earlier. Throws when fewer than three quarters of the narration words are
 * found, or when a composition's narration would start before the composition does.
 * An `audioDuration` is kept beside the audio, because the film usually holds past the audio's end.
 */
export function alignTiming(story: Story, transcript: TranscriptWord[], options: TimingAlignmentOptions): Timing {
  return alignTimingWithReport(story, transcript, options).timing;
}

/** Aligns timing and identifies beats whose anchor word was inferred rather than recognized. */
export function alignTimingWithReport(story: Story, transcript: TranscriptWord[], options: TimingAlignmentOptions): TimingAlignmentReport {
  const { audio, audioDuration } = options;
  const compositions = storyCompositions(story);
  const parts = compositions.map(scene => spokenWords(scene.narration));
  const { words: times, inferred } = alignStoryWords(story, transcript, options);
  const diagnostics: AlignmentDiagnostic[] = [];

  const scenes: Record<string, SceneTiming> = {};
  let start = 0;
  let end = 0;
  let first = 0;
  compositions.forEach((scene, index) => {
    const { words, markers } = parts[index];
    if (!words.length) throw new Error(`scene "${scene.id}" has no narration words to align`);
    const spoken = times.slice(first, first + words.length);
    const wordOffset = first;
    first += words.length;
    if (index > 0 && round(spoken[0].start) < start) {
      const previous = compositions[index - 1].id;
      throw new Error(`scene "${scene.id}": its narration starts at ${round(spoken[0].start)}s, before the scene starts at ${start}s; shorten the hold or overlap of "${previous}"`);
    }
    const lastWordEnd = spoken[spoken.length - 1].end;
    const beats = Object.fromEntries(markers.map(({ beat, before }) => [beat, round((before < words.length ? spoken[before].start : lastWordEnd) - start)]));
    for (const { beat, before } of markers) {
      if (inferred[wordOffset + Math.min(before, words.length - 1)]) {
        diagnostics.push({ compositionId: scene.id, beat, time: beats[beat], reason: 'inferred-word' });
      }
    }
    end = round(lastWordEnd + (scene.hold ?? 0));
    const duration = round(end - start);
    scenes[scene.id] = { start, duration, beats };
    const overlap = index < compositions.length - 1 ? scene.overlap ?? 0 : 0;
    if (overlap >= duration) throw new Error(`scene "${scene.id}": overlap ${overlap}s is not shorter than its ${duration}s duration`);
    start = round(end - overlap);
  });
  return { timing: { source: 'aligned', audio, ...(audioDuration === undefined ? {} : { audioDuration }), duration: end, scenes }, diagnostics };
}

function assertCoverage(matches: Array<WordMatch | undefined>, context = ''): void {
  const matched = matches.filter(Boolean).length;
  if (matched < matches.length * MIN_MATCHED) {
    throw new Error(`${context}the transcript matches only ${matched} of ${matches.length} narration words; does the audio speak this story's narration?`);
  }
}

/** Projects expanded voice tokens back onto the written words using the retained pronunciation spans. */
function spokenMatches(parts: string[][], transcript: TranscriptWord[], pronunciations: Record<string, string>): Array<WordMatch | undefined> {
  const mappings = parts.map(words => voicedNarration(words.join(' '), pronunciations));
  const tokenParts = mappings.map(mapping => [...mapping.text.matchAll(/\S+/g)]);
  const matches = matchWords(tokenParts.flatMap(tokens => tokens.map(token => normal(token[0]))), transcript);
  let offset = 0;
  return mappings.flatMap((mapping, index) => {
    const tokens = tokenParts[index];
    const partMatches = matches.slice(offset, offset + tokens.length);
    offset += tokens.length;
    const boundary = (offset: number, end: boolean): number => {
      const span = mapping.spans.find(span => end
        ? span.writtenStart < offset && offset <= span.writtenEnd
        : span.writtenStart <= offset && offset < span.writtenEnd);
      if (!span) return end ? mapping.text.length : 0;
      return span.spokenStart + (offset - span.writtenStart) / (span.writtenEnd - span.writtenStart) * (span.spokenEnd - span.spokenStart);
    };
    return [...mapping.written.matchAll(/\S+/g)].map(word => {
      const from = boundary(word.index, false);
      const to = boundary(word.index + word[0].length, true);
      const covered = tokens.flatMap((token, index) => token.index < to && token.index + token[0].length > from ? [index] : []);
      if (!covered.length || covered.some(index => !partMatches[index])) return undefined;
      const first = covered[0];
      const last = covered[covered.length - 1];
      const at = (index: number, offset: number) => {
        const match = partMatches[index]!;
        const fraction = Math.max(0, Math.min(1, (offset - tokens[index].index) / tokens[index][0].length));
        return match.start + fraction * (match.end - match.start);
      };
      return { start: at(first, from), end: at(last, to) };
    });
  });
}

/**
 * Aligns canonical script words, optionally recognizing the expanded voice text instead.
 * Known segments must cover every composition in order; matching and interpolation then stay inside each segment.
 * Without segments, canonical mode preserves the original full-transcript matching behaviour.
 */
export function alignStoryWords(story: Story, transcript: TranscriptWord[], { silences = [], segments, transcriptMode = 'canonical' }: AlignmentOptions = {}): AlignedStoryWords {
  if (!Array.isArray(transcript) || !transcript.length || transcript.some((word, index) => !word || typeof word.text !== 'string' || !word.text.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end < word.start || (index > 0 && word.start < transcript[index - 1].end))) {
    throw new Error('transcript must contain ordered, non-overlapping words with finite, nonnegative timestamps');
  }
  const compositions = storyCompositions(story);
  const parts = compositions.map(composition => spokenWords(composition.narration).words);
  if (transcriptMode !== 'canonical' && transcriptMode !== 'spoken') throw new Error('transcriptMode must be canonical or spoken');
  if (segments !== undefined && (!Array.isArray(segments) || segments.length !== compositions.length || segments.some((segment, index) =>
    !segment || segment.id !== compositions[index].id || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
    || segment.start < 0 || segment.end <= segment.start || (index > 0 && segment.start < segments[index - 1].end)))) {
    throw new Error('audio segments must cover every composition in story order with finite, positive, non-overlapping ranges');
  }
  const match = (group: string[][], input: TranscriptWord[]) => transcriptMode === 'spoken'
    ? spokenMatches(group, input, story.pronunciations ?? {})
    : matchWords(group.flat().map(normal), input);
  const groups = segments ? parts.map(part => [part]) : [parts];
  const result: AlignedStoryWords = { words: [], inferred: [] };
  for (const [index, group] of groups.entries()) {
    const words = group.flat();
    const segment = segments?.[index];
    const input = segment ? transcript.filter(word => word.start >= segment.start && word.start < segment.end)
      .map(word => ({ ...word, end: Math.min(word.end, segment.end) })) : transcript;
    const matches = match(group, input);
    assertCoverage(matches, segment ? `scene "${segment.id}": ` : '');
    const pauses = segment ? silences.map(pause => ({ start: Math.max(segment.start, pause.start), end: Math.min(segment.end, pause.end) })).filter(pause => pause.end > pause.start) : silences;
    const times = fitBeforePauses(wordTimes(matches, segment), pauses);
    result.words.push(...times.map((time, word) => ({ ...time, text: words[word] })));
    result.inferred.push(...Array.from(matches, matched => !matched));
  }
  return result;
}

/** Shares script-word alignment between scene timing and subtitles, including pause correction. */
export function alignNarrationWords(narration: string[], transcript: TranscriptWord[], silences: Silence[] = []): TranscriptWord[] {
  const matches = matchWords(narration.map(normal), transcript);
  assertCoverage(matches);
  return fitBeforePauses(wordTimes(matches), silences).map((time, index) => ({ ...time, text: narration[index] }));
}
