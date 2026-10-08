import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { TranscriptWord } from './align.ts';

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
