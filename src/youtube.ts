import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sceneChapters } from './chapters.ts';
import { validateProject } from './validate.ts';
import type { Story, Timing } from './types.ts';

export interface YoutubeText { title: string; description: string }

function timestamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const tail = `${String(minutes % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${tail}` : tail;
}

/** Expands an optional {chapters} marker from full-film timing while retaining authored editorial copy. */
export function youtubeText(story: Story, timing: Timing, metadata: unknown): YoutubeText {
  if (timing.source !== 'aligned' && timing.source !== 'imported') throw new Error('YouTube metadata requires aligned or imported timing');
  if (!metadata || typeof metadata !== 'object' || !('title' in metadata) || !('description' in metadata) || typeof metadata.title !== 'string' || typeof metadata.description !== 'string') throw new Error('YouTube metadata requires string title and description');
  const title = metadata.title.trim();
  let description = metadata.description.trim();
  // YouTube's videos resource limits titles to 100 characters and descriptions to 5000 UTF-8 bytes:
  // https://developers.google.com/youtube/v3/docs/videos#snippet
  if (!title || [...title].length > 100 || /[<>\r\n]/.test(title)) throw new Error('YouTube title must be one line, 1–100 characters, without angle brackets');
  const markers = description.split('{chapters}').length - 1;
  if (markers > 1) throw new Error('YouTube description permits at most one {chapters} marker');
  if (markers) {
    const chapters = sceneChapters(story, timing);
    // Whole-second boundaries must satisfy the manual chapter rules, including the final chapter:
    // https://support.google.com/youtube/answer/9884579
    if (chapters.length < 3) throw new Error('YouTube chapters require at least three scenes; omit {chapters} for a description without chapters');
    if (chapters.some(chapter => Math.floor(chapter.end) - Math.floor(chapter.start) < 10)) throw new Error('YouTube chapters must each last at least 10 seconds after timestamp rounding');
    if (chapters.some(chapter => /[\r\n]/.test(chapter.title))) throw new Error('YouTube chapter titles must be single lines');
    description = description.replace('{chapters}', () => chapters.map(chapter => `${timestamp(chapter.start)} ${chapter.title}`).join('\n'));
  }
  if (!description || Buffer.byteLength(description, 'utf8') > 5000 || /[<>]/.test(description)) throw new Error('YouTube description must be 1–5000 UTF-8 bytes without angle brackets');
  return { title, description };
}

/** Writes local copy-ready text; does not render, authenticate, upload or change publication settings. */
export async function exportYoutubeText(project: string, metadataFile: string, out: string): Promise<YoutubeText> {
  const validated = await validateProject(project);
  if (!validated.valid) throw new Error(validated.errors.join('\n'));
  const result = youtubeText(validated.story, validated.timing, JSON.parse(await readFile(metadataFile, 'utf8')));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(`${out}-title.txt`, result.title + '\n');
  await writeFile(`${out}-description.txt`, result.description + '\n');
  return result;
}
