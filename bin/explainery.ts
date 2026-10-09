#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { alignTiming, assembleIndex, audioDuration, DEFAULT_WORDS_PER_SECOND, estimateTiming, exportExplainer, exportExplainerFile, loadStory, sceneRange, silences, storyCompositions, storyScenes, transcribe, validateProject, validateStoryTiming, voicedText, type Timing, type TranscriptWord } from '../src/index.ts';
import { clearFocus, readFocus, writeFocus } from '../src/focus.ts';
import { hyperframesDist } from '../src/hyperframes.ts';
import { prepareSceneProject } from '../src/scene-project.ts';

const USAGE = 'Usage: explainery scenes [project-dir]\n       explainery focus [project-dir] [--scene <id-or-title> | --film]\n       explainery preview [project-dir] [--scene <id,...> | --film] [--stop | --status]\n       explainery render [project-dir] [--scene <id,...> | --film] [--quality draft|looks|delivery] [--out <file>]\n       explainery narration [project-dir]\n       explainery estimate [project-dir] [--wps <words-per-second>] [--force]\n       explainery align [project-dir] [--audio <file>] [--transcript <transcript.json>] [--force]\n       explainery validate [project-dir]\n       explainery assemble [project-dir] [--check]\n       explainery export [project-dir] [--out <dir>]\n       explainery export [project-dir] --single-file [--out <file.html>]';
const args = process.argv.slice(2);
const valueOptions = new Set(['--out', '--wps', '--audio', '--transcript', '--scene', '--quality']);
const flagOptions = new Set(['--force', '--check', '--single-file', '--film', '--stop', '--status']);
const options = new Map<string, string>();
const positionals: string[] = [];
const argumentErrors: string[] = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (valueOptions.has(arg)) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) argumentErrors.push(`${arg} requires a value`);
    else { options.set(arg, value); index++; }
  } else if (arg.startsWith('--')) {
    if (!flagOptions.has(arg)) argumentErrors.push(`Unknown option ${arg}`);
  } else positionals.push(arg);
}
if (positionals.length > 2) argumentErrors.push('Expected a command and at most one project directory');
const option = (name: string) => options.get(name);
const [command, dir = '.'] = positionals;
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
    timing = alignTiming(story.value, words, { audio: track, audioDuration: await audioDuration(project, track), silences: await silences(project, track) });
  } catch (error) {
    return fail([(error as Error).message]);
  }
  const errors = validateStoryTiming(story.value, timing);
  if (errors.length) return fail(errors);
  await writeTiming(file, timing);
  const count = story.value.scenes.length;
  return report(`Aligned ${count} ${count === 1 ? 'scene' : 'scenes'} to ${track}, ${timing.duration}s, into timing.json; run explainery assemble`);
}

async function narration() {
  const loaded = await loadStory(project);
  if (!loaded.value) return fail(loaded.errors);
  const story = loaded.value;
  return report(storyCompositions(story).map(composition => voicedText(composition.narration, story.pronunciations)).join('\n\n'));
}

async function scenes() {
  const validation = await validateProject(project);
  if (!validation.valid) return fail(validation.errors);
  for (const scene of storyScenes(validation.story)) {
    const range = sceneRange(scene, validation.timing);
    report(`${scene.id}\t${scene.title}\t${range.start}–${range.start + range.duration}s`);
  }
}

function checkScopeFlags() {
  if (args.includes('--film') && option('--scene') !== undefined) throw new Error('Use either --scene or --film, not both');
}

async function focus() {
  checkScopeFlags();
  const loaded = await loadStory(project);
  if (!loaded.value) return fail(loaded.errors);
  if (args.includes('--film')) await clearFocus(project);
  const selected = option('--scene');
  const scene = selected === undefined ? await readFocus(project, loaded.value) : await writeFocus(project, loaded.value, selected);
  report(scene ? `Scope: scene ${scene.id} — ${scene.title}` : `Scope: full film — ${loaded.value.title}`);
}

async function playback(mode: 'preview' | 'render') {
  checkScopeFlags();
  if (args.includes('--stop') && args.includes('--status')) throw new Error('Use either --stop or --status, not both');
  if (mode === 'render' && (args.includes('--stop') || args.includes('--status'))) throw new Error('--stop and --status apply only to preview');
  if (mode === 'preview' && (option('--quality') !== undefined || option('--out') !== undefined)) throw new Error('--quality and --out apply only to render');
  const quality = option('--quality') ?? 'draft';
  if (mode === 'render' && !['draft', 'looks', 'delivery'].includes(quality)) throw new Error('--quality must be draft, looks, or delivery');
  const validation = await validateProject(project);
  if (!validation.valid) return fail(validation.errors);
  const { story, timing } = validation;
  const explicit = option('--scene');
  const active = explicit !== undefined || args.includes('--film') ? undefined : await readFocus(project, story);
  const sceneIds = explicit !== undefined ? explicit.split(',').map(id => id.trim()) : active ? [active.id] : [];
  if (sceneIds.some(id => !id)) throw new Error('Scene selection contains an empty ID');
  const view = sceneIds.length ? await prepareSceneProject(project, sceneIds) : { directory: project, start: 0, duration: timing.duration, sceneIds: [] };
  const titles = storyScenes(story).filter(scene => sceneIds.includes(scene.id)).map(scene => scene.title).join('; ');
  report(sceneIds.length ? `Scope: scene${sceneIds.length === 1 ? '' : 's'} ${sceneIds.join(',')} — ${titles} (${view.start}–${view.start + view.duration}s)` : `Scope: full film — ${story.title} (0–${timing.duration}s)`);
  let forwarded: string[];
  switch (mode) {
    case 'preview':
      forwarded = ['preview', view.directory, ...(args.includes('--stop') ? ['--stop'] : args.includes('--status') ? ['--status'] : ['--background', '--no-open'])];
      break;
    case 'render': {
      const out = resolve(option('--out') ?? join('renders', `${story.id}-${sceneIds.length ? sceneIds.join('--') : 'full'}.mp4`));
      await mkdir(dirname(out), { recursive: true });
      report(`Rendering ${quality} to ${out}`);
      forwarded = ['render', view.directory, '--quality', quality, '--no-browser-gpu', '--workers', '1', '--fps', String(story.canvas.fps), '--output', out];
      break;
    }
  }
  process.exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, [join(hyperframesDist(project), 'cli.js'), ...forwarded], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', code => resolveExit(code ?? 1));
  });
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

async function exportFile(out: string | undefined) {
  const target = resolve(out ?? join(project, 'explainer.html'));
  try {
    const { scenes, bytes } = await exportExplainerFile(project, target);
    return report(`Exported ${scenes} ${scenes === 1 ? 'scene' : 'scenes'} into ${target} (${(bytes / 1024 / 1024).toFixed(1)} MB); open it by double-click`);
  } catch (error) {
    return fail([(error as Error).message]);
  }
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

async function main() {
  if (argumentErrors.length) { fail(argumentErrors); process.exitCode = 2; return; }
  switch (command) {
    case 'scenes':
      await scenes();
      break;
    case 'focus':
      await focus();
      break;
    case 'preview':
      await playback('preview');
      break;
    case 'render':
      await playback('render');
      break;
    case 'narration':
      await narration();
      break;
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
      await (args.includes('--single-file') ? exportFile : exportPage)(option('--out'));
      break;
    default:
      console.error(USAGE);
      process.exitCode = 2;
  }
}

try { await main(); } catch (error) { fail([(error as Error).message]); }
