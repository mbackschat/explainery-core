import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { parseSrt } from './source-cues.ts';

const run = promisify(execFile);

export interface ReferenceOptions {
  video: string;
  subtitles: string;
  out: string;
  at: number[];
}

export function parseReferenceArgs(args: string[]): ReferenceOptions {
  const flags = ['--video', '--subtitles', '--out', '--at'];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!flags.includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
  }
  for (const flag of flags) {
    if (!values.has(flag)) throw new Error(`Required argument: ${flag}`);
  }
  const at = values.get('--at')!.split(',').map(value => {
    const second = Number(value);
    if (value.trim() === '' || !Number.isFinite(second) || second < 0) {
      throw new Error(`Sample seconds must be finite and nonnegative: ${value}`);
    }
    return second;
  });
  return { video: values.get('--video')!, subtitles: values.get('--subtitles')!, out: values.get('--out')!, at };
}

async function canonicalOutput(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return join(await canonicalOutput(dirname(path)), basename(path));
  }
}

export async function extractReference({ video, subtitles, out, at }: ReferenceOptions): Promise<void> {
  const outputPath = await canonicalOutput(resolve(out));
  for (const source of [video, subtitles]) {
    const sourcePath = relative(outputPath, await realpath(source));
    if (sourcePath !== '..' && !sourcePath.startsWith(`..${sep}`) && !isAbsolute(sourcePath)) {
      throw new Error(`Source input must be outside the output directory: ${source}`);
    }
  }
  await rm(join(out, 'frame-index.json'), { force: true });
  try {
    if ((await lstat(join(out, 'frames'))).isSymbolicLink()) {
      throw new Error('The frames directory must not be a symbolic link');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const cues = parseSrt(await readFile(subtitles, 'utf8'));
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', video], { timeout: 60_000 });
  const metadata: unknown = JSON.parse(stdout);
  const hashes: Record<string, string> = {};
  for (const path of [video, subtitles]) {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    hashes[path] = hash.digest('hex');
  }

  await mkdir(join(out, 'frames'), { recursive: true });
  async function writeText(filename: string, value: string): Promise<void> {
    const temporaryDirectory = await mkdtemp(join(out, '.write-'));
    try {
      const temporaryFile = join(temporaryDirectory, 'output');
      await writeFile(temporaryFile, value);
      await rename(temporaryFile, join(out, filename));
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
  async function writeJson(filename: string, value: unknown): Promise<void> {
    await writeText(filename, `${JSON.stringify(value, null, 2)}\n`);
  }
  await writeJson('source-metadata.json', metadata);
  await writeJson('source-sha256.json', hashes);
  await writeJson('narration-cues.json', cues);
  await writeText('transcript.txt', cues.map(cue => `${cue.sourceCue}. ${cue.sourceStart} --> ${cue.sourceEnd}\n${cue.text}\n`).join('\n'));

  const frames: { second: number; path: string }[] = [];
  const temporaryDirectory = await mkdtemp(join(out, 'frames', '.extract-'));
  try {
    for (const second of at) {
      const temporaryFrame = join(temporaryDirectory, 'frame.jpg');
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(second), '-i', video, '-frames:v', '1', '-q:v', '2', temporaryFrame], { timeout: 60_000 });
      const frame = await stat(temporaryFrame);
      if (!frame.isFile() || frame.size === 0) throw new Error(`No nonempty frame produced at ${second}s`);
      const path = join(out, 'frames', `source-${String(second).padStart(3, '0')}.jpg`);
      await rename(temporaryFrame, path);
      frames.push({ second, path });
      console.log(`Extracted ${path}`);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  await writeJson('frame-index.json', frames);
  console.log(`Preserved ${cues.length} source cues (${cues.filter(cue => cue.text === '').length} empty)`);
}

if (import.meta.main) {
  try {
    await extractReference(parseReferenceArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
