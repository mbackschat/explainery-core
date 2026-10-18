import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { assembleIndex, cardLayerVariables, checkStory, validateProject, validateStoryTiming, type Composition, type Story, type Timing } from '../src/index.ts';
import { prepareSceneProject } from '../src/scene-project.ts';

const part = (id: string, extra: Partial<Composition> = {}): Composition => ({ id, copy: { headline: id }, narration: `${id}.`, ...extra });
const story: Story = {
  id: 'talk', title: 'Talk', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    { id: 'hook', title: 'Why it matters', compositions: [part('problem'), part('agenda', { card: 'agenda', copy: { headline: 'What follows' } })] },
    { id: 'storage', title: 'How data is stored', compositions: [part('storage-opener', { card: 'chapter', copy: { category: 'PART', headline: 'Where does the state live?' } }), part('tree')] },
  ],
};
// problem 0–4 overlaps agenda by 0.5; agenda 3.5–6 overlaps the opener by 0.6; the opener 5.4–8 overlaps tree by 0.4.
const timing: Timing = {
  source: 'imported', duration: 14,
  scenes: {
    problem: { start: 0, duration: 4, beats: {} },
    agenda: { start: 3.5, duration: 2.5, beats: {} },
    'storage-opener': { start: 5.4, duration: 2.6, beats: {} },
    tree: { start: 7.6, duration: 6.4, beats: {} },
  },
};
const cardsHost = '<div id="cards" data-composition-id="explainery-cards" data-composition-src="compositions/cards.html" data-story-span data-story-cards></div>';
const index = (extra = cardsHost) => `<div id="root" data-composition-id="main">
  <div id="problem" data-composition-id="problem" data-composition-src="compositions/problem.html"></div>
  <div id="tree" data-composition-id="tree" data-composition-src="compositions/tree.html"></div>
  ${extra}
</div>`;
const variables = (html: string) => JSON.parse(parseHTML(html).document.querySelector('#cards')!.getAttribute('data-variable-values')!);

test('the story schema accepts chapter and agenda cards and rejects other kinds', () => {
  assert.deepEqual(checkStory(story), []);
  const unknown = structuredClone(story);
  (unknown.scenes[1] as { compositions: Composition[] }).compositions[0].card = 'title' as Composition['card'];
  assert.notDeepEqual(checkStory(unknown), []);
});

test('the card layer receives every card with its scene, slot, crossfades and copy, and every scene title', () => {
  assert.deepEqual(cardLayerVariables(story, timing), {
    duration: 14,
    scenes: ['Why it matters', 'How data is stored'],
    cards: [
      { kind: 'agenda', start: 3.5, duration: 2.5, fadeIn: 0.5, fadeOut: 0.6, copy: { headline: 'What follows' } },
      { kind: 'chapter', scene: 1, start: 5.4, duration: 2.6, fadeIn: 0.6, fadeOut: 0.4, copy: { category: 'PART', headline: 'Where does the state live?' } },
    ],
  });
});

test('a selected range keeps only its cards, on its own clock', () => {
  assert.deepEqual(cardLayerVariables(story, timing, { start: 5.4, end: 14, duration: 8.6, compositionIds: new Set(['storage-opener', 'tree']) }).cards, [
    { kind: 'chapter', scene: 1, start: 0, duration: 2.6, fadeIn: 0.6, fadeOut: 0.4, copy: { category: 'PART', headline: 'Where does the state live?' } },
  ]);
});

test('assembly fills the card layer and needs no host or file for a card', () => {
  const { html, errors } = assembleIndex(index(), story, timing);
  assert.deepEqual(errors, []);
  assert.deepEqual(variables(html), cardLayerVariables(story, timing));
  assert.equal(parseHTML(html).document.querySelector('#cards')!.getAttribute('data-duration'), '14');
  assert.equal(assembleIndex(html, story, timing).html, html);
});

test('assembly reports a missing or repeated card layer and a host for a card', () => {
  assert.deepEqual(assembleIndex(index(''), story, timing).errors, ['index.html: the story has cards but no data-story-cards layer']);
  assert.deepEqual(assembleIndex(index(cardsHost + cardsHost.replace('id="cards"', 'id="again"')), story, timing).errors, ['index.html: 2 data-story-cards layers; keep one']);
  const hosted = index(`${cardsHost}<div data-composition-id="agenda" data-composition-src="compositions/agenda.html"></div>`);
  assert.deepEqual(assembleIndex(hosted, story, timing).errors, ['index.html: card "agenda" is drawn by the card layer; remove its host']);
  // HyperFrames 0.8.142 compiles renders without sub-compositions reached through the node_modules link.
  const linked = index(cardsHost.replace('compositions/cards.html', 'node_modules/explainery-core/cards.html'));
  assert.deepEqual(assembleIndex(linked, story, timing).errors, ['index.html: load the card layer from a file inside the project, not node_modules/explainery-core/cards.html']);
});

test('a chapter card must open its scene and introduce content after it', () => {
  const late: Story = { ...story, scenes: [story.scenes[0], { id: 'storage', title: 'Storage', compositions: [part('tree'), part('storage-opener', { card: 'chapter' })] }] };
  assert.ok(validateStoryTiming(late, timing).includes('story.yaml scene "storage-opener": a chapter card must be the first composition of its scene'));
  const cardsOnly: Story = { ...story, scenes: [story.scenes[0], { id: 'storage', title: 'Storage', compositions: [part('storage-opener', { card: 'chapter' })] }, part('tree')] };
  assert.ok(validateStoryTiming(cardsOnly, timing).includes('story.yaml scene "storage": a chapter card needs a composition after it in its scene'));
  assert.deepEqual(validateStoryTiming(story, timing), []);
});

// A closing recap is its own MP4 chapter, but it frames the film rather than adding a numbered scene to the roadmap.
test('a scene of agenda cards alone is valid and stays out of the numbered roadmap', () => {
  const closing: Story = { ...story, scenes: [story.scenes[0], { id: 'storage', title: 'How data is stored', compositions: [part('storage-opener', { card: 'chapter', copy: { headline: 'Where does the state live?' } }), part('tree')] }, { id: 'recap', title: 'Recap', compositions: [part('recap-card', { card: 'agenda', copy: { headline: 'What we saw' } })] }] };
  const slots: Timing = { ...timing, duration: 17, scenes: { ...timing.scenes, tree: { start: 7.6, duration: 6, beats: {} }, 'recap-card': { start: 13.2, duration: 3.8, beats: {} } } };
  assert.deepEqual(validateStoryTiming(closing, slots), []);
  const layer = cardLayerVariables(closing, slots);
  assert.deepEqual(layer.scenes, ['Why it matters', 'How data is stored']);
  assert.deepEqual(layer.cards.map(card => [card.kind, card.scene]), [['agenda', undefined], ['chapter', 1], ['agenda', undefined]]);
});

test('project validation does not expect composition files for cards', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-cards-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'compositions'));
  await writeFile(join(dir, 'story.yaml'), JSON.stringify(story));
  await writeFile(join(dir, 'timing.json'), JSON.stringify(timing));
  for (const id of ['problem', 'tree']) await writeFile(join(dir, 'compositions', `${id}.html`), `<template><div data-composition-id="${id}"></div></template>`);
  assert.deepEqual((await validateProject(dir)).errors, []);
});

test('a scene preview rebases the card layer to the selected scene', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-cards-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'compositions'));
  await writeFile(join(dir, 'story.yaml'), JSON.stringify(story));
  await writeFile(join(dir, 'timing.json'), JSON.stringify(timing));
  await writeFile(join(dir, 'index.html'), `<!DOCTYPE html><html><body>${index()}</body></html>`);
  const result = await prepareSceneProject(dir, ['storage']);
  const html = await readFile(join(result.directory, 'index.html'), 'utf8');
  const layer = parseHTML(html).document.querySelector('#cards')!;
  assert.equal(layer.getAttribute('data-duration'), '8.6');
  assert.deepEqual(variables(html), cardLayerVariables(story, timing, { start: 5.4, end: 14, duration: 8.6, compositionIds: new Set(['storage-opener', 'tree']) }));
});
