#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { alignTiming, assembleIndex, audioDuration, DEFAULT_WORDS_PER_SECOND, estimateTiming, exportExplainer, exportExplainerFile, loadStory, sceneRange, silences, storyCompositions, storyScenes, transcribe, validateProject, validateStoryTiming, voicedText, type PreparedSceneProject, type Story, type Timing, type TranscriptWord } from '../src/index.ts';
import { sceneChapters, writeMp4Chapters } from '../src/chapters.ts';
import { subtitleCues, formatSubtitles } from '../src/subtitles.ts';
import { clearFocus, readFocus, writeFocus } from '../src/focus.ts';
import { hyperframesDist } from '../src/hyperframes.ts';
import { prepareSceneProject } from '../src/scene-project.ts';

const USAGE = 'Usage: explainery scenes [project-dir]\n       explainery focus [project-dir] [--scene <id-or-title> | --film]\n       explainery preview [project-dir] [--scene <id,...> | --film] [--stop | --status]\n       explainery render [project-dir] [--scene <id,...> | --film] [--quality draft|looks|delivery] [--out <file>]\n       explainery chapters [project-dir] --video <file.mp4> [--scene <id,...> | --film]\n       explainery narration [project-dir]\n       explainery estimate [project-dir] [--wps <words-per-second>] [--force]\n       explainery align [project-dir] [--audio <file>] [--transcript <transcript.json>] [--force]\n       explainery subtitles [project-dir] [--audio <file>] [--transcript <transcript.json>] [--out <prefix>]\n       explainery validate [project-dir]\n       explainery assemble [project-dir] [--check]\n       explainery export [project-dir] [--out <dir>] [--subtitles <file.vtt>]\n       explainery export [project-dir] --single-file [--out <file.html>] [--subtitles <file.vtt>]';
const args = process.argv.slice(2);
const valueOptions = new Set(['--subtitles', '--video', '--out', '--wps', '--audio', '--transcript', '--scene', '--quality']);
const flagOptions = new Set(['--force', '--check', '--single-file', '--film', '--stop', '--status']);
const options = new Map<string, string>();
const flags = new Set<string>();
const positionals: string[] = [];
const argumentErrors: string[] = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (valueOptions.has(arg)) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) argumentErrors.push(`${arg} requires a value`);
    else { options.set(arg, value); index++; }
  } else if (arg.startsWith('--')) {
    if (flagOptions.has(arg)) flags.add(arg);
    else argumentErrors.push(`Unknown option ${arg}`);
  } else positionals.push(arg);
}
if (positionals.length > 2) argumentErrors.push('Expected a command and at most one project directory');
const option = (name: string) => options.get(name);
const flag = (name: string) => flags.has(name);
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

async function subtitles() {
  if (option('--scene') !== undefined || flag('--film')) return fail(['subtitles always use the full-film clock; omit --scene and --film']);
  const loaded = await loadStory(project);
  if (!loaded.value) return fail(loaded.errors);
  const timing = await currentTiming(join(project, 'timing.json'));
  if (!timing || !Number.isFinite(timing.duration) || timing.duration! <= 0) return fail(['subtitles require timing.json with a positive film duration']);
  const track = option('--audio') ?? timing.audio;
  if (!track) return fail(['timing.json names no audio; pass --audio <file>']);
  const transcript = option('--transcript');
  const words: TranscriptWord[] = transcript ? JSON.parse(await readFile(resolve(transcript), 'utf8')) : await transcribe(project, track);
  const cues = subtitleCues(loaded.value, words, { duration: timing.duration!, silences: await silences(project, track) });
  const out = resolve(option('--out') ?? join('renders', `${loaded.value.id}-full`));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(`${out}.srt`, formatSubtitles(cues, 'srt'));
  await writeFile(`${out}.vtt`, formatSubtitles(cues, 'vtt'));
  report(`Exported ${cues.length} subtitles to ${out}.srt and ${out}.vtt; review wording, line breaks and synchronization before delivery`);
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
  if (flag('--film') && option('--scene') !== undefined) throw new Error('Use either --scene or --film, not both');
}

async function focus() {
  checkScopeFlags();
  const loaded = await loadStory(project);
  if (!loaded.value) return fail(loaded.errors);
  if (flag('--film')) await clearFocus(project);
  const selected = option('--scene');
  const scene = selected === undefined ? await readFocus(project, loaded.value) : await writeFocus(project, loaded.value, selected);
  report(scene ? `Scope: scene ${scene.id} — ${scene.title}` : `Scope: full film — ${loaded.value.title}`);
}

type PlaybackMode = 'preview' | 'render';

// Rejects unsupported flag combinations before any project work starts, and returns the render quality.
function checkPlaybackFlags(mode: PlaybackMode): string {
  checkScopeFlags();
  if (flag('--stop') && flag('--status')) throw new Error('Use either --stop or --status, not both');
  if (mode === 'render' && (flag('--stop') || flag('--status'))) throw new Error('--stop and --status apply only to preview');
  if (mode === 'preview' && (option('--quality') !== undefined || option('--out') !== undefined)) throw new Error('--quality and --out apply only to render');
  const quality = option('--quality') ?? 'draft';
  if (mode === 'render' && !['draft', 'looks', 'delivery'].includes(quality)) throw new Error('--quality must be draft, looks, or delivery');
  return quality;
}

// --scene and --film override the sticky focus for this one command and never change it.
async function playbackSceneIds(story: Story): Promise<string[]> {
  const explicit = option('--scene');
  const active = explicit !== undefined || flag('--film') ? undefined : await readFocus(project, story);
  const sceneIds = explicit !== undefined ? explicit.split(',').map(id => id.trim()) : active ? [active.id] : [];
  if (sceneIds.some(id => !id)) throw new Error('Scene selection contains an empty ID');
  return sceneIds;
}

function reportScope(story: Story, timing: Timing, view: PreparedSceneProject) {
  const { sceneIds } = view;
  if (!sceneIds.length) return report(`Scope: full film — ${story.title} (0–${timing.duration}s)`);
  const titles = storyScenes(story).filter(scene => sceneIds.includes(scene.id)).map(scene => scene.title).join('; ');
  return report(`Scope: scene${sceneIds.length === 1 ? '' : 's'} ${sceneIds.join(',')} — ${titles} (${view.start}–${view.start + view.duration}s)`);
}

function renderOutput(story: Story, sceneIds: string[]): string {
  return resolve(option('--out') ?? join('renders', `${story.id}-${sceneIds.length ? sceneIds.join('--') : 'full'}.mp4`));
}

async function chapters() {
  checkScopeFlags();
  const video = option('--video');
  if (!video) return fail(['chapters requires --video <file.mp4>']);
  if (option('--out') !== undefined) return fail(['chapters refreshes --video in place; omit --out']);
  const validation = await validateProject(project);
  if (!validation.valid) return fail(validation.errors);
  const { story, timing } = validation;
  const sceneIds = option('--scene')?.split(',').map(id => id.trim()) ?? [];
  const entries = sceneChapters(story, timing, sceneIds);
  await writeMp4Chapters(resolve(video), entries, story.canvas.fps);
  report(`Refreshed ${entries.length} chapters in ${resolve(video)}`);
  for (const entry of entries) report(`${entry.start.toFixed(3)}s\t${entry.title}`);
}

async function forwardedArguments(mode: PlaybackMode, story: Story, view: PreparedSceneProject, quality: string): Promise<string[]> {
  switch (mode) {
    case 'preview':
      return ['preview', view.directory, ...(flag('--stop') ? ['--stop'] : flag('--status') ? ['--status'] : ['--background', '--no-open'])];
    case 'render': {
      const out = renderOutput(story, view.sceneIds);
      await mkdir(dirname(out), { recursive: true });
      report(`Rendering ${quality} to ${out}`);
      return ['render', view.directory, '--quality', quality, '--no-browser-gpu', '--workers', '1', '--fps', String(story.canvas.fps), '--output', out];
    }
  }
}

function runHyperframes(forwarded: string[]): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [join(hyperframesDist(project), 'cli.js'), ...forwarded], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', code => resolveExit(code ?? 1));
  });
}

async function playback(mode: PlaybackMode) {
  const quality = checkPlaybackFlags(mode);
  const validation = await validateProject(project);
  if (!validation.valid) return fail(validation.errors);
  const { story, timing } = validation;
  const sceneIds = await playbackSceneIds(story);
  const view = sceneIds.length ? await prepareSceneProject(project, sceneIds) : { directory: project, start: 0, duration: timing.duration, sceneIds };
  reportScope(story, timing, view);
  const entries = mode === 'render' ? sceneChapters(story, timing, sceneIds) : [];
  process.exitCode = await runHyperframes(await forwardedArguments(mode, story, view, quality));
  if (mode === 'render' && process.exitCode === 0) {
    const output = renderOutput(story, sceneIds);
    if (extname(output).toLowerCase() === '.mp4') {
      await writeMp4Chapters(output, entries, story.canvas.fps);
      report(`Added ${entries.length} scene chapters to ${output}`);
    }
  }
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
  try {
    const loaded = await loadStory(project);
    if (!loaded.value) return fail(loaded.errors);
    const target = resolve(out ?? join('renders', `${loaded.value.id}-full.html`));
    const { scenes, bytes } = await exportExplainerFile(project, target, { subtitles: option('--subtitles') });
    return report(`Exported ${scenes} ${scenes === 1 ? 'scene' : 'scenes'} into ${target} (${(bytes / 1024 / 1024).toFixed(1)} MB); open it by double-click`);
  } catch (error) {
    return fail([(error as Error).message]);
  }
}

async function exportPage(out: string | undefined) {
  const target = resolve(out ?? join(project, 'explainer'));
  try {
    const { scenes, files } = await exportExplainer(project, target, { subtitles: option('--subtitles') });
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
    case 'chapters':
      await chapters();
      break;
    case 'narration':
      await narration();
      break;
    case 'estimate':
      await estimate({ wps: option('--wps'), force: flag('--force') });
      break;
    case 'align':
      await align({ audio: option('--audio'), transcript: option('--transcript'), force: flag('--force') });
      break;
    case 'subtitles':
      await subtitles();
      break;
    case 'validate':
      await validate();
      break;
    case 'assemble':
      await assemble({ check: flag('--check') });
      break;
    case 'export':
      await (flag('--single-file') ? exportFile : exportPage)(option('--out'));
      break;
    default:
      console.error(USAGE);
      process.exitCode = 2;
  }
}

try { await main(); } catch (error) { fail([(error as Error).message]); }
