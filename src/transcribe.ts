import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TranscriptWord } from './align.ts';
import { hyperframesDist, transcribe } from './hyperframes.ts';
import { toMillisecond } from './time.ts';
import { atomicWrite, type VoiceManifest } from './voice.ts';

export interface RecognitionAdapter {
  /** Identifies the recognizer, so a changed one recognizes cached clips again. */
  version: string;
  /** Word timestamps in seconds from the start of a project-relative audio file. */
  transcribe(projectDir: string, audio: string): Promise<TranscriptWord[]>;
}

export interface SegmentTranscript {
  /** Words on the clock of the audio `voice` wrote, in the format `align --transcript` reads. */
  words: TranscriptWord[];
  /** Compositions whose clips were recognized in this run rather than reused from the cache. */
  recognized: string[];
}

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

// The adapter passes no engine flags, so the pinned HyperFrames version identifies its recognition; an engine
// installed later under that version (Parakeet beside Whisper) is not detected, and clearing the cache forces it.
async function hyperframesRecognizer(projectDir: string): Promise<RecognitionAdapter> {
  const { version } = JSON.parse(await readFile(join(hyperframesDist(projectDir), '../package.json'), 'utf8'));
  return { version: `hyperframes-${version}`, transcribe };
}

/**
 * Recognizes each clip of a voice manifest separately and shifts its words by the clip's segment start.
 *
 * Recognition is cached under `.explainery/transcribe/cache` by the clip's `audioSha256`, so re-voicing one composition
 * re-recognizes one clip. A clip is recognized only when its bytes still match the manifest; a cached recognition
 * needs no clip. A word reported past its clip is cut at the segment end, because the next segment can start there
 * and alignment requires ordered, non-overlapping words.
 */
export async function transcribeSegments(projectDir: string, manifest: Pick<VoiceManifest, 'segments'>, options: { adapter?: RecognitionAdapter } = {}): Promise<SegmentTranscript> {
  const segments = manifest?.segments;
  if (!Array.isArray(segments) || !segments.length || segments.some(segment => typeof segment?.audio !== 'string' || !/^[a-f0-9]{64}$/.test(segment.audioSha256 ?? ''))) {
    throw new Error('segments must come from a voice manifest whose segments name their clips and clip hashes');
  }
  const adapter = options.adapter ?? await hyperframesRecognizer(projectDir);
  const result: SegmentTranscript = { words: [], recognized: [] };
  for (const segment of segments) {
    const cacheFile = join(projectDir, '.explainery', 'transcribe', 'cache', `${segment.audioSha256}.json`);
    let words: TranscriptWord[] | undefined;
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (cached.recognizer === adapter.version && Array.isArray(cached.words)) words = cached.words;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    if (!words) {
      let clip: Buffer;
      try {
        clip = await readFile(join(projectDir, segment.audio));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        throw new Error(`the clip of "${segment.id}" is missing; run explainery voice again`, { cause: error });
      }
      if (hash(clip) !== segment.audioSha256) throw new Error(`the clip of "${segment.id}" no longer matches its voice manifest; run explainery voice again`);
      words = await adapter.transcribe(projectDir, segment.audio);
      await atomicWrite(cacheFile, `${JSON.stringify({ recognizer: adapter.version, words }, null, 2)}\n`);
      result.recognized.push(segment.id);
    }
    for (const word of words) {
      result.words.push({ ...word, start: toMillisecond(Math.min(segment.start + word.start, segment.end)), end: toMillisecond(Math.min(segment.start + word.end, segment.end)) });
    }
  }
  return result;
}
