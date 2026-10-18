#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { assembleIndex, audioDuration, DEFAULT_WORDS_PER_SECOND, estimateTiming, exportExplainer, exportExplainerFile, loadStory, sceneRange, silences, storyCompositions, storyScenes, transcribe, validateProject, validateStoryTiming, voicedText, type PreparedSceneProject, type Story, type Timing, type TranscriptWord } from '../src/index.ts';
import { exportYoutubeText } from '../src/youtube.ts';
import { renderChapters, sceneChapters, writeMp4Chapters } from '../src/chapters.ts';
import { subtitleCues, formatSubtitles } from '../src/subtitles.ts';
import { clearFocus, readFocus, writeFocus } from '../src/focus.ts';
import { hyperframesDist } from '../src/hyperframes.ts';
import { prepareSceneProject } from '../src/scene-project.ts';
import { selectionName } from '../src/story.ts';
import { alignTimingWithReport, type AlignmentOptions, type AudioSegment } from '../src/align.ts';
import { generateVoice } from '../src/voice.ts';
import { transcribeSegments } from '../src/transcribe.ts';
import { productionPreflight, recordProduction, renderFingerprint, reusableRender, recordRender } from '../src/production.ts';
import { verifyFilm, verifyVideo } from '../src/verification.ts';
import { snapshotTimes } from '../src/snapshot.ts';
import { formatRenderProgress, parseRenderProgress } from '../src/render-progress.ts';

const USAGE = 'Usage: explainery scenes [project-dir]\n       explainery focus [project-dir] [--scene <id-or-title> | --film]\n       explainery preview [project-dir] [--scene <id,...> | --composition <id,...> | --film] [--narration] [--stop | --status]\n       explainery render [project-dir] [--scene <id,...> | --composition <id,...> | --film] [--quality draft|looks|delivery] [--out <file>] [--workers <number>] [--reuse]\n       explainery chapters [project-dir] --video <file.mp4> [--scene <id,...> | --film]\n       explainery snapshot [project-dir] --at <seconds|composition[:beat][±seconds],...> [--out <directory>] [--zoom <selector|x,y,w,h>]\n       explainery narration [project-dir]\n       explainery estimate [project-dir] [--wps <words-per-second>] [--force]\n       explainery align [project-dir] [--audio <file>] [--transcript <transcript.json>] [--transcript-mode canonical|spoken] [--segments <file.json>] [--report <file.json>] [--force]\n       explainery subtitles [project-dir] [--audio <file>] [--transcript <transcript.json>] [--out <prefix>]\n       explainery validate [project-dir]\n       explainery assemble [project-dir] [--check]\n       explainery export [project-dir] [--out <dir>] [--subtitles <file.vtt>]\n       explainery export [project-dir] --single-file [--out <file.html>] [--subtitles <file.vtt>]';
const PRODUCTION_USAGE = '\n       explainery voice [project-dir] [--sample <composition>] [--voice <name>] [--lang <locale>] [--speed <number>] [--gap <seconds>] [--out <relative.wav>]\n       explainery transcribe [project-dir] --segments <voice-manifest.json> [--out <transcript.json>]\n       explainery production [project-dir] --transcript <relative.json> [--segments <relative.json>] [--transcript-mode canonical|spoken]\n       explainery preflight [project-dir]\n       explainery verify [project-dir] [--scene <id,...> | --film] [--composition <id>] [--quick] [--out <directory>] [--pixel-tolerance <0..255>]\n       explainery deliver [project-dir] [--out <prefix>] [--workers <number>]\n       explainery youtube [project-dir] --metadata <file.json> [--out <prefix>]';
const args = process.argv.slice(2);
const valueOptions = new Set(['--subtitles', '--video', '--out', '--wps', '--audio', '--transcript', '--scene', '--quality', '--workers', '--voice', '--lang', '--speed', '--gap', '--sample', '--segments', '--transcript-mode', '--report', '--pixel-tolerance', '--metadata', '--at', '--zoom', '--composition']);
const flagOptions = new Set(['--force', '--check', '--single-file', '--film', '--stop', '--status', '--narration', '--reuse', '--quick']);
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
    const result = alignTimingWithReport(story.value, words, { audio: track, audioDuration: await audioDuration(project, track), silences: await silences(project, track), ...await alignmentOptions() });
    timing = result.timing;
    const reportFile = resolve(option('--report') ?? join(project, '.explainery/alignment.json'));
    await mkdir(dirname(reportFile), { recursive: true });
    await writeFile(reportFile, JSON.stringify({ diagnostics: result.diagnostics, compositions: result.compositions }, null, 2) + '\n');
    report(`Alignment: ${result.diagnostics.length} inferred beat timestamps; review ${reportFile}, which also lists each composition's word cues`);
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
  const cues = subtitleCues(loaded.value, words, { duration: timing.duration!, silences: await silences(project, track), ...await alignmentOptions() });
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
  if (option('--composition') !== undefined && (option('--scene') !== undefined || flag('--film'))) throw new Error('--composition selects its own scene; omit --scene and --film');
  workers();
  if (mode === 'render' && flag('--narration')) throw new Error('--narration applies only to preview');
  if (flag('--stop') && flag('--status')) throw new Error('Use either --stop or --status, not both');
  if (mode === 'render' && (flag('--stop') || flag('--status'))) throw new Error('--stop and --status apply only to preview');
  if (mode === 'preview' && (option('--quality') !== undefined || option('--out') !== undefined)) throw new Error('--quality and --out apply only to render');
  const quality = option('--quality') ?? 'draft';
  if (mode === 'render' && !['draft', 'looks', 'delivery'].includes(quality)) throw new Error('--quality must be draft, looks, or delivery');
  if (flag('--reuse') && (mode !== 'render' || quality !== 'delivery')) throw new Error('--reuse requires render --quality delivery');
  return quality;
}

// --composition, --scene and --film override the sticky focus for this one command and never change it.
function playbackCompositionIds(): string[] {
  const ids = option('--composition')?.split(',').map(id => id.trim()) ?? [];
  if (ids.some(id => !id)) throw new Error('Composition selection contains an empty ID');
  return ids;
}

async function playbackSceneIds(story: Story): Promise<string[]> {
  const explicit = option('--scene');
  const active = explicit !== undefined || flag('--film') ? undefined : await readFocus(project, story);
  const sceneIds = explicit !== undefined ? explicit.split(',').map(id => id.trim()) : active ? [active.id] : [];
  if (sceneIds.some(id => !id)) throw new Error('Scene selection contains an empty ID');
  return sceneIds;
}

function reportScope(story: Story, timing: Timing, view: PreparedSceneProject) {
  const { sceneIds, compositionIds } = view;
  if (!sceneIds.length) return report(`Scope: full film — ${story.title} (0–${timing.duration}s)`);
  const titles = storyScenes(story).filter(scene => sceneIds.includes(scene.id)).map(scene => scene.title).join('; ');
  const range = `(${view.start}–${view.start + view.duration}s)`;
  if (compositionIds.length) return report(`Scope: composition${compositionIds.length === 1 ? '' : 's'} ${compositionIds.join(',')} of scene ${sceneIds[0]} — ${titles} ${range}`);
  return report(`Scope: scene${sceneIds.length === 1 ? '' : 's'} ${sceneIds.join(',')} — ${titles} ${range}`);
}

function renderOutput(story: Story, view: PreparedSceneProject): string {
  return resolve(option('--out') ?? join('renders', `${story.id}-${view.sceneIds.length ? selectionName(view.sceneIds, view.compositionIds) : 'full'}.mp4`));
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
      const out = renderOutput(story, view);
      await mkdir(dirname(out), { recursive: true });
      report(`Rendering ${quality} to ${out}`);
      return ['render', view.directory, '--quality', quality, '--no-browser-gpu', '--workers', String(workers()), '--fps', String(story.canvas.fps), '--output', out];
    }
  }
}

function workers(): number {
  const count = Number(option('--workers') ?? 1);
  if (!Number.isInteger(count) || count < 1) throw new Error('--workers must be a positive integer');
  return count;
}

function runHyperframes(forwarded: string[]): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const start = Date.now();
    let stage = '', stageStart = start, lastProgress = 0;
    const child = spawn(process.execPath, [join(hyperframesDist(project), 'cli.js'), ...forwarded], { stdio: ['inherit', 'pipe', 'inherit'] });
    createInterface({ input: child.stdout! }).on('line', line => {
      const progress = parseRenderProgress(line);
      if (!progress) return report(line);
      if (stage !== progress.stage) { stage = progress.stage; stageStart = Date.now(); lastProgress = 0; }
      if (Date.now() - lastProgress < 2000 && progress.done !== progress.total) return;
      lastProgress = Date.now();
      report(formatRenderProgress(progress, { elapsedMs: Date.now() - start, stageElapsedMs: Date.now() - stageStart }));
    });
    child.once('error', reject);
    child.once('close', code => resolveExit(code ?? 1));
  });
}

async function playback(mode: PlaybackMode) {
  const quality = checkPlaybackFlags(mode);
  const validation = await validateProject(project);
  if (!validation.valid) return fail(validation.errors);
  const { story, timing } = validation;
  const compositionIds = playbackCompositionIds();
  const sceneIds = compositionIds.length ? [] : await playbackSceneIds(story);
  const narration = mode === 'preview' && flag('--narration');
  const view = sceneIds.length || compositionIds.length || narration ? await prepareSceneProject(project, sceneIds, { narration, compositionIds }) : { directory: project, start: 0, duration: timing.duration, sceneIds, compositionIds };
  reportScope(story, timing, view);
  // A composition selection's scene id stays in sceneIds, so only compositionIds tells it apart from that scene.
  const selection = compositionIds.length ? { compositionIds } : { sceneIds };
  const planned = mode === 'render' ? renderChapters(story, timing, selection) : undefined;
  if (mode === 'render' && flag('--reuse') && !view.sceneIds.length) {
    const stale = await staleIndex(story, timing, 'before reusable rendering');
    if (stale.length) return fail(stale);
  }
  const settings = { quality, sceneIds: view.sceneIds, compositionIds, workers: workers() };
  const fingerprint = mode === 'render' && flag('--reuse') ? await renderFingerprint(project, settings) : undefined;
  const output = renderOutput(story, view);
  if (fingerprint && await reusableRender(output, fingerprint)) return report(`Reusing verified render ${output}`);
  process.exitCode = await runHyperframes(await forwardedArguments(mode, story, view, quality));
  if (planned && process.exitCode === 0) {
    if (extname(output).toLowerCase() === '.mp4') {
      await writeMp4Chapters(output, planned.chapters, story.canvas.fps, planned.duration);
      report(planned.chapters.length ? `Added ${planned.chapters.length} scene chapters to ${output}` : `Wrote no chapters to ${output}: a composition selection lies inside one scene`);
      if (fingerprint) {
        const checked = await verifyVideo(output, { out: `${output}.verification`, story, timing, ...selection });
        if (!checked.passed) return fail(checked.failures);
        if (fingerprint !== await renderFingerprint(project, settings)) return fail(['Sources changed during rendering; output cannot be reused']);
        await recordRender(output, fingerprint);
      }
    }
  }
}

// Errors when index.html differs from what story.yaml and timing.json assemble, because commands that play the
// original root would then show other times or copy than the sources name.
async function staleIndex(story: Story, timing: Timing, purpose: string): Promise<string[]> {
  const html = await readFile(join(project, 'index.html'), 'utf8');
  const assembled = assembleIndex(html, story, timing);
  if (assembled.errors.length) return assembled.errors;
  return assembled.html === html ? [] : [`index.html is stale; run explainery assemble ${purpose}`];
}

// Snapshots address the full film's clock so that an address means the same instant whatever the focus; a scene
// view would start at zero. --describe false keeps frames local: HyperFrames 0.8.142 otherwise sends them to
// Gemini whenever GEMINI_API_KEY is set (`hyperframes snapshot --help`).
async function snapshot() {
  if (option('--scene') !== undefined || flag('--film')) return fail(['snapshot always uses the full-film clock; omit --scene and --film']);
  const list = option('--at');
  if (list === undefined) return fail(['snapshot requires --at <seconds|composition[:beat][±seconds],...>']);
  const validation = await validateProject(project);
  if (!validation.valid) return fail(validation.errors);
  const { story, timing } = validation;
  const stale = await staleIndex(story, timing, 'so snapshot times match timing.json');
  if (stale.length) return fail(stale);
  const times = snapshotTimes(timing, list);
  const out = resolve(option('--out') ?? join('renders', 'snapshots'));
  const zoom = option('--zoom');
  // HyperFrames names each file frame-<index>-at-<time>.png in --at order; the index ties a file to its address.
  for (const [index, time] of times.entries()) report(`frame-${String(index).padStart(2, '0')}\t${time.at.toFixed(3)}s\t${time.address}`);
  process.exitCode = await runHyperframes(['snapshot', project, '--at', times.map(time => time.at).join(','), '--no-end', '--no-browser-gpu', '--describe', 'false', '--output', out, ...(zoom === undefined ? [] : ['--zoom', zoom])]);
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

async function alignmentOptions(): Promise<AlignmentOptions> {
  const mode = option('--transcript-mode') ?? 'canonical';
  if (mode !== 'canonical' && mode !== 'spoken') throw new Error('--transcript-mode must be canonical or spoken');
  const path = option('--segments');
  const data = path ? JSON.parse(await readFile(resolve(path), 'utf8')) : undefined;
  const segments: AudioSegment[] | undefined = data ? (Array.isArray(data) ? data : data.segments) : undefined;
  if (path && !Array.isArray(segments)) throw new Error('--segments must contain a segment array or voice manifest');
  return { transcriptMode: mode, ...(segments ? { segments } : {}) };
}

async function voice() {
  const loaded = await loadStory(project);
  if (!loaded.value) return fail(loaded.errors);
  const manifest = await generateVoice(project, loaded.value, {
    voice: option('--voice'), lang: option('--lang'), sample: option('--sample'), out: option('--out'),
    speed: option('--speed') === undefined ? undefined : Number(option('--speed')),
    gap: option('--gap') === undefined ? undefined : Number(option('--gap')),
  });
  report(`Generated ${manifest.duration.toFixed(3)}s to ${join(project, manifest.audio)}; manifest ${join(project, manifest.manifestFile)}`);
}

async function transcribeClips() {
  const segments = option('--segments');
  if (!segments) return fail(['transcribe requires --segments <voice-manifest.json>']);
  const manifest = JSON.parse(await readFile(resolve(segments), 'utf8'));
  const { words, recognized } = await transcribeSegments(project, manifest);
  const out = resolve(option('--out') ?? join(project, '.explainery/transcribe/transcript.json'));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(words, null, 2)}\n`);
  report(`Transcribed ${words.length} words to ${out}; recognized ${recognized.length} of ${manifest.segments.length} clips, reused the rest`);
}

async function production() {
  const transcript = option('--transcript');
  if (!transcript) return fail(['production requires --transcript <project-relative.json>']);
  const transcriptMode = option('--transcript-mode') ?? 'canonical';
  if (transcriptMode !== 'canonical' && transcriptMode !== 'spoken') throw new Error('--transcript-mode must be canonical or spoken');
  await recordProduction(project, { transcript, transcriptMode, segments: option('--segments') });
  report('Recorded current narration, audio, transcript and timing in production.json; this records provenance, not listening approval');
}

async function verify() {
  checkScopeFlags();
  const quick = flag('--quick');
  if (quick && option('--pixel-tolerance') !== undefined) return fail(['--pixel-tolerance applies only to the isolation comparisons that --quick skips']);
  const receipt = await verifyFilm(project, { out: resolve(option('--out') ?? 'renders/verification'), sceneIds: option('--scene')?.split(',').map(id => id.trim()), composition: option('--composition'), quick, isolationTolerance: option('--pixel-tolerance') === undefined ? undefined : Number(option('--pixel-tolerance')) });
  report(`Verification receipt: ${receipt.receiptPath}; contact sheet: ${receipt.contactSheetPath}`);
  if (!receipt.passed) fail(receipt.failures);
}

async function deliver() {
  if (option('--scene') || flag('--film')) throw new Error('deliver always produces the full film; omit scope flags');
  const { deliverFilm } = await import('../src/delivery.ts');
  const loaded = await loadStory(project);
  if (!loaded.value) return fail(loaded.errors);
  const story = loaded.value;
  const result = await deliverFilm(project, {
    out: resolve(option('--out') ?? join('renders', `${story.id}-full`)), workers: workers(),
    render: async output => {
      const code = await runHyperframes(['render', project, '--quality', 'delivery', '--no-browser-gpu', '--workers', String(workers()), '--fps', String(story.canvas.fps), '--output', output]);
      if (code) throw new Error(`HyperFrames render failed (${code})`);
      const validated = await validateProject(project);
      if (!validated.valid) throw new Error(validated.errors.join('\n'));
      await writeMp4Chapters(output, sceneChapters(validated.story, validated.timing), story.canvas.fps);
    },
  });
  report(JSON.stringify(result, null, 2));
}

async function main() {
  if (argumentErrors.length) { fail(argumentErrors); process.exitCode = 2; return; }
  switch (command) {
    case 'youtube': {
      if (option('--scene') || flag('--film')) throw new Error('youtube uses full-film timing; omit scope flags');
      const metadata = option('--metadata');
      if (!metadata) throw new Error('youtube requires --metadata <file.json>');
      const out = resolve(option('--out') ?? 'renders/youtube');
      await exportYoutubeText(project, resolve(metadata), out);
      report(`Prepared ${out}-title.txt and ${out}-description.txt; no upload performed`);
      break;
    }
    case 'voice': await voice(); break;
    case 'transcribe': await transcribeClips(); break;
    case 'production': await production(); break;
    case 'preflight': {
      const result = await productionPreflight(project);
      if (result.errors.length) fail(result.errors); else report('Production inputs and assembly are current');
      break;
    }
    case 'verify': await verify(); break;
    case 'deliver': await deliver(); break;
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
    case 'snapshot':
      await snapshot();
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
      console.error(USAGE + PRODUCTION_USAGE);
      process.exitCode = 2;
  }
}

try { await main(); } catch (error) { fail([(error as Error).message]); }
