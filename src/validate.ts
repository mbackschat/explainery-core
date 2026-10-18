import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { narrationBeats, pronunciationErrors } from './narration.ts';
import { checkStory, checkTiming } from './schemas.ts';
import { storyCompositions, storyScenes } from './story.ts';
import type { SceneTiming, Story, Timing } from './types.ts';

// Timing values come from float arithmetic (estimates, alignment offsets); a microsecond is far below one frame.
const EPSILON = 1e-6;
const seconds = (value: number) => `${Number(value.toFixed(6))}s`;

/**
 * Checks that a schema-valid story and timing describe the same compositions and beats.
 *
 * Editorial scene IDs and composition IDs are unique within their own namespaces. A chapter card opens its scene
 * and is followed by content; only agenda cards may form a scene of their own. Compositions must start in story order and end within the story; beats must
 * follow their narration markers and lie within their composition.
 */
export function validateStoryTiming(story: Story, timing: Timing): string[] {
  const errors: string[] = [];
  const sceneIds = storyScenes(story).map(scene => scene.id);
  for (const id of new Set(sceneIds.filter((id, index) => sceneIds.indexOf(id) !== index))) errors.push(`story.yaml: scene id "${id}" is used twice`);
  const compositions = storyCompositions(story);
  const ids = compositions.map(composition => composition.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) errors.push(`story.yaml: composition id "${id}" is used twice`);
  for (const id of ids) if (!timing.scenes[id]) errors.push(`timing.json: no timing for scene "${id}"`);
  for (const id of Object.keys(timing.scenes)) if (!ids.includes(id)) errors.push(`timing.json: scene "${id}" is not in the story`);

  errors.push(...pronunciationErrors(story.pronunciations ?? {}).map(error => `story.yaml: ${error}`));
  for (const scene of storyScenes(story)) {
    scene.compositions.forEach((composition, index) => {
      if (composition.card === 'chapter' && index > 0) errors.push(`story.yaml scene "${composition.id}": a chapter card must be the first composition of its scene`);
    });
    // A scene of agenda cards alone frames the film, like a closing recap; a chapter card must introduce content.
    if (scene.compositions.every(composition => composition.card) && scene.compositions.some(composition => composition.card === 'chapter')) {
      errors.push(`story.yaml scene "${scene.id}": a chapter card needs a composition after it in its scene`);
    }
  }

  let previous: { id: string; slot: SceneTiming } | undefined;
  for (const scene of compositions) {
    const { beats: marked, errors: markerErrors } = narrationBeats(scene.narration);
    errors.push(...markerErrors.map(error => `story.yaml scene "${scene.id}": ${error}`));
    const slot = timing.scenes[scene.id];
    if (!slot) continue;
    const where = `timing.json scene "${scene.id}"`;
    const end = slot.start + slot.duration;
    if (end > timing.duration + EPSILON) errors.push(`${where}: ends at ${seconds(end)}, after the story's ${seconds(timing.duration)}`);
    if (previous && slot.start < previous.slot.start - EPSILON) {
      errors.push(`${where}: starts at ${seconds(slot.start)}, before the preceding scene "${previous.id}" at ${seconds(previous.slot.start)}`);
    }
    previous = { id: scene.id, slot };
    errors.push(...checkBeats(where, marked, slot));
  }
  return errors;
}

function checkBeats(where: string, marked: string[], slot: SceneTiming): string[] {
  const errors: string[] = [];
  for (const id of marked) if (!(id in slot.beats)) errors.push(`${where}: no time for beat "${id}"`);
  for (const id of Object.keys(slot.beats)) if (!marked.includes(id)) errors.push(`${where}: beat "${id}" is not marked in the narration`);
  const timed = marked.filter(id => id in slot.beats);
  for (let i = 1; i < timed.length; i++) {
    const [before, after] = [timed[i - 1]!, timed[i]!];
    if (slot.beats[after] < slot.beats[before] - EPSILON) {
      errors.push(`${where}: beat "${after}" at ${seconds(slot.beats[after])} comes before "${before}" at ${seconds(slot.beats[before])}, but the narration marks it after`);
    }
  }
  for (const id of timed) {
    if (slot.beats[id] > slot.duration + EPSILON) errors.push(`${where}: beat "${id}" at ${seconds(slot.beats[id])} lies after the scene's ${seconds(slot.duration)}`);
  }
  return errors;
}

// The schema check is what makes the parsed value a T; load returns a value only when it passes.
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

async function load<T>(dir: string, file: string, parse: (text: string) => unknown, check: (value: unknown) => string[]): Promise<{ value?: T; errors: string[] }> {
  let value: unknown;
  try {
    value = parse(await readFile(join(dir, file), 'utf8'));
  } catch (error) {
    return { errors: [`${file}: ${isMissing(error) ? 'missing' : (error as Error).message.split('\n')[0]}`] };
  }
  const errors = check(value).map(error => `${file} ${error}`);
  return errors.length ? { errors } : { value: value as T, errors };
}

async function checkCompositions(dir: string, story: Story): Promise<string[]> {
  const errors: string[] = [];
  // The card layer draws cards, so they have no composition file.
  for (const id of new Set(storyCompositions(story).filter(composition => !composition.card).map(composition => composition.id))) {
    const file = `compositions/${id}.html`;
    let html;
    try {
      html = await readFile(join(dir, file), 'utf8');
    } catch (error) {
      if (!isMissing(error)) throw error;
      errors.push(`${file}: missing`);
      continue;
    }
    // HyperFrames looks a scene's timeline up by this id; a mismatch only surfaces as a 45-second render stall.
    if (!new RegExp(`data-composition-id=["']${id}["']`).test(html)) errors.push(`${file}: no element with data-composition-id="${id}"`);
  }
  // Shared layers such as the card layer are sub-compositions too, so every file obeys the render rule.
  const files = await readdir(join(dir, 'compositions')).catch(error => { if (isMissing(error)) return []; throw error; });
  for (const name of files.filter(name => name.endsWith('.html')).sort()) {
    const html = await readFile(join(dir, 'compositions', name), 'utf8');
    errors.push(...deferredReveals(html).map(({ line, property }) => `compositions/${name}:${line}: a deferred fromTo (immediateRender: false) sets ${property} in its from-state, which HyperFrames renders ignore; set it with tl.set at the tween start instead`));
  }
  return errors;
}

/**
 * Finds fromTo calls that defer their from-state and set opacity in it.
 *
 * Inside a sub-composition, HyperFrames 0.8.142 applies that opacity in snapshots but ignores it in MP4 renders, so a
 * line or token revealed this way is missing from the video while every frame check shows it; a minimal fixture
 * reproduced it on 2026-10-18. Transform- and dash-only deferred calls render correctly. The scan is lexical: it
 * splits each call's arguments at top-level commas and follows spreads of option objects declared in the file.
 */
export function deferredReveals(html: string): { line: number; property: string }[] {
  const found: { line: number; property: string }[] = [];
  const deferring = /\bimmediateRender\s*:\s*false\b/;
  // Shared option objects such as `const later = { immediateRender: false }` defer every call that spreads them.
  const options = [...html.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*(\{[^{}]*\})/g)].filter(match => deferring.test(match[2])).map(match => match[1]);
  const defers = (vars: string) => deferring.test(vars) || options.some(name => new RegExp(`\\.\\.\\.${name}\\b`).test(vars));
  for (const match of html.matchAll(/\.fromTo\(/g)) {
    const args = callArguments(html, match.index + match[0].length);
    if (args.length < 3 || !defers(args[2])) continue;
    const property = /\b(opacity|autoAlpha)\s*:/.exec(args[1])?.[1];
    if (property) found.push({ line: html.slice(0, match.index).split('\n').length, property });
  }
  return found;
}

function callArguments(source: string, start: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote = '';
  let from = start;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = '';
    } else if (`"'\``.includes(char)) quote = char;
    else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char) && depth > 0) depth--;
    else if (depth === 0 && (char === ',' || char === ')')) {
      args.push(source.slice(from, index));
      if (char === ')') break;
      from = index + 1;
    }
  }
  return args;
}

/** Reads a project's story.yaml; the story is present only when it parses and passes its schema. */
export const loadStory = (dir: string) => load<Story>(dir, 'story.yaml', parseYaml, checkStory);

/**
 * The outcome of validateProject. `valid` is true exactly when there are no errors; story and timing are present
 * whenever their file parsed and passed its schema, even if the project is inconsistent.
 */
export type ProjectValidation =
  | { valid: true; errors: string[]; story: Story; timing: Timing }
  | { valid: false; errors: string[]; story?: Story; timing?: Timing };

/**
 * Validates the story.yaml, timing.json, and scene compositions of a project directory.
 *
 * Returns the errors, empty when valid, with the parsed story and timing. Unreadable or schema-invalid files are
 * reported per file and stop the deeper checks, since those assume valid shapes.
 */
export async function validateProject(dir: string): Promise<ProjectValidation> {
  const story = await loadStory(dir);
  const timing = await load<Timing>(dir, 'timing.json', JSON.parse, checkTiming);
  if (!story.value || !timing.value) return { valid: false, errors: [...story.errors, ...timing.errors], story: story.value, timing: timing.value };
  const errors = [...validateStoryTiming(story.value, timing.value), ...(await checkCompositions(dir, story.value))];
  return errors.length ? { valid: false, errors, story: story.value, timing: timing.value } : { valid: true, errors, story: story.value, timing: timing.value };
}
