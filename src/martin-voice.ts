import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';
import type { VoiceRun } from './narration.ts';
import { VoiceInputTooLongError, type VoiceAdapter, type VoiceSettings } from './voice.ts';

export interface MartinAdapterOptions {
  python: string;
  model: string;
  voices: string;
  /** Story-owned directory retaining requests, phonemes, runtime identity and chunk audio. */
  provenanceDir: string;
}

const run = promisify(execFile);
const runner = fileURLToPath(new URL('../scripts/martin-tts.py', import.meta.url));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** Uses explicit local Martin assets with the same frontend and evidence as the audition runner. */
export async function createMartinAdapter(options: MartinAdapterOptions): Promise<VoiceAdapter> {
  const args = [runner, '--model', resolve(options.model), '--voices', resolve(options.voices)];
  const execute = async (extra: string[]) => {
    try {
      return await run(options.python, [...args, ...extra], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      const failure = error as { stderr?: string; stdout?: string; message?: string };
      const detail = [failure.stderr, failure.stdout].filter(Boolean).join('\n').trim() || failure.message || String(error);
      if (/^martin-tts: phoneme limit exceeded: \d+ > 510$/m.test(detail)) throw new VoiceInputTooLongError(detail, { cause: error });
      throw new Error(`Martin synthesis failed: ${detail}`, { cause: error });
    }
  };
  const identity = JSON.parse((await execute(['--identity'])).stdout);
  const version = `martin:${hash(JSON.stringify({ identity, adapter: hash(await readFile(fileURLToPath(import.meta.url))) }))}`;
  const synthesizeRuns = async (runs: VoiceRun[], settings: VoiceSettings): Promise<Buffer> => {
    if (settings.voice !== 'martin' || settings.lang !== 'de' || !Number.isFinite(settings.speed) || settings.speed < .5 || settings.speed > 2) throw new Error('Martin requires voice martin, language de and speed 0.5–2');
    const request = { speed: settings.speed, clips: [{ id: 'speech', text: runs.map(run => run.text).join(''), runs }] };
    const serialized = `${JSON.stringify(request, null, 2)}\n`;
    await mkdir(options.provenanceDir, { recursive: true });
    const directory = await mkdtemp(join(options.provenanceDir, `${hash(version + serialized)}-`));
    let complete = false;
    try {
      const input = join(directory, 'request.json');
      const output = join(directory, 'output');
      await writeFile(input, serialized);
      await writeFile(join(directory, 'identity.json'), `${JSON.stringify({ version, identity }, null, 2)}\n`);
      await execute(['--request', input, '--out', output]);
      const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
      const { request: _request, ...inputs } = manifest.inputs ?? {};
      const actualIdentity = {
        frontend: manifest.frontend,
        runtime: manifest.runtime,
        inputs,
        espeakLibrary: manifest.settings?.espeakLibrary,
        espeakData: manifest.settings?.espeakData,
      };
      if (!isDeepStrictEqual(actualIdentity, identity)) throw new Error('Martin synthesis identity changed after the probe; recreate the adapter with stable assets and runtime');
      const audio = await readFile(join(output, 'speech.wav'));
      const clip = manifest.clips?.[0];
      if (!Array.isArray(manifest.clips) || manifest.clips.length !== 1 || clip?.id !== 'speech' || clip.text !== request.clips[0].text || JSON.stringify(clip.runs) !== JSON.stringify(runs) || clip.audio?.sha256 !== hash(audio)) throw new Error('Martin output does not match its request or audio hash');
      complete = true;
      return audio;
    } finally {
      if (!complete) await rm(directory, { recursive: true, force: true });
    }
  };
  return { version, synthesizeRuns, synthesize: (text, settings) => synthesizeRuns([{ text, lang: settings.lang }], settings) };
}
