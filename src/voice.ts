import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { hyperframesDist } from './hyperframes.ts';
import { voicedText } from './narration.ts';
import { storyCompositions } from './story.ts';
import type { Story } from './types.ts';

export interface VoiceSettings { voice: string; lang: string; speed: number; gap: number }
export interface VoiceAdapter {
  /** Includes the engine/runtime identity, so changes invalidate synthesized audio. */
  version: string;
  synthesize(text: string, settings: VoiceSettings): Promise<Buffer>;
}
export interface VoiceSegment {
  id: string; start: number; end: number; audio: string; audioSha256: string;
  scriptHash: string; voiceInputHash: string; cacheKey: string;
}
export interface VoiceManifest {
  schemaVersion: 1;
  engine: { name: 'kokoro'; version: string };
  settings: VoiceSettings;
  scriptHash: string; voiceInputHash: string;
  audio: string; audioSha256: string; manifestFile: string;
  duration: number; sample?: string; segments: VoiceSegment[];
}
export interface VoiceOptions {
  voice?: string; lang?: string; speed?: number; gap?: number;
  sample?: string; out?: string; adapter?: VoiceAdapter;
}

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile);
const rate = 24000;
const synthesisTimeout = 60000;
const languages: Record<string, string> = { a: 'en-us', b: 'en-gb', e: 'es', f: 'fr-fr', h: 'hi', i: 'it', j: 'ja', p: 'pt-br', z: 'zh' };

/** Retains the JSON failure on stdout and termination metadata that execFile's message omits. */
export function voiceCommandError(error: unknown): Error {
  const failure = (typeof error === 'object' ? error : null) as { message?: string; stdout?: string | Buffer; stderr?: string | Buffer; code?: unknown; killed?: boolean; signal?: string | null } | null;
  const stdout = String(failure?.stdout ?? '').trim();
  const stderr = String(failure?.stderr ?? '').trim();
  let detail = stdout;
  try {
    const result = JSON.parse(stdout.split('\n').at(-1) ?? '');
    if (typeof result.error === 'string') detail = result.error;
  } catch {}
  const status = [`deadline=${synthesisTimeout}ms`];
  for (const key of ['code', 'killed', 'signal'] as const) {
    if (failure && key in failure) status.push(`${key}=${String(failure[key])}`);
  }
  return new Error(`local voice command failed (${status.join(', ')}): ${[detail, stderr].filter(Boolean).join('\n') || failure?.message || String(error)}`, { cause: error });
}

/** Bounds inference inputs while retaining every character, preferring sentence and word boundaries. */
export function splitVoiceText(text: string, limit = 300): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('voice chunk limit must be a positive integer');
  const chars = [...text];
  const result: string[] = [];
  let offset = 0;
  while (offset < chars.length) {
    let length = Math.min(limit, chars.length - offset);
    if (offset + length < chars.length) {
      const window = chars.slice(offset, offset + length).join('');
      const boundaries = [...window.matchAll(/[.!?。！？]\s+|\s+/gu)];
      const sentence = boundaries.filter(match => /[.!?。！？]/u.test(match[0]));
      const boundary = sentence.at(-1) ?? boundaries.at(-1);
      if (boundary) length = [...window.slice(0, boundary.index + boundary[0].length)].length;
    }
    const chunk = chars.slice(offset, offset + length).join('');
    if (chunk.trim()) result.push(chunk);
    offset += length;
  }
  return result;
}

function pcm(wav: Buffer): Buffer {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('voice engine did not produce a WAV file');
  let format = false;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wav.length) throw new Error('truncated voice WAV');
    const kind = wav.toString('ascii', offset, offset + 4);
    if (kind === 'fmt ') {
      format = size >= 16 && wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1 && wav.readUInt32LE(start + 4) === rate && wav.readUInt16LE(start + 14) === 16;
    } else if (kind === 'data') data = wav.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || !data?.length || data.length % 2) throw new Error('voice WAV must contain nonempty mono 24 kHz PCM16 audio');
  return data;
}

function wave(data: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function fileHash(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function localAdapter(projectDir: string): Promise<VoiceAdapter> {
  const dist = hyperframesDist(projectDir);
  const { version } = JSON.parse(await readFile(join(dist, '../package.json'), 'utf8'));
  const python = process.env.HYPERFRAMES_PYTHON ?? 'python3';
  const { stdout: runtime } = await run(python, ['-c', 'import sys, importlib.metadata as m; print(sys.version); print([(n,m.version(n)) for n in ["kokoro-onnx","onnxruntime","soundfile","phonemizer","espeakng-loader","numpy"]])'], { timeout: 10000 });
  const cache = join(homedir(), '.cache/hyperframes/tts');
  let models: string[];
  try {
    models = await Promise.all([fileHash(join(cache, 'models/kokoro-v1.0.onnx')), fileHash(join(cache, 'voices/voices-v1.0.bin'))]);
  } catch (error) {
    throw new Error('local Kokoro model and voices must already be installed by HyperFrames before generating voice', { cause: error });
  }
  return {
    version: `hyperframes-${version}:${hash(JSON.stringify({ runtime: runtime.trim(), models, chunking: 1 }))}`,
    async synthesize(text, settings) {
      const temp = await mkdtemp(join(tmpdir(), 'explainery-voice-'));
      try {
        const input = join(temp, 'input.txt');
        const output = join(temp, 'speech.wav');
        await writeFile(input, text);
        const { stdout } = await run(process.execPath, [join(dist, 'cli.js'), 'tts', '--text-file', input, '--output', output, '--voice', settings.voice, '--lang', settings.lang, '--speed', String(settings.speed), '--json'], { timeout: synthesisTimeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, HYPERFRAMES_PYTHON: python } }).catch(error => { throw voiceCommandError(error); });
        const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
        if (!result.ok || !result.langApplied) throw new Error('local Kokoro did not apply the requested voice language');
        return await readFile(output);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    },
  };
}

async function synthesize(text: string, settings: VoiceSettings, adapter: VoiceAdapter): Promise<Buffer> {
  try {
    return pcm(await adapter.synthesize(text, settings));
  } catch (error) {
    // HyperFrames 0.8.142 synth-v3.py identifies this Kokoro voice-table overflow with the same signature.
    if (!/index \d+ is out of bounds for axis 0 with size 510/i.test(String(error)) || [...text].length < 2) throw error;
    const chunks = splitVoiceText(text, Math.ceil([...text].length / 2));
    const parts: Buffer[] = [];
    for (const chunk of chunks) parts.push(await synthesize(chunk, settings, adapter));
    return Buffer.concat(parts);
  }
}

/** Replaces a file by rename, so an interrupted run never leaves a truncated cache entry or manifest behind. */
export async function atomicWrite(path: string, value: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, value);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Generates local voice with content-addressed composition audio and measured sample offsets.
 *
 * Each option falls back to the story's `voice` settings, then to the built-in default, so a film keeps its pacing
 * without a wrapper script. With `out`, the manifest is written beside the audio as `<out>.voice.json`, so a tracked
 * audio file carries its tracked segments; without it, both stay in the ignored `.explainery/voice` destination.
 */
export async function generateVoice(projectDir: string, story: Story, options: VoiceOptions = {}): Promise<VoiceManifest> {
  const voice = options.voice ?? story.voice?.name ?? 'af_heart';
  const settings: VoiceSettings = { voice, lang: options.lang ?? languages[voice[0].toLowerCase()] ?? 'en-us', speed: options.speed ?? story.voice?.speed ?? 1, gap: options.gap ?? story.voice?.gap ?? 0.4 };
  if (!voice || !Object.values(languages).includes(settings.lang) || !Number.isFinite(settings.speed) || settings.speed < 0.1 || settings.speed > 3 || !Number.isFinite(settings.gap) || settings.gap < 0) throw new Error('invalid voice, language, speed (0.1–3), or gap (nonnegative seconds)');
  const all = storyCompositions(story);
  const compositions = options.sample ? all.filter(part => part.id === options.sample) : all;
  if (!compositions.length) throw new Error(options.sample ? `unknown composition "${options.sample}"` : 'story has no compositions to voice');
  for (const part of compositions) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part.id) || !voicedText(part.narration, story.pronunciations)) throw new Error(`invalid or empty voice composition "${part.id}"`);
    if (![part.hold ?? 0, part.overlap ?? 0].every(value => Number.isFinite(value) && value >= 0)) throw new Error(`invalid hold or overlap in "${part.id}"`);
  }
  const destination = join('.explainery', 'voice', options.sample ? join('samples', options.sample) : 'film');
  const audio = options.out ?? join(destination, 'narration.wav');
  const relativeOutput = relative(resolve(projectDir), resolve(projectDir, audio));
  if (isAbsolute(audio) || relativeOutput.startsWith('..') || !relativeOutput.endsWith('.wav')) throw new Error('voice output must be a project-relative .wav path');
  const adapter = options.adapter ?? await localAdapter(projectDir);
  const engine = { name: 'kokoro' as const, version: adapter.version };
  const segments: VoiceSegment[] = [];
  const parts: Buffer[] = [];
  let samples = 0;
  const silence = (seconds: number) => {
    const count = Math.round(seconds * rate);
    parts.push(Buffer.alloc(count * 2));
    samples += count;
  };
  silence(0.25);
  for (const [index, part] of compositions.entries()) {
    const text = voicedText(part.narration, story.pronunciations);
    const scriptHash = hash(part.narration);
    const voiceInputHash = hash(text);
    const cacheKey = hash(JSON.stringify({ engine, voice: settings.voice, lang: settings.lang, speed: settings.speed, voiceInputHash, chunking: 1 }));
    const cachedAudio = join('.explainery', 'voice', 'cache', `${cacheKey}.wav`);
    const cachedHash = join(projectDir, '.explainery', 'voice', 'cache', `${cacheKey}.sha256`);
    let bytes: Buffer | undefined;
    try {
      const candidate = await readFile(join(projectDir, cachedAudio));
      if (hash(candidate) === (await readFile(cachedHash, 'utf8')).trim()) { pcm(candidate); bytes = candidate; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof Error && /WAV/.test(error.message))) throw error;
    }
    if (!bytes) {
      const chunks: Buffer[] = [];
      for (const chunk of splitVoiceText(text)) chunks.push(await synthesize(chunk, settings, adapter));
      bytes = wave(Buffer.concat(chunks));
      await atomicWrite(join(projectDir, cachedAudio), bytes);
      await atomicWrite(cachedHash, `${hash(bytes)}\n`);
    }
    const data = pcm(bytes);
    const start = samples / rate;
    parts.push(data);
    samples += data.length / 2;
    segments.push({ id: part.id, start, end: samples / rate, audio: cachedAudio, audioSha256: hash(bytes), scriptHash, voiceInputHash, cacheKey });
    silence(index < compositions.length - 1 ? Math.max(0, (part.hold ?? 0) - (part.overlap ?? 0)) + settings.gap : 0.25);
  }
  const bytes = wave(Buffer.concat(parts));
  const manifest: VoiceManifest = {
    schemaVersion: 1, engine, settings,
    scriptHash: hash(JSON.stringify(compositions.map(part => ({ id: part.id, narration: part.narration })))),
    voiceInputHash: hash(JSON.stringify(compositions.map(part => ({ id: part.id, text: voicedText(part.narration, story.pronunciations) })))),
    audio, audioSha256: hash(bytes), manifestFile: options.out ? `${audio}.voice.json` : join(destination, 'manifest.json'),
    duration: samples / rate, ...(options.sample ? { sample: options.sample } : {}), segments,
  };
  await atomicWrite(join(projectDir, audio), bytes);
  await atomicWrite(join(projectDir, manifest.manifestFile), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
