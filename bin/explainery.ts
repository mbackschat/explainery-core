#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { alignTiming, assembleIndex, DEFAULT_WORDS_PER_SECOND, estimateTiming, exportExplainer, loadStory, transcribe, validateProject, validateStoryTiming, type Timing, type TranscriptWord } from '../src/index.ts';

const USAGE = 'Usage: explainery estimate [project-dir] [--wps <words-per-second>] [--force]\n       explainery align [project-dir] [--audio <file>] [--transcript <transcript.json>] [--force]\n       explainery validate [project-dir]\n       explainery assemble [project-dir] [--check]\n       explainery export [project-dir] [--out <dir>]';
const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const optionValues = ['--out', '--wps', '--audio', '--transcript'].map(option);
const [command, dir = '.'] = args.filter(arg => !arg.startsWith('--') && !optionValues.includes(arg));
const project = resolve(dir);

function fail(errors: string[]) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
}

function report(message: string) {
  console.log(message);
}

// The project's current timing.json as written, undefined when there is none and null when it cannot be parsed.
async function currentTiming(file: string): Promise<Partial<Timing> | null | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Timing from a source the command cannot regenerate, such as imported film timing, is only replaced with --force.
function refusal(current: Partial<Timing> | null | undefined, replaceable: string[], replacement: string): string | undefined {
  if (current === undefined || (current && replaceable.includes(current.source ?? ''))) return undefined;
  return `timing.json is ${current ? current.source : 'unreadable'}; pass --force to replace it with ${replacement}`;
}

async function writeTiming(file: string, timing: Timing) {
  await writeFile(file, `${JSON.stringify(timing, null, 2)}\n`);
}

async function estimate({ wps, force }: { wps: string | undefined; force: boolean }) {
  const story = await loadStory(project);
  if (!story.value) return fail(story.errors);
  const wordsPerSecond = wps === undefined ? DEFAULT_WORDS_PER_SECOND : Number(wps);
  if (!(wordsPerSecond > 0)) return fail([`--wps must be a positive number, not "${wps}"`]);
  const file = join(project, 'timing.json');
  const refused = force ? undefined : refusal(await currentTiming(file), ['estimate'], 'an estimate');
  if (refused) return fail([refused]);
  let timing;
  try {
    timing = estimateTiming(story.value, { wordsPerSecond });
  } catch (error) {
    return fail([(error as Error).message]);
  }
  const errors = validateStoryTiming(story.value, timing);
  if (errors.length) return fail(errors);
  await writeTiming(file, timing);
  const count = story.value.scenes.length;
  return report(`Estimated ${count} ${count === 1 ? 'scene' : 'scenes'}, ${timing.duration}s at ${wordsPerSecond} words per second, into timing.json; run explainery assemble`);
}

async function align({ audio, transcript, force }: { audio: string | undefined; transcript: string | undefined; force: boolean }) {
  const story = await loadStory(project);
  if (!story.value) return fail(story.errors);
  const file = join(project, 'timing.json');
  const current = await currentTiming(file);
  const refused = force ? undefined : refusal(current, ['estimate', 'aligned'], 'aligned timing');
  if (refused) return fail([refused]);
  const track = audio ?? current?.audio;
  if (!track) return fail(['timing.json names no audio; pass --audio <file>']);
  let timing;
  try {
    const words: TranscriptWord[] = transcript ? JSON.parse(await readFile(resolve(transcript), 'utf8')) : await transcribe(project, track);
    timing = alignTiming(story.value, words, { audio: track });
  } catch (error) {
    return fail([(error as Error).message]);
  }
  const errors = validateStoryTiming(story.value, timing);
  if (errors.length) return fail(errors);
  await writeTiming(file, timing);
  const count = story.value.scenes.length;
  return report(`Aligned ${count} ${count === 1 ? 'scene' : 'scenes'} to ${track}, ${timing.duration}s, into timing.json; run explainery assemble`);
}

async function validate() {
  const validation = await validateProject(project);
  if (!validation.valid) return fail(validation.errors);
  const count = validation.story.scenes.length;
  return report(`Valid: ${count} ${count === 1 ? 'scene' : 'scenes'} in ${project}`);
}

async function assemble({ check }: { check: boolean }) {
  const validation = await validateProject(project);
  if (!validation.valid) return fail(validation.errors);
  const { story, timing } = validation;
  const file = join(project, 'index.html');
  const current = await readFile(file, 'utf8');
  const assembled = assembleIndex(current, story, timing);
  if (assembled.errors.length) return fail(assembled.errors);
  if (assembled.html === current) return report('index.html is up to date');
  if (check) return fail(['index.html is out of date with story.yaml and timing.json; run explainery assemble']);
  await writeFile(file, assembled.html);
  return report(`Assembled ${story.scenes.length} scenes into index.html`);
}

async function exportPage(out: string | undefined) {
  const target = resolve(out ?? join(project, 'explainer'));
  try {
    const { scenes, files } = await exportExplainer(project, target);
    return report(`Exported ${scenes} ${scenes === 1 ? 'scene' : 'scenes'} and ${files} film files to ${target}; serve it over http, not file://`);
  } catch (error) {
    return fail([(error as Error).message]);
  }
}

switch (command) {
  case 'estimate':
    await estimate({ wps: option('--wps'), force: args.includes('--force') });
    break;
  case 'align':
    await align({ audio: option('--audio'), transcript: option('--transcript'), force: args.includes('--force') });
    break;
  case 'validate':
    await validate();
    break;
  case 'assemble':
    await assemble({ check: args.includes('--check') });
    break;
  case 'export':
    await exportPage(option('--out'));
    break;
  default:
    console.error(USAGE);
    process.exitCode = 2;
}
