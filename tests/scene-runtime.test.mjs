import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { gsap } from 'gsap';

// The runtime is a classic browser script; evaluate the shipped file as-is instead of a Node re-export.
const source = await readFile(new URL('../runtime/scene.js', import.meta.url), 'utf8');

function sceneScope(variables, elements = [], blocks = {}) {
  const context = {};
  runInNewContext(source, context);
  const window = { __hyperframes: { getVariables: () => variables }, __timelines: {} };
  const document = {
    querySelectorAll: selector => (selector === '[data-copy]' ? elements : []),
    querySelector: selector => blocks[selector] ?? null,
  };
  return { defineScene: context.defineScene, scope: { window, document, gsap } };
}

const copyElement = key => ({ dataset: { copy: key }, textContent: 'fallback', removed: false, remove() { this.removed = true; } });
const variables = () => ({ copy: { headline: 'Hello' }, beats: { publish: 2.45 }, duration: 8.9 });

test('a scene registers a paused timeline whose tweens start at their beat', () => {
  const { defineScene, scope } = sceneScope(variables());
  const marker = { opacity: 0 };
  defineScene(scope, 'registry', (tl, { beat }) => {
    tl.to(marker, { opacity: 1, duration: 0.4 }, beat('publish') + 0.4);
  });
  const timeline = scope.window.__timelines.registry;
  assert.equal(timeline.paused(), true);
  timeline.seek(2.85);
  assert.equal(marker.opacity, 0);
  timeline.seek(3.25);
  assert.equal(marker.opacity, 1);
});

test('the build receives the scene duration for tweens that span the whole scene', () => {
  const { defineScene, scope } = sceneScope(variables());
  let received;
  defineScene(scope, 'registry', (tl, { duration }) => { received = duration; });
  assert.equal(received, 8.9);
});

test('an unknown beat fails naming the scene and the beat', () => {
  const { defineScene, scope } = sceneScope(variables());
  assert.throws(() => defineScene(scope, 'registry', (tl, { beat }) => beat('pull')), /scene "registry" has no beat "pull"/);
});

test('a timeline that overruns its scene fails and is not registered', () => {
  const { defineScene, scope } = sceneScope(variables());
  assert.throws(
    () => defineScene(scope, 'registry', (tl, { beat }) => tl.to({ x: 0 }, { x: 1, duration: 7 }, beat('publish'))),
    /scene "registry" timeline ends at 9.45s, after its 8.9s/,
  );
  assert.equal(scope.window.__timelines.registry, undefined);
});

test('copy fills its elements, and elements for absent copy are removed', () => {
  const headline = copyElement('headline');
  const category = copyElement('category');
  const { defineScene, scope } = sceneScope(variables(), [headline, category]);
  defineScene(scope, 'registry', () => {});
  assert.equal(headline.textContent, 'Hello');
  assert.equal(category.removed, true);
});

test('a scene without a duration variable fails before building', () => {
  const { defineScene, scope } = sceneScope({ copy: {}, beats: {} });
  assert.throws(() => defineScene(scope, 'registry', () => assert.fail('built without a duration')), /scene "registry" received no duration/);
});

const copyBlock = () => ({
  '.copy .accent-rule': { name: 'accent' },
  '.copy [data-copy="category"]': { name: 'category' },
  '.copy [data-copy="headline"]': { name: 'headline' },
  '.copy [data-copy="support"]': { name: 'support' },
});

function entrance(timeline) {
  return Object.fromEntries(timeline.getChildren().map(tween => [tween.targets()[0].name, { start: Number(tween.startTime().toFixed(6)), duration: tween.duration(), ease: typeof tween.vars.ease === 'string' ? tween.vars.ease : undefined }]));
}

test('enterCopy reveals the copy block in reading order from its start', () => {
  const { defineScene, scope } = sceneScope(variables(), [], copyBlock());
  const timeline = defineScene(scope, 'registry', (tl, { enterCopy }) => enterCopy(0.4));
  assert.deepEqual(entrance(timeline), {
    accent: { start: 0.4, duration: 0.3, ease: undefined },
    category: { start: 0.45, duration: 0.3, ease: undefined },
    headline: { start: 0.5, duration: 0.75, ease: 'power1.out' },
    support: { start: 1.05, duration: 0.5, ease: undefined },
  });
});

test('enterCopy takes per-scene headline and support timing', () => {
  const { defineScene, scope } = sceneScope(variables(), [], copyBlock());
  const timeline = defineScene(scope, 'scopes', (tl, { enterCopy }) => enterCopy(1, { headline: { at: 0.2, duration: 0.9 }, support: { at: 0.8, duration: 0.4 } }));
  const { headline, support } = entrance(timeline);
  assert.deepEqual([headline.start, headline.duration, support.start, support.duration], [1.2, 0.9, 1.8, 0.4]);
});

test('enterCopy skips slots the story left out', () => {
  const blocks = copyBlock();
  delete blocks['.copy [data-copy="category"]'];
  const { defineScene, scope } = sceneScope(variables(), [], blocks);
  const timeline = defineScene(scope, 'registry', (tl, { enterCopy }) => enterCopy(0.4));
  assert.deepEqual(Object.keys(entrance(timeline)), ['accent', 'headline', 'support']);
});
