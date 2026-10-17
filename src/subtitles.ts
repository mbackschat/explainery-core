import { alignStoryWords, type AlignmentOptions, type TranscriptWord } from './align.ts';
import { spokenText } from './narration.ts';
import { storyCompositions } from './story.ts';
import { toMillisecond } from './time.ts';
import type { Story } from './types.ts';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type SubtitleFormat = 'srt' | 'vtt';

const MAX_LINE = 42;
const MAX_DURATION = 6;

function lines(words: string[]): string | undefined {
  const text = words.join(' ');
  if (text.length <= MAX_LINE) return text;
  let best: { text: string; score: number } | undefined;
  for (let split = 1; split < words.length; split++) {
    const left = words.slice(0, split).join(' ');
    const right = words.slice(split).join(' ');
    if (left.length > MAX_LINE || right.length > MAX_LINE) continue;
    const score = Math.abs(left.length - right.length) - (/[,:;]$/.test(left) ? 12 : 0);
    if (!best || score < best.score) best = { text: `${left}\n${right}`, score };
  }
  return best?.text;
}

/**
 * Builds full-film subtitle cues from script wording and recorded word timestamps.
 *
 * Composition boundaries, sentence endings and pauses separate cues. Limits are two 42-character lines and six
 * seconds; timing and language still need editorial review. The narration clock is unchanged, including when a
 * scene is focused. Recognition spellings and draft-voice pronunciations never become subtitle text.
 */
export function subtitleCues(story: Story, transcript: TranscriptWord[], { duration, ...options }: { duration: number } & AlignmentOptions): SubtitleCue[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('subtitle duration must be positive and finite');
  const aligned = alignStoryWords(story, transcript, options).words;
  if (transcript.at(-1)!.end > duration) throw new Error('transcript extends beyond the film duration');
  const parts = storyCompositions(story).map(part => spokenText(part.narration).split(/\s+/).filter(Boolean));
  const text = parts.flat();
  if (!text.length) throw new Error('the story has no narration to subtitle');
  if (text.some(word => word.length > MAX_LINE)) throw new Error(`a narration word exceeds the ${MAX_LINE}-character subtitle line limit; shorten it in the script`);
  if (aligned.some(word => word.end - word.start > MAX_DURATION)) throw new Error('an aligned word lasts longer than six seconds; review the transcript timestamps');
  const cues: SubtitleCue[] = [];
  let offset = 0;
  for (const part of parts) {
    const limit = offset + part.length;
    while (offset < limit) {
      let end = offset + 1;
      while (end < limit) {
        const previous = aligned[end - 1];
        const next = aligned[end];
        if (/[.!?]["'’”)]*$/.test(previous.text) || next.start - previous.end >= .7 || next.end - aligned[offset].start > MAX_DURATION || lines(text.slice(offset, end + 1)) === undefined) break;
        end++;
      }
      // A clause boundary is easier to read than a mid-phrase cut when a long sentence exceeds the cue budget.
      if (end < limit && !/[.!?]["'’”)]*$/.test(text[end - 1])) {
        for (let cut = end - 1; cut > offset; cut--) {
          if (/[,;:]$/.test(text[cut - 1]) && text.slice(offset, cut).join(' ').length >= 25) { end = cut; break; }
        }
      }
      const start = toMillisecond(aligned[offset].start);
      const nextStart = aligned[end]?.start ?? duration;
      let finish = Math.min(aligned[end - 1].end + .15, nextStart, start + MAX_DURATION, duration);
      if (nextStart - finish < .2) finish = Math.min(nextStart, start + MAX_DURATION, duration);
      finish = toMillisecond(finish);
      if (finish <= start) throw new Error('alignment produced an empty subtitle cue; review the transcript timestamps');
      cues.push({ start, end: finish, text: lines(text.slice(offset, end))! });
      offset = end;
    }
  }
  return cues;
}

function timestamp(seconds: number, separator: string): string {
  const total = Math.round(seconds * 1000);
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${separator}${String(ms).padStart(3, '0')}`;
}

/** Serializes the same plain-text cues as optional SRT or WebVTT sidecars. */
export function formatSubtitles(cues: SubtitleCue[], format: SubtitleFormat): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const separator = format === 'srt' ? ',' : '.';
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + cues.map((cue, index) => `${index + 1}\n${timestamp(cue.start, separator)} --> ${timestamp(cue.end, separator)}\n${escape(cue.text)}`).join('\n\n') + '\n';
}
