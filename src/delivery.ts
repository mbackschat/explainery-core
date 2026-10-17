import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { sceneChapters, type Chapter } from './chapters.ts';
import { exportExplainerFile } from './explainer-file.ts';
import { silences } from './hyperframes.ts';
import { fileSha256, productionPreflight, recordRender, renderFingerprint, reusableRender, type ProductionRecord } from './production.ts';
import { formatSubtitles, subtitleCues } from './subtitles.ts';
import { validateProject } from './validate.ts';
import { verifyHtml, verifyVideo } from './verification.ts';
import type { AudioSegment, Silence, TranscriptWord } from './align.ts';
import type { ExplainerExportOptions } from './export-subtitles.ts';
import type { Story, Timing } from './types.ts';

interface Check { passed: boolean; failures: string[]; receiptPath: string }
type AlignmentRecord = Pick<ProductionRecord, 'transcript' | 'transcriptMode' | 'segments'>;

/** External boundaries injectable for orchestration guards without performing expensive media work. */
export interface DeliveryServices {
  preflight(project: string): Promise<{ errors: string[]; record?: AlignmentRecord }>;
  validate(project: string): Promise<{ errors: string[]; story?: Story; timing?: Timing }>;
  fingerprint: typeof renderFingerprint;
  reusable: typeof reusableRender;
  recordRender: typeof recordRender;
  silences(project: string, audio: string): Promise<Silence[]>;
  verifyVideo(file: string, options: Parameters<typeof verifyVideo>[1]): Promise<Check>;
  exportHtml(project: string, file: string, options: ExplainerExportOptions): Promise<unknown>;
  verifyHtml(file: string, options: Parameters<typeof verifyHtml>[1]): Promise<Check>;
}

export interface DeliveryManifest {
  schemaVersion: 1;
  project: string;
  fingerprint: string;
  reusedRender: boolean;
  humanReview: 'pending';
  files: Record<'mp4' | 'html' | 'srt' | 'vtt' | 'chapters', { path: string; sha256: string }>;
  chapters: Chapter[];
  verification: { video: string; html: string };
  manifestFile: string;
}

const defaults: DeliveryServices = {
  preflight: productionPreflight, validate: validateProject, fingerprint: renderFingerprint,
  reusable: reusableRender, recordRender, silences, verifyVideo, exportHtml: exportExplainerFile, verifyHtml,
};

function requirePassed(result: Check): void {
  if (!result.passed || result.failures.length) throw new Error(`delivery verification failed: ${result.failures.join('; ') || result.receiptPath}`);
}

async function checkedJson(project: string, input: { path: string; sha256: string }): Promise<unknown> {
  const path = resolve(project, input.path);
  if (await fileSha256(path) !== input.sha256) throw new Error(`production input hash changed: ${input.path}`);
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (await fileSha256(path) !== input.sha256) throw new Error(`production input hash changed while reading: ${input.path}`);
  return value;
}

function chapterText(chapters: Chapter[]): string {
  return chapters.map(chapter => {
    const milliseconds = Math.round(chapter.start * 1000);
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor(milliseconds / 60000) % 60;
    const seconds = Math.floor(milliseconds / 1000) % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')} ${chapter.title}`;
  }).join('\n') + '\n';
}

/** Produces and machine-verifies a full-film delivery from current, explicitly recorded production inputs. */
export async function deliverFilm(project: string, options: {
  out: string;
  workers?: number;
  render: (output: string) => Promise<void>;
  services?: Partial<DeliveryServices>;
}): Promise<DeliveryManifest> {
  if (!isAbsolute(options.out)) throw new Error('delivery output prefix must be absolute');
  const workers = options.workers ?? 1;
  if (!Number.isInteger(workers) || workers < 1) throw new Error('delivery workers must be a positive integer');
  const services = { ...defaults, ...options.services };
  const manifestFile = `${options.out}-delivery.json`;
  await rm(manifestFile, { force: true });
  const initial = await services.preflight(project);
  if (initial.errors.length || !initial.record) throw new Error(initial.errors.join('\n') || 'production record required');
  const production = JSON.stringify(initial.record);
  const validated = await services.validate(project);
  if (validated.errors.length || !validated.story || !validated.timing) throw new Error(validated.errors.join('\n') || 'story and timing are required');
  const { story, timing } = validated;
  if (!timing.audio || timing.source === 'estimate') throw new Error('delivery requires recorded audio and aligned or imported timing');
  const settings = { quality: 'delivery', workers, sceneIds: [] as string[] };
  const fingerprint = await services.fingerprint(project, settings);
  const transcript = await checkedJson(project, initial.record.transcript) as TranscriptWord[];
  let segments: AudioSegment[] | undefined;
  if (initial.record.segments) {
    const value = await checkedJson(project, initial.record.segments);
    segments = (Array.isArray(value) ? value : value && typeof value === 'object' && 'segments' in value ? value.segments : undefined) as AudioSegment[] | undefined;
    if (!Array.isArray(segments)) throw new Error('production segments must be an array or a voice manifest containing segments');
  }
  const cues = subtitleCues(story, transcript, { duration: timing.duration, transcriptMode: initial.record.transcriptMode, segments, silences: await services.silences(project, timing.audio) });
  const paths = { mp4: `${options.out}.mp4`, html: `${options.out}.html`, srt: `${options.out}.srt`, vtt: `${options.out}.vtt`, chapters: `${options.out}-chapters.txt` };
  const chapters = sceneChapters(story, timing);
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(paths.srt, formatSubtitles(cues, 'srt'));
  await writeFile(paths.vtt, formatSubtitles(cues, 'vtt'));
  await writeFile(paths.chapters, chapterText(chapters));
  const expectedHashes: Partial<Record<keyof typeof paths, string>> = {};
  for (const key of ['srt', 'vtt', 'chapters'] as const) expectedHashes[key] = await fileSha256(paths[key]);
  const reusedRender = await services.reusable(paths.mp4, fingerprint);
  if (!reusedRender) await options.render(paths.mp4);
  expectedHashes.mp4 = await fileSha256(paths.mp4);
  const video = await services.verifyVideo(paths.mp4, { out: `${options.out}-verification`, story, timing });
  requirePassed(video);
  if (await services.fingerprint(project, settings) !== fingerprint) throw new Error('delivery sources changed during render; output cannot be cached');
  if (await fileSha256(paths.mp4) !== expectedHashes.mp4) throw new Error('video changed after rendering or during verification');
  await services.recordRender(paths.mp4, fingerprint);
  await services.exportHtml(project, paths.html, { subtitles: paths.vtt });
  expectedHashes.html = await fileSha256(paths.html);
  const html = await services.verifyHtml(paths.html, { out: `${options.out}-verification`, project, expectAudio: true, expectSubtitles: true });
  requirePassed(html);
  const files = {} as DeliveryManifest['files'];
  for (const key of Object.keys(paths) as Array<keyof typeof paths>) files[key] = { path: paths[key], sha256: await fileSha256(paths[key]) };
  for (const key of Object.keys(paths) as Array<keyof typeof paths>) {
    if (files[key].sha256 !== expectedHashes[key]) throw new Error(`${key} changed after generation or verification`);
  }
  const final = await services.preflight(project);
  if (final.errors.length || JSON.stringify(final.record) !== production) throw new Error(final.errors.join('\n') || 'production record changed during delivery');
  if (await services.fingerprint(project, settings) !== fingerprint) throw new Error('delivery sources changed while exporting');
  const manifest: DeliveryManifest = { schemaVersion: 1, project: resolve(project), fingerprint, reusedRender, humanReview: 'pending', files, chapters, verification: { video: video.receiptPath, html: html.receiptPath }, manifestFile };
  const temporary = `${manifestFile}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
    await rename(temporary, manifestFile);
  } finally {
    await rm(temporary, { force: true });
  }
  return manifest;
}
