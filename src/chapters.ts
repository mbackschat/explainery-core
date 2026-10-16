import { execFile } from 'node:child_process';
import { chmod, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { sceneRange, selectScenes, storyScenes } from './story.ts';
import { toMillisecond } from './time.ts';
import type { Story, Timing } from './types.ts';

export interface Chapter {
  title: string;
  start: number;
  end: number;
}

/** Derives one chapter per editorial scene, rebasing a selected range to its render's clock. */
export function sceneChapters(story: Story, timing: Timing, sceneIds: string[] = []): Chapter[] {
  const selection = sceneIds.length ? selectScenes(story, timing, sceneIds) : { start: 0, duration: timing.duration };
  const scenes = storyScenes(story).filter(scene => !sceneIds.length || sceneIds.includes(scene.id));
  const starts = scenes.map((scene, index) => index === 0 ? 0 : toMillisecond(sceneRange(scene, timing).start - selection.start));
  const chapters = scenes.map((scene, index) => ({ title: scene.title, start: starts[index], end: starts[index + 1] ?? toMillisecond(selection.duration) }));
  validateChapters(chapters);
  return chapters;
}

function validateChapters(chapters: Chapter[]): void {
  if (!chapters.length) throw new Error('chapters require at least one scene');
  for (const [index, chapter] of chapters.entries()) {
    if (!chapter.title.trim() || !Number.isFinite(chapter.start) || !Number.isFinite(chapter.end) || chapter.start < 0 || Math.round(chapter.end * 1000) <= Math.round(chapter.start * 1000)) throw new Error('chapter title and duration must be nonempty');
    if (chapter.start !== (index === 0 ? 0 : chapters[index - 1].end)) throw new Error('chapter starts must form contiguous intervals from zero');
  }
}

const run = promisify(execFile);
interface MediaProbe {
  format: { duration: string };
  chapters: Array<{ start_time: string; end_time: string; tags?: { title?: string } }>;
}

async function probe(file: string): Promise<MediaProbe> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_chapters', '-show_entries', 'format=duration', '-of', 'json', file], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

/**
 * Refreshes an MP4's chapters by stream copy, replacing the file only after metadata verification.
 *
 * The chapter range must match the video duration within one frame plus 10 ms of container rounding. The last
 * chapter ends at the actual media duration. Audio, video and subtitle streams are copied; the old chapter data
 * track is regenerated. FFmpeg writes QuickTime and Nero chapter representations by default (MOV muxer docs).
 */
export async function writeMp4Chapters(file: string, chapters: Chapter[], fps: number): Promise<void> {
  validateChapters(chapters);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('chapter frame rate must be positive');
  if (extname(file).toLowerCase() !== '.mp4') throw new Error('chapter refresh requires an MP4 file');
  const source = await realpath(file);
  const before = await probe(source);
  const duration = Number(before.format.duration);
  if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - chapters.at(-1)!.end) > 1 / fps + .01) throw new Error('video duration does not match the selected scene range; use its original timing and scene selection');
  const expected = chapters.map((chapter, index) => ({ ...chapter, end: index === chapters.length - 1 ? toMillisecond(duration) : chapter.end }));
  validateChapters(expected);
  const escape = (title: string) => title.replace(/([\\=;#\n\r])/g, '\\$1');
  const metadata = ';FFMETADATA1\n' + expected.map(chapter => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(chapter.start * 1000)}\nEND=${Math.round(chapter.end * 1000)}\ntitle=${escape(chapter.title)}\n`).join('');
  // A sibling temporary directory keeps the final rename on the same filesystem as the render.
  const work = await mkdtemp(join(dirname(source), '.explainery-chapters-'));
  try {
    const meta = join(work, 'chapters.ffmeta');
    const output = join(work, 'chaptered.mp4');
    await writeFile(meta, metadata);
    await run('ffmpeg', ['-v', 'error', '-nostdin', '-i', source, '-f', 'ffmetadata', '-i', meta,
      '-map', '0:v?', '-map', '0:a?', '-map', '0:s?', '-map_metadata', '0', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart', output], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    const after = await probe(output);
    if (after.chapters.length !== expected.length || after.chapters.some((actual, index) => actual.tags?.title !== expected[index].title || Math.abs(Number(actual.start_time) - expected[index].start) > .001 || Math.abs(Number(actual.end_time) - expected[index].end) > .001)) throw new Error('MP4 chapter verification failed; original video retained');
    await chmod(output, (await stat(source)).mode);
    await rename(output, source);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
