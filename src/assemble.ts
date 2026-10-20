import type { Story, Timing } from './types.ts';
import { cardLayerVariables } from './cards.ts';
import { storyCompositions } from './story.ts';
import { themeHref } from './theme.ts';

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
 * Only managed attributes change: an optional data-story-theme stylesheet gets the story's theme href; each
 * composition host (data-composition-src plus its data-composition-id) gets
 * data-start, data-duration, and data-variable-values {copy, beats, duration}; the root composition and every
 * element marked data-story-span get the story duration; an element marked data-story-audio gets timing.audio as
 * its src and ends with timing.audioDuration when the audio is shorter than the film, because HyperFrames' strict
 * check rejects a media slot longer than its media. Cards have no host: the one element marked data-story-cards gets
 * the card layer's variables instead. Everything else in the file is preserved byte for byte, so assembling twice
 * changes nothing.
 */
export function assembleIndex(html: string, story: Story, timing: Timing): { html: string; errors: string[] } {
  const compositions = storyCompositions(story);
  const scenes = new Map(compositions.filter(composition => !composition.card).map(composition => [composition.id, composition]));
  const cards = new Set(compositions.filter(composition => composition.card).map(composition => composition.id));
  const hosts = new Map<string, number>();
  const hostedCards = new Set<string>();
  let cardLayers = 0;
  const linkedLayers: string[] = [];
  const total = String(timing.duration);
  let rootSeen = false;
  let themeLinks = 0;
  const errors: string[] = [];
  const assembled = html.replace(TAG, (tag, name: string, attributeText: string, closing: string) => {
    const attributes = parseAttributes(attributeText);
    const has = (attributeName: string) => attributes.some(attribute => attribute.name === attributeName);
    const compositionId = attributes.find(attribute => attribute.name === 'data-composition-id')?.value;
    if (has('data-story-theme')) {
      themeLinks++;
      if (name.toLowerCase() !== 'link' || attributes.find(attribute => attribute.name === 'rel')?.value !== 'stylesheet') {
        errors.push('index.html: data-story-theme belongs on a stylesheet link');
      } else setAttribute(attributes, 'href', themeHref(story.theme));
    }
    if (compositionId === undefined && !has('data-story-span') && !has('data-story-audio') && !has('data-story-cards') && !has('data-story-theme')) return tag;
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
    if (has('data-composition-src') && compositionId !== undefined && cards.has(compositionId)) hostedCards.add(compositionId);
    if (has('data-story-cards')) {
      cardLayers++;
      const src = attributes.find(attribute => attribute.name === 'data-composition-src')?.value ?? '';
      if (src.startsWith('node_modules/')) linkedLayers.push(src);
      setAttribute(attributes, 'data-variable-values', JSON.stringify(cardLayerVariables(story, timing)));
    }
    if (has('data-story-span')) {
      setAttribute(attributes, 'data-start', '0');
      setAttribute(attributes, 'data-duration', total);
    }
    if (has('data-story-audio') && timing.audio) setAttribute(attributes, 'src', timing.audio);
    if (has('data-story-audio') && timing.audioDuration !== undefined && timing.audioDuration < timing.duration) {
      setAttribute(attributes, 'data-duration', String(timing.audioDuration));
    }
    return `<${name}${attributes.map(attribute => attribute.raw).join('')}${closing}>`;
  });
  if (themeLinks > 1) errors.push('index.html: keep one data-story-theme stylesheet');
  for (const id of scenes.keys()) {
    const count = hosts.get(id) ?? 0;
    if (count === 0) errors.push(`index.html: no host with data-composition-src for scene "${id}"`);
    if (count > 1) errors.push(`index.html: scene "${id}" has ${count} hosts`);
  }
  for (const id of hostedCards) errors.push(`index.html: card "${id}" is drawn by the card layer; remove its host`);
  if (cards.size && !cardLayers) errors.push('index.html: the story has cards but no data-story-cards layer');
  if (cardLayers > 1) errors.push(`index.html: ${cardLayers} data-story-cards layers; keep one`);
  // HyperFrames 0.8.142 compiles a render without sub-compositions whose real path leaves the project, as the
  // node_modules link does, so a linked layer would preview but render without cards.
  for (const src of linkedLayers) errors.push(`index.html: load the card layer from a file inside the project, not ${src}`);
  return { html: assembled, errors };
}
