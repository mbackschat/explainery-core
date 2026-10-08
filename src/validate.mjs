import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { narrationBeats } from './narration.mjs';
import { checkStory, checkTiming } from './schemas.mjs';

// Timing values come from float arithmetic (estimates, alignment offsets); a microsecond is far below one frame.
const EPSILON = 1e-6;
const seconds = value => `${Number(value.toFixed(6))}s`;

/**
 * Checks that a schema-valid story and timing describe the same scenes and beats.
 *
 * Returns human-readable errors, empty when consistent. Scenes must start in story order and end within the story;
 * beats must exist exactly where the narration marks them, follow narration order, and lie within their scene.
 */
export function validateStoryTiming(story, timing) {
  const errors = [];
  const ids = story.scenes.map(scene => scene.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) errors.push(`story.yaml: scene id "${id}" is used twice`);
  for (const id of ids) if (!timing.scenes[id]) errors.push(`timing.json: no timing for scene "${id}"`);
  for (const id of Object.keys(timing.scenes)) if (!ids.includes(id)) errors.push(`timing.json: scene "${id}" is not in the story`);

  let previous;
  for (const scene of story.scenes) {
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

function checkBeats(where, marked, slot) {
  const errors = [];
  for (const id of marked) if (!(id in slot.beats)) errors.push(`${where}: no time for beat "${id}"`);
  for (const id of Object.keys(slot.beats)) if (!marked.includes(id)) errors.push(`${where}: beat "${id}" is not marked in the narration`);
  const timed = marked.filter(id => id in slot.beats);
  for (let i = 1; i < timed.length; i++) {
    const [before, after] = [timed[i - 1], timed[i]];
    if (slot.beats[after] < slot.beats[before] - EPSILON) {
      errors.push(`${where}: beat "${after}" at ${seconds(slot.beats[after])} comes before "${before}" at ${seconds(slot.beats[before])}, but the narration marks it after`);
    }
  }
  for (const id of timed) {
    if (slot.beats[id] > slot.duration + EPSILON) errors.push(`${where}: beat "${id}" at ${seconds(slot.beats[id])} lies after the scene's ${seconds(slot.duration)}`);
  }
  return errors;
}

async function load(dir, file, parse, check) {
  let value;
  try {
    value = parse(await readFile(join(dir, file), 'utf8'));
  } catch (error) {
    return { errors: [`${file}: ${error.code === 'ENOENT' ? 'missing' : error.message.split('\n')[0]}`] };
  }
  return { value, errors: check(value).map(error => `${file} ${error}`) };
}

async function checkCompositions(dir, story) {
  const errors = [];
  for (const id of new Set(story.scenes.map(scene => scene.id))) {
    const file = `compositions/${id}.html`;
    let html;
    try {
      html = await readFile(join(dir, file), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      errors.push(`${file}: missing`);
      continue;
    }
    // HyperFrames looks a scene's timeline up by this id; a mismatch only surfaces as a 45-second render stall.
    if (!new RegExp(`data-composition-id=["']${id}["']`).test(html)) errors.push(`${file}: no element with data-composition-id="${id}"`);
  }
  return errors;
}

/**
 * Validates the story.yaml, timing.json, and scene compositions of a project directory.
 *
 * Returns the errors, empty when valid, with the parsed story and timing. Unreadable or schema-invalid files are
 * reported per file and stop the deeper checks, since those assume valid shapes.
 */
export async function validateProject(dir) {
  const story = await load(dir, 'story.yaml', parseYaml, checkStory);
  const timing = await load(dir, 'timing.json', JSON.parse, checkTiming);
  const project = { story: story.value, timing: timing.value };
  const errors = [...story.errors, ...timing.errors];
  if (errors.length) return { errors, ...project };
  return { errors: [...validateStoryTiming(project.story, project.timing), ...(await checkCompositions(dir, project.story))], ...project };
}
