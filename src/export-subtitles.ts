import { readFile } from 'node:fs/promises';
import type { SubtitleCue } from './subtitles.ts';

export interface ExplainerExportOptions {
  /** Plain-text WebVTT file, resolved from the caller's working directory. */
  subtitles?: string;
}

/** Reads the plain-text WebVTT subset emitted by Explainery, rejecting unsupported styling and cue settings. */
export function parseExportSubtitles(source: string, duration: number): SubtitleCue[] {
  const blocks = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n/);
  if (blocks.shift() !== 'WEBVTT') throw new Error('WebVTT subtitles must begin with WEBVTT and a blank line');
  const cues: SubtitleCue[] = [];
  const stamp = '(?:(\\d{2,}):)?([0-5]\\d):([0-5]\\d)\\.(\\d{3})';
  const range = new RegExp(`^${stamp} --> ${stamp}$`);
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f' };
  for (const block of blocks) {
    const lines = block.split('\n');
    if (!lines[0].includes('-->')) lines.shift();
    const match = range.exec(lines.shift() ?? '');
    if (!match || !lines.length || lines.some(line => /<|-->|&(?!amp;|lt;|gt;|nbsp;|lrm;|rlm;)/.test(line))) throw new Error('subtitles require plain-text WebVTT cues without markup, settings or metadata');
    const seconds = (offset: number) => Number(match[offset] ?? 0) * 3600 + Number(match[offset + 1]) * 60 + Number(match[offset + 2]) + Number(match[offset + 3]) / 1000;
    const start = seconds(1);
    const end = seconds(5);
    if (!Number.isFinite(end) || start < (cues.at(-1)?.end ?? 0) || end <= start || end > duration) throw new Error('subtitle cues must be ordered, non-overlapping and within the film duration');
    cues.push({ start, end, text: lines.join('\n').replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, entity: string) => entities[entity]) });
  }
  if (!cues.length) throw new Error('subtitles must contain at least one WebVTT cue');
  return cues;
}

export async function exportSubtitles(options: ExplainerExportOptions, duration: number): Promise<SubtitleCue[]> {
  return options.subtitles === undefined ? [] : parseExportSubtitles(await readFile(options.subtitles, 'utf8'), duration);
}
