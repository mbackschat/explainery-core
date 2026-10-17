import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { assembleIndex } from './assemble.ts';
import { filmFiles } from './film-files.ts';
import { hyperframesDist } from './hyperframes.ts';
import { voicedText } from './narration.ts';
import { storyCompositions } from './story.ts';
import { validateProject } from './validate.ts';
import type { Story } from './types.ts';
import { alignStoryWords, type AudioSegment, type TranscriptWord } from './align.ts';
import { parseHTML } from 'linkedom';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export async function fileSha256(file: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
interface InputFile { path: string; sha256: string }
export interface ProductionRecord {
  schemaVersion: 1;
  audio: InputFile;
  transcript: InputFile;
  transcriptMode: 'canonical' | 'spoken';
  segments?: InputFile;
  timingSha256: string;
  narrationHash: string;
  voiceInputHash: string;
}
function narrationHashes(story: Story) {
  const parts = storyCompositions(story);
  return {
    narrationHash: hash(JSON.stringify(parts.map(part => ({ id: part.id, narration: part.narration })))),
    voiceInputHash: hash(JSON.stringify(parts.map(part => ({ id: part.id, text: voicedText(part.narration, story.pronunciations) })))),
  };
}
async function inputFile(project: string, path: string): Promise<InputFile> {
  const local = relative(resolve(project), resolve(project, path));
  if (isAbsolute(path) || local === '..' || local.startsWith('../')) throw new Error('production inputs must be project-relative paths');
  return { path: local, sha256: await fileSha256(join(project, local)) };
}
async function assembled(project: string, story: Parameters<typeof assembleIndex>[1], timing: Parameters<typeof assembleIndex>[2]): Promise<string[]> {
  const current = await readFile(join(project, 'index.html'), 'utf8');
  const result = assembleIndex(current, story, timing);
  const { document } = parseHTML(current);
  const audio = [...document.querySelectorAll('audio[data-story-audio]')];
  const track = audio[0];
  const bound = audio.length === 1 && track.hasAttribute('data-story-span') && Number(track.getAttribute('data-start')) === 0
    && timing.audio && resolve(project, track.getAttribute('src') ?? '') === resolve(project, timing.audio);
  return [...result.errors,
    ...(!bound ? ['production narration requires one audio[data-story-audio][data-story-span] track at zero, bound to timing.audio'] : []),
    ...(result.html !== current ? ['index.html is stale; run explainery assemble'] : [])];
}

/** Explicitly associates reviewed source audio and its transcript with current narration and timing; it does not certify listening. */
export async function recordProduction(project: string, options: { transcript: string; transcriptMode?: 'canonical' | 'spoken'; segments?: string }): Promise<ProductionRecord> {
  const validated = await validateProject(project);
  if (!validated.valid) throw new Error(validated.errors.join('\n'));
  const { story, timing } = validated;
  if (timing.source === 'estimate' || !timing.audio) throw new Error('production requires aligned or imported timing with audio');
  const errors = await assembled(project, story, timing);
  if (errors.length) throw new Error(errors.join('\n'));
  const words = JSON.parse(await readFile(join(project, options.transcript), 'utf8'));
  if (!Array.isArray(words) || !words.length) throw new Error('production transcript must be a nonempty word array');
  const audio = await inputFile(project, timing.audio);
  const hashes = narrationHashes(story);
  let segments: AudioSegment[] | undefined;
  if (options.segments) {
    const value = JSON.parse(await readFile(join(project, options.segments), 'utf8'));
    if (!Array.isArray(value)) {
      if (!value || value.sample || value.audioSha256 !== audio.sha256 || value.scriptHash !== hashes.narrationHash || value.voiceInputHash !== hashes.voiceInputHash) throw new Error('voice manifest does not match full-film audio and narration');
      if ((await inputFile(project, value.audio)).path !== audio.path) throw new Error('voice manifest audio path differs from timing.audio');
    }
    segments = Array.isArray(value) ? value : value.segments;
    if (!Array.isArray(segments)) throw new Error('segments must be an array or full voice manifest');
  }
  alignStoryWords(story, words as TranscriptWord[], { transcriptMode: options.transcriptMode ?? 'canonical', segments });
  const record: ProductionRecord = {
    schemaVersion: 1,
    audio,
    transcript: await inputFile(project, options.transcript),
    transcriptMode: options.transcriptMode ?? 'canonical',
    ...(options.segments ? { segments: await inputFile(project, options.segments) } : {}),
    timingSha256: await fileSha256(join(project, 'timing.json')),
    ...hashes,
  };
  await writeFile(join(project, 'production.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

/** Fails closed on stale production inputs while leaving ordinary draft commands available. */
export async function productionPreflight(project: string): Promise<{ errors: string[]; record?: ProductionRecord }> {
  const errors: string[] = [];
  try {
    const validated = await validateProject(project);
    if (!validated.valid) return { errors: validated.errors };
    const { story, timing } = validated;
    errors.push(...await assembled(project, story, timing));
    let record: ProductionRecord;
    try { record = JSON.parse(await readFile(join(project, 'production.json'), 'utf8')); }
    catch { return { errors: [...errors, 'production.json missing or unreadable; explicitly record reviewed inputs with explainery production'] }; }
    if (record.schemaVersion !== 1) throw new Error('unsupported production record version');
    if (!['canonical', 'spoken'].includes(record.transcriptMode)) throw new Error('invalid production transcript mode');
    if (timing.source === 'estimate' || !timing.audio) errors.push('production requires aligned or imported timing with audio');
    if (timing.audio && (await inputFile(project, timing.audio)).path !== record.audio.path) errors.push('production audio path changed');
    for (const [name, input] of [['audio', record.audio], ['transcript', record.transcript], ...(record.segments ? [['segments', record.segments]] : [])] as [string, InputFile][]) {
      if ((await inputFile(project, input.path)).sha256 !== input.sha256) errors.push(`production ${name} changed; review and record the new inputs`);
    }
    if (await fileSha256(join(project, 'timing.json')) !== record.timingSha256) errors.push('production timing changed; review and record the new alignment');
    const hashes = narrationHashes(story);
    if (hashes.narrationHash !== record.narrationHash) errors.push('production narration changed; regenerate or review the audio and transcript');
    if (hashes.voiceInputHash !== record.voiceInputHash) errors.push('production pronunciation input changed; regenerate or review the audio');
    return { errors, record };
  } catch (error) { return { errors: [...errors, (error as Error).message] }; }
}

/** Fingerprints the local shipping dependency closure and render settings (ADR 0009). */
export async function renderFingerprint(project: string, settings: { quality: string; sceneIds: string[]; workers: number }): Promise<string> {
  const paths = [...new Set([...await filmFiles(project, { strict: true }), 'story.yaml', 'timing.json'])].sort();
  const files = await Promise.all(paths.map(async path => [path, await fileSha256(join(project, path))]));
  const engine = JSON.parse(await readFile(join(hyperframesDist(project), '../package.json'), 'utf8')).version;
  const adapter = await Promise.all(['assemble.ts', 'scene-project.ts', 'chapters.ts'].map(async name => fileSha256(new URL(name, import.meta.url).pathname)));
  adapter.push(await fileSha256(new URL('../bin/explainery.ts', import.meta.url).pathname));
  return hash(JSON.stringify({ version: 1, engine, adapter, settings, files }));
}
export async function reusableRender(output: string, fingerprint: string): Promise<boolean> {
  try {
    const record = JSON.parse(await readFile(`${output}.render.json`, 'utf8'));
    return record.schemaVersion === 1 && record.fingerprint === fingerprint && record.sha256 === await fileSha256(output);
  } catch { return false; }
}
/** Call only after the output passes video verification and the source fingerprint is unchanged. */
export async function recordRender(output: string, fingerprint: string): Promise<void> {
  await writeFile(`${output}.render.json`, JSON.stringify({ schemaVersion: 1, fingerprint, sha256: await fileSha256(output) }, null, 2) + '\n');
}
