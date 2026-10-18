import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCompositions, selectionName } from '../src/story.ts';
import { alignTiming, assembleIndex, checkStory, estimateTiming, explainerPage, sceneRange, storyCompositions, storyScenes, validateStoryTiming, type Composition, type Story, type Timing } from '../src/index.ts';

const first: Composition = { id: 'first', copy: { headline: 'First' }, narration: 'One {enter} two.', overlap: .5 };
const second: Composition = { id: 'second', copy: { headline: 'Second' }, narration: 'Three four.', hold: .5 };
const last: Composition = { id: 'last', copy: { headline: 'Last' }, narration: 'Five.' };
const flat: Story = { id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, scenes: [first, second, last] };
const grouped: Story = { ...flat, scenes: [{ id: 'chapter', title: 'A chapter & its parts', compositions: [first, second] }, last] };
const timing: Timing = { source: 'imported', duration: 8, scenes: { first: { start: 0, duration: 4, beats: { enter: 1 } }, second: { start: 3.5, duration: 3, beats: {} }, last: { start: 6.5, duration: 1.5, beats: {} } } };

test('flat compositions normalize to single-composition scenes and mixed stories flatten in order', () => {
  assert.deepEqual(storyScenes(flat), [first, second, last].map(composition => ({ id: composition.id, title: composition.copy.headline, compositions: [composition] })));
  assert.deepEqual(storyCompositions(grouped), [first, second, last]);
  assert.equal(storyScenes(grouped)[0], grouped.scenes[0]);
  assert.equal(storyScenes(grouped)[1].title, 'Last');
});

test('scene ranges enclose all composition timings without summing overlaps or relying on entry order', () => {
  assert.deepEqual(sceneRange(storyScenes(grouped)[0], timing), { start: 0, duration: 6.5 });
  const unordered = { ...timing, scenes: { ...timing.scenes, first: { start: 6, duration: 2, beats: {} }, second: { start: 2, duration: 10, beats: {} } } };
  assert.deepEqual(sceneRange(storyScenes(grouped)[0], unordered), { start: 2, duration: 10 });
  assert.throws(() => sceneRange(storyScenes(grouped)[0], { ...timing, scenes: {} }), /no timing.*first/);
});

test('the story schema accepts flat and mixed editorial scenes and rejects empty or nested groups', () => {
  assert.deepEqual(checkStory(flat), []);
  assert.deepEqual(checkStory(grouped), []);
  assert.notDeepEqual(checkStory({ ...flat, scenes: [{ id: 'empty', title: 'Empty', compositions: [] }] }), []);
  assert.notDeepEqual(checkStory({ ...flat, scenes: [{ id: 'outer', title: 'Outer', compositions: [grouped.scenes[0]] }] }), []);
  assert.notDeepEqual(checkStory({ ...flat, scenes: [{ id: 'untitled', compositions: [first] }] }), []);
});

test('grouped stories validate composition timings and enforce both ID namespaces', () => {
  assert.deepEqual(validateStoryTiming(grouped, timing), []);
  assert.deepEqual(validateStoryTiming({ ...flat, scenes: [{ id: 'first', title: 'First chapter', compositions: [first, second] }, last] }, timing), []);
  const repeatedScene: Story = { ...grouped, scenes: [grouped.scenes[0], { id: 'chapter', copy: { headline: 'Again' }, narration: 'Again.' }] };
  assert.ok(validateStoryTiming(repeatedScene, timing).includes('story.yaml: scene id "chapter" is used twice'));
  const repeatedComposition: Story = { ...flat, scenes: [{ id: 'one', title: 'One', compositions: [first] }, { id: 'two', title: 'Two', compositions: [first] }] };
  assert.ok(validateStoryTiming(repeatedComposition, timing).includes('story.yaml: composition id "first" is used twice'));
  assert.ok(validateStoryTiming(grouped, { ...timing, scenes: { ...timing.scenes, chapter: timing.scenes.first } }).some(error => error.includes('"chapter" is not in the story')));
});

test('estimation and alignment preserve flat narration, holds, and overlaps across editorial boundaries', () => {
  assert.deepEqual(estimateTiming(grouped), estimateTiming(flat));
  const transcript = ['One', 'two.', 'Three', 'four.', 'Five.'].map((text, index) => ({ text, start: index + (index === 4 ? .5 : 0), end: index + (index === 4 ? .5 : 0) + .8 }));
  assert.deepEqual(alignTiming(grouped, transcript, { audio: 'assets/voice.wav' }), alignTiming(flat, transcript, { audio: 'assets/voice.wav' }));
});

test('assembly targets composition hosts without requiring an editorial scene host', () => {
  const html = `<div data-composition-id="root">${[first, second, last].map(composition => `<div data-composition-id="${composition.id}" data-composition-src="compositions/${composition.id}.html"></div>`).join('')}</div>`;
  const assembled = assembleIndex(html, grouped, timing);
  assert.deepEqual(assembled.errors, []);
  assert.equal(assembled.html, assembleIndex(html, flat, timing).html);
});

test('the explainer renders one section per editorial scene with its title, combined narration, and enclosing range', () => {
  const page = explainerPage(grouped, timing, { stylesheets: [] });
  assert.equal(page.match(/<section class="explainer-scene"/g)?.length, 2);
  const chapter = page.match(/<section class="explainer-scene" id="chapter">[\s\S]*?<\/section>/)![0];
  assert.match(chapter, /range-start="0" range-end="6.5"/);
  assert.match(chapter, /min="0" max="195" step="1" value="0"/);
  assert.match(chapter, /<h3>A chapter &amp; its parts<\/h3>/);
  assert.match(chapter, /<p class="explainer-narration">One two. Three four.<\/p>/);
  assert.doesNotMatch(page, /id="first-player"|id="second-player"|\{enter\}/);
});

test('a composition selection takes the enclosing range of consecutive compositions inside one editorial scene', () => {
  assert.deepEqual(selectCompositions(grouped, timing, ['second']), { start: 3.5, end: 6.5, duration: 3, compositionIds: new Set(['second']), sceneId: 'chapter' });
  assert.deepEqual(selectCompositions(grouped, timing, ['first', 'second']), { start: 0, end: 6.5, duration: 6.5, compositionIds: new Set(['first', 'second']), sceneId: 'chapter' });
  assert.equal(selectCompositions(grouped, timing, ['last']).sceneId, 'last');
});

test('a composition selection rejects unknown, repeated, unordered, gapped, or cross-scene ids with their names', () => {
  const single: Story = { ...flat, scenes: [{ id: 'all', title: 'All', compositions: [first, second, last] }] };
  for (const [selected, ids, message] of [
    [grouped, [], /at least one composition id/],
    [grouped, ['missing'], /unknown composition "missing"/],
    [grouped, ['first', 'first'], /duplicate composition ids/],
    [grouped, ['second', 'first'], /consecutive compositions of scene "chapter" in story order/],
    [single, ['first', 'last'], /consecutive compositions of scene "all" in story order/],
    [grouped, ['second', 'last'], /one editorial scene; "second" belongs to "chapter" and "last" to "last"/],
  ] as const) assert.throws(() => selectCompositions(selected, timing, [...ids]), message, ids.join(','));
});

test('selection names keep scene lists and composition selections apart in file names', () => {
  assert.equal(selectionName(['chapter', 'last']), 'chapter--last');
  assert.equal(selectionName(['chapter'], ['first', 'second']), 'chapter.first--second');
});
