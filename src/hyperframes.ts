import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Silence, TranscriptWord } from './align.ts';
import { toMillisecond } from './time.ts';

/** The dist folder of the HyperFrames version the project itself depends on, so its pinned version does the work. */
export const hyperframesDist = (projectDir: string) => join(dirname(createRequire(join(projectDir, 'package.json')).resolve('hyperframes/package.json')), 'dist');

/**
 * Transcribes a project's audio to word timestamps with the project's `hyperframes transcribe` and its defaults
 * (local whisper, English). For other languages or models, run `hyperframes transcribe` yourself and align its
 * transcript.json instead.
 */
export async function transcribe(projectDir: string, audio: string): Promise<TranscriptWord[]> {
  const out = await mkdtemp(join(tmpdir(), 'explainery-transcript-'));
  await promisify(execFile)(process.execPath, [join(hyperframesDist(projectDir), 'cli.js'), 'transcribe', resolve(projectDir, audio), '--dir', out, '--json'], { maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(await readFile(join(out, 'transcript.json'), 'utf8'));
}

/**
 * The length of a project's audio file in seconds, read with FFmpeg's `ffprobe`, which HyperFrames already needs for
 * rendering. Alignment records it so the narration track can end with its audio instead of with the film.
 */
export async function audioDuration(projectDir: string, audio: string): Promise<number> {
  const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', resolve(projectDir, audio)]);
  const seconds = Number(stdout.trim());
  if (!(seconds > 0)) throw new Error(`cannot read the length of ${audio}`);
  return toMillisecond(seconds);
}

/**
 * The pauses in a project's audio: stretches below -40 dB lasting at least half a second, found with FFmpeg's
 * `silencedetect`. A pause still open when the audio ends lasts to its end.
 */
export async function silences(projectDir: string, audio: string): Promise<Silence[]> {
  const { stderr } = await promisify(execFile)('ffmpeg', ['-hide_banner', '-nostats', '-i', resolve(projectDir, audio), '-af', 'silencedetect=noise=-40dB:d=0.5', '-f', 'null', '-']);
  const found: Silence[] = [];
  for (const [, kind, seconds] of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (kind === 'start') found.push({ start: Math.max(0, Number(seconds)), end: Number.POSITIVE_INFINITY });
    else if (found.length) found[found.length - 1].end = Number(seconds);
  }
  return found;
}
