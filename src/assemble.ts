import type { Story, Timing } from './types.ts';

interface Attribute {
  raw: string;
  space: string;
  name: string;
  value: string;
}

// Start tags with quoted or bare attribute values. index.html is authored by people, Studio, and this module, never
// by arbitrary tooling, so a tag-level scan keeps every byte outside the managed attributes untouched.
const TAG = /<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)(\s*\/?)>/g;
const ATTRIBUTE = /(\s+)([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(text: string): Attribute[] {
  return [...text.matchAll(ATTRIBUTE)].map(([raw, space, name, double, single, bare]) => ({ raw, space, name, value: double ?? single ?? bare ?? '' }));
}

const quote = (value: string) => (value.includes('"') ? `'${value.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}'` : `"${value.replace(/&/g, '&amp;')}"`);

function setAttribute(attributes: Attribute[], name: string, value: string) {
  const existing = attributes.find(attribute => attribute.name === name);
  if (existing) existing.raw = `${existing.space}${name}=${quote(value)}`;
  else attributes.push({ raw: ` ${name}=${quote(value)}`, space: ' ', name, value });
}

/**
 * Writes the story's timing and copy into a project's index.html and returns the new HTML with any errors.
 *
 * Only managed attributes change: each scene host (data-composition-src plus the scene's data-composition-id) gets
 * data-start, data-duration, and data-variable-values {copy, beats, duration}; the root composition and every
 * element marked data-story-span get the story duration; an element marked data-story-audio gets timing.audio as
 * its src. Everything else in the file is preserved byte for byte, so assembling twice changes nothing.
 */
export function assembleIndex(html: string, story: Story, timing: Timing): { html: string; errors: string[] } {
  const scenes = new Map(story.scenes.map(scene => [scene.id, scene]));
  const hosts = new Map<string, number>();
  const total = String(timing.duration);
  let rootSeen = false;
  const assembled = html.replace(TAG, (tag, name: string, attributeText: string, closing: string) => {
    const attributes = parseAttributes(attributeText);
    const has = (attributeName: string) => attributes.some(attribute => attribute.name === attributeName);
    const compositionId = attributes.find(attribute => attribute.name === 'data-composition-id')?.value;
    if (compositionId === undefined && !has('data-story-span') && !has('data-story-audio')) return tag;
    if (compositionId !== undefined && !has('data-composition-src') && !rootSeen) {
      rootSeen = true;
      setAttribute(attributes, 'data-duration', total);
    }
    const scene = compositionId === undefined ? undefined : scenes.get(compositionId);
    if (has('data-composition-src') && compositionId !== undefined && scene) {
      const slot = timing.scenes[compositionId];
      hosts.set(compositionId, (hosts.get(compositionId) ?? 0) + 1);
      setAttribute(attributes, 'data-start', String(slot.start));
      setAttribute(attributes, 'data-duration', String(slot.duration));
      setAttribute(attributes, 'data-variable-values', JSON.stringify({ copy: scene.copy, beats: slot.beats, duration: slot.duration }));
    }
    if (has('data-story-span')) {
      setAttribute(attributes, 'data-start', '0');
      setAttribute(attributes, 'data-duration', total);
    }
    if (has('data-story-audio') && timing.audio) setAttribute(attributes, 'src', timing.audio);
    return `<${name}${attributes.map(attribute => attribute.raw).join('')}${closing}>`;
  });
  const errors: string[] = [];
  for (const id of scenes.keys()) {
    const count = hosts.get(id) ?? 0;
    if (count === 0) errors.push(`index.html: no host with data-composition-src for scene "${id}"`);
    if (count > 1) errors.push(`index.html: scene "${id}" has ${count} hosts`);
  }
  return { html: assembled, errors };
}
