import { storyScenes } from './story.ts';
import type { Composition, Story } from './types.ts';

/**
 * The lexical half of the marketing slop detector: rejects the slogan patterns that agents reach for when copy must be short, so plain wording does not depend on a
 * reviewer catching them. Each pattern below was produced for a real film and rejected by its author; see
 * docs/plain-wording.md.
 *
 * The checks are lexical, so they catch recurring forms, not every weak sentence. Headlines and scene titles get every
 * check; support lines, which are sentences, skip the sentence checks; narration gets only the word lists, because
 * spoken sentences legitimately count and contrast.
 */
export function slopErrors(story: Story): string[] {
  const errors: string[] = [];
  for (const entry of story.scenes) {
    if ('compositions' in entry) {
      errors.push(...slogans(entry.title, 'all').map(reason => fix(`story.yaml scene "${entry.id}": title "${entry.title}" ${reason}`)));
      for (const composition of entry.compositions) errors.push(...compositionErrors(composition));
    } else errors.push(...compositionErrors(entry));
  }
  return errors;
}

/**
 * Requires a film of more than three editorial scenes to frame its structure the way a presenter would: the first
 * scene shows the route on an agenda card, every scene in between opens with a chapter card that asks its question,
 * and the film ends on a recap scene of agenda cards alone. Shorter films need no frame.
 */
export function frameErrors(story: Story): string[] {
  const scenes = storyScenes(story);
  if (scenes.length <= 3) return [];
  const errors: string[] = [];
  const size = `a film of ${scenes.length} scenes`;
  if (!scenes[0].compositions.some(composition => composition.card === 'agenda')) errors.push(`story.yaml: ${size} needs an agenda card in its first scene to show the route`);
  if (!scenes.at(-1)!.compositions.every(composition => composition.card === 'agenda')) errors.push(`story.yaml: ${size} needs a closing recap scene of agenda cards alone`);
  for (const scene of scenes.slice(1, -1)) if (scene.compositions[0].card !== 'chapter') errors.push(`story.yaml scene "${scene.id}": needs a chapter card first, asking the scene's question`);
  return errors;
}

/**
 * The editorial gate for production and delivery: plain wording and the film frame. Previews, snapshots and
 * verification skip it, because they must work on a film that is still being written.
 */
export const editorialErrors = (story: Story): string[] => [...slopErrors(story), ...frameErrors(story)];

const HYPE = ['seamless', 'seamlessly', 'powerful', 'unlock', 'unlocks', 'unleash', 'supercharge', 'effortless', 'effortlessly', 'game-changing', 'revolutionary', 'next-level', 'cutting-edge', 'world-class', 'best-in-class', 'empower', 'empowers', 'magic', 'magical', 'journey', 'delightful'];
const METAPHORS = ['home', 'superpower', 'superpowers'];
const COUNT = '(?:one|two|three|four|five|six|seven|eight|nine|ten|many|several|\\d+)';
// "Five pillars, one core", "One core, many hosts": a count, a noun phrase, a comma and another count.
const COUNTED_CONTRAST = new RegExp(`\\b${COUNT}\\s+[\\w'-]+(?:\\s+[\\w'-]+)?\\s*,\\s*${COUNT}\\b`, 'i');

function compositionErrors(composition: Composition): string[] {
  const where = `story.yaml composition "${composition.id}"`;
  const { headline, support } = composition.copy;
  return [
    ...slogans(headline, 'all').map(reason => fix(`${where}: headline "${headline}" ${reason}`)),
    ...(support ? slogans(support, 'sentence').map(reason => fix(`${where}: support "${support}" ${reason}`)) : []),
    ...slogans(composition.narration, 'words').map(reason => fix(`${where}: narration ${reason}`)),
  ];
}

function slogans(text: string, checks: 'all' | 'sentence' | 'words'): string[] {
  const reasons: string[] = [];
  if (checks === 'all') {
    if (/[.!?]\s+\S/.test(text)) reasons.push('has several sentences');
    else if (/[^.]\.\s*$/.test(text)) reasons.push('ends with a period');
    if (/^(?:more than|beyond|not just)\b/i.test(text)) reasons.push('is a teaser');
  }
  if (checks !== 'words' && COUNTED_CONTRAST.test(text)) reasons.push('is a counted contrast');
  const words = text.toLowerCase().match(/[\w'-]+/g) ?? [];
  const hype = [...new Set(words.filter(word => HYPE.includes(word)))];
  if (hype.length) reasons.push(`uses hype words (${hype.join(', ')})`);
  const metaphors = [...new Set(words.filter((word, index) => METAPHORS.includes(word) && !(word === 'home' && words[index + 1] === 'page')))];
  if (metaphors.length) reasons.push(`uses a metaphor (${metaphors.join(', ')})`);
  return reasons;
}

const fix = (error: string) => `${error}; marketing slop: state what the viewer sees plainly (docs/plain-wording.md)`;
