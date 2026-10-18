import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { gsap } from 'gsap';

// The runtime is a classic browser script; evaluate the shipped file as-is instead of a Node re-export.
const source = await readFile(new URL('../runtime/scene.js', import.meta.url), 'utf8');

// The minimal shapes this test fakes and calls; runtime/scene.ts owns the authoritative DefineScene signature.
interface Variables { copy?: Record<string, string>; beats?: Record<string, number>; duration?: number }
interface FakeElement { dataset: { copy: string }; textContent: string; removed: boolean; remove(): void }
interface Reveal { at?: number; duration?: number }
type Target = string | object | object[];
interface Motion {
  draw(target: Target, at: number, seconds?: number): void;
  rise(target: Target, at: number, y?: number): void;
  travel(target: Target, points: [number, number][], at: number, seconds: number): void;
  pulse(target: Target, origin: string, at: number, scale?: number): void;
  focus(keep: Target, at: number, until: number, options: { within: string; dim?: number }): void;
}
interface Tools { beat(name: string): number; duration: number; enterCopy(at: number, timing?: { headline?: Reveal; support?: Reveal }): void; motion: Motion }
interface Scope {
  window: { __hyperframes: { getVariables(): Variables }; __timelines: Record<string, gsap.core.Timeline> };
  document: { querySelectorAll(selector: string): object[]; querySelector(selector: string): object | null };
  gsap: typeof gsap;
}
type DefineScene = (scope: Scope, id: string, build: (timeline: gsap.core.Timeline, tools: Tools) => void) => gsap.core.Timeline;

function sceneScope(variables: Variables, elements: FakeElement[] = [], blocks: Record<string, object> = {}) {
  const context = {} as { defineScene: DefineScene };
  runInNewContext(source, context);
  const window: Scope['window'] = { __hyperframes: { getVariables: () => variables }, __timelines: {} };
  const document: Scope['document'] = {
    querySelectorAll: selector => (selector === '[data-copy]' ? elements : []),
    querySelector: selector => blocks[selector] ?? null,
  };
  return { defineScene: context.defineScene, scope: { window, document, gsap } };
}

const copyElement = (key: string): FakeElement => ({ dataset: { copy: key }, textContent: 'fallback', removed: false, remove() { this.removed = true; } });
const variables = (): Variables => ({ copy: { headline: 'Hello' }, beats: { publish: 2.45 }, duration: 8.9 });

test('a scene registers a paused timeline whose tweens start at their beat', () => {
  const { defineScene, scope } = sceneScope(variables());
  const marker = { opacity: 0 };
  defineScene(scope, 'library', (tl, { beat }) => {
    tl.to(marker, { opacity: 1, duration: 0.4 }, beat('publish') + 0.4);
  });
  const timeline = scope.window.__timelines.library;
  assert.equal(timeline.paused(), true);
  timeline.seek(2.85);
  assert.equal(marker.opacity, 0);
  timeline.seek(3.25);
  assert.equal(marker.opacity, 1);
});

test('the build receives the scene duration for tweens that span the whole scene', () => {
  const { defineScene, scope } = sceneScope(variables());
  let received: number | undefined;
  defineScene(scope, 'library', (tl, { duration }) => { received = duration; });
  assert.equal(received, 8.9);
});

test('an unknown beat fails naming the scene and the beat', () => {
  const { defineScene, scope } = sceneScope(variables());
  assert.throws(() => defineScene(scope, 'library', (tl, { beat }) => beat('pull')), /scene "library" has no beat "pull"/);
});

test('a timeline that overruns its scene fails and is not registered', () => {
  const { defineScene, scope } = sceneScope(variables());
  assert.throws(
    () => defineScene(scope, 'library', (tl, { beat }) => tl.to({ x: 0 }, { x: 1, duration: 7 }, beat('publish'))),
    /scene "library" timeline ends at 9.45s, after its 8.9s/,
  );
  assert.equal(scope.window.__timelines.library, undefined);
});

test('copy fills its elements, and elements for absent copy are removed', () => {
  const headline = copyElement('headline');
  const category = copyElement('category');
  const { defineScene, scope } = sceneScope(variables(), [headline, category]);
  defineScene(scope, 'library', () => {});
  assert.equal(headline.textContent, 'Hello');
  assert.equal(category.removed, true);
});

test('a scene without a duration variable fails before building', () => {
  const { defineScene, scope } = sceneScope({ copy: {}, beats: {} });
  assert.throws(() => defineScene(scope, 'library', () => assert.fail('built without a duration')), /scene "library" received no duration/);
});

const copyBlock = (): Record<string, { name: string }> => ({
  '.copy .accent-rule': { name: 'accent' },
  '.copy [data-copy="category"]': { name: 'category' },
  '.copy [data-copy="headline"]': { name: 'headline' },
  '.copy [data-copy="support"]': { name: 'support' },
});

function entrance(timeline: gsap.core.Timeline) {
  return Object.fromEntries((timeline.getChildren() as gsap.core.Tween[]).map(tween => [(tween.targets()[0] as { name: string }).name, { start: Number(tween.startTime().toFixed(6)), duration: tween.duration(), ease: typeof tween.vars.ease === 'string' ? tween.vars.ease : undefined }]));
}

test('enterCopy reveals the copy block in reading order from its start', () => {
  const { defineScene, scope } = sceneScope(variables(), [], copyBlock());
  const timeline = defineScene(scope, 'library', (tl, { enterCopy }) => enterCopy(0.4));
  assert.deepEqual(entrance(timeline), {
    accent: { start: 0.4, duration: 0.3, ease: undefined },
    category: { start: 0.45, duration: 0.3, ease: undefined },
    headline: { start: 0.5, duration: 0.75, ease: 'power1.out' },
    support: { start: 1.05, duration: 0.5, ease: undefined },
  });
});

test('enterCopy takes per-scene headline and support timing', () => {
  const { defineScene, scope } = sceneScope(variables(), [], copyBlock());
  const timeline = defineScene(scope, 'branches', (tl, { enterCopy }) => enterCopy(1, { headline: { at: 0.2, duration: 0.9 }, support: { at: 0.8, duration: 0.4 } }));
  const { headline, support } = entrance(timeline);
  assert.deepEqual([headline.start, headline.duration, support.start, support.duration], [1.2, 0.9, 1.8, 0.4]);
});

test('enterCopy skips slots the story left out', () => {
  const blocks = copyBlock();
  delete blocks['.copy [data-copy="category"]'];
  const { defineScene, scope } = sceneScope(variables(), [], blocks);
  const timeline = defineScene(scope, 'library', (tl, { enterCopy }) => enterCopy(0.4));
  assert.deepEqual(Object.keys(entrance(timeline)), ['accent', 'headline', 'support']);
});

// Plain objects stand in for SVG elements: GSAP tweens their properties, so a seek shows each helper's state directly.
interface Shape { opacity: number; x?: number; y?: number; scale?: number; strokeDashoffset?: number; getTotalLength(): number; contains(other: object): boolean; children?: Shape[] }
const shape = (opacity = 0, children: Shape[] = []): Shape => ({ opacity, children, getTotalLength: () => 100, contains(other) { return other === this || children.some(child => child.contains(other)); } });

function motionScene(blocks: Record<string, object>, build: (tl: gsap.core.Timeline, tools: Tools) => void) {
  const { defineScene, scope } = sceneScope(variables());
  scope.document.querySelector = selector => blocks[selector] ?? null;
  scope.document.querySelectorAll = selector => (blocks[selector] ? [blocks[selector]] : []);
  return defineScene(scope, 'library', build);
}

test('draw reveals a hidden line at its start and strokes it to full length', () => {
  const line = shape();
  const timeline = motionScene({}, (tl, { motion }) => motion.draw(line, 1, .5));
  timeline.seek(.9);
  assert.equal(line.opacity, 0);
  timeline.seek(1.25);
  assert.equal(line.opacity, 1);
  assert.ok(line.strokeDashoffset! > 0 && line.strokeDashoffset! < 100);
  timeline.seek(1.6);
  assert.equal(line.strokeDashoffset, 0);
});

// A dash hides the stroke but not its markers, so an arrowhead would wait at the far end while the line is drawn.
// GSAP's attr plugin is inactive under Node, so this locks the schedule; the MP4 fixture proves the rendered effect.
test('draw holds back a line marker until the stroke reaches it', () => {
  const line = Object.assign(shape(), { getAttribute: (name: string) => (name === 'marker-end' ? 'url(#arrow)' : null) });
  const timeline = motionScene({}, (tl, { motion }) => motion.draw(line, 1, .5));
  const markers = (timeline.getChildren() as gsap.core.Tween[])
    .filter(tween => tween.vars.attr)
    .map(tween => [tween.startTime(), (tween.vars.attr as Record<string, string>)['marker-end']]);
  assert.deepEqual(markers, [[1, 'none'], [1.5, 'url(#arrow)']]);
});

test('rise holds its target hidden and lifted until its start, then settles it in place', () => {
  const card = shape(1);
  const timeline = motionScene({}, (tl, { motion }) => motion.rise(card, 1));
  timeline.seek(.5);
  assert.deepEqual([card.opacity, card.y], [0, 24]);
  timeline.seek(2);
  assert.deepEqual([card.opacity, card.y], [1, 0]);
});

test('travel shows a token at its first waypoint, passes every corner and hides it on arrival', () => {
  const token = shape();
  const timeline = motionScene({}, (tl, { motion }) => motion.travel(token, [[0, 0], [100, 0], [100, 50]], 1, 1));
  timeline.seek(1.5);
  assert.deepEqual([token.opacity, token.x, token.y], [1, 100, 0]);
  timeline.seek(2.5);
  assert.deepEqual([token.opacity, token.x, token.y], [0, 100, 50]);
});

test('pulse scales its target about the origin and returns it to rest', () => {
  const mark = shape(1);
  const timeline = motionScene({}, (tl, { motion }) => motion.pulse(mark, '10 10', 1, 1.5));
  timeline.seek(1.25);
  assert.equal(mark.scale, 1.5);
  timeline.seek(2);
  assert.equal(mark.scale, 1);
});

test('focus dims the other wrappers of its container for its window and leaves the kept one alone', () => {
  const kept = shape(1);
  const [left, middle, right] = [shape(1), shape(1, [kept]), shape(1)];
  const diagram = shape(1, [left, middle, right]);
  const timeline = motionScene({ '#diagram': diagram, '#kept': kept }, (tl, { motion }) => {
    motion.focus('#kept', 1, 3, { within: '#diagram' });
    tl.to({}, { duration: 1 }, 4);
  });
  timeline.seek(2);
  assert.deepEqual([left.opacity, middle.opacity, right.opacity], [.3, 1, .3]);
  timeline.seek(4);
  assert.deepEqual([left.opacity, middle.opacity, right.opacity], [1, 1, 1]);
});

test('focus windows in one container may not overlap', () => {
  const kept = shape(1);
  const diagram = shape(1, [shape(1, [kept]), shape(1)]);
  assert.throws(() => motionScene({ '#diagram': diagram, '#kept': kept }, (tl, { motion }) => {
    motion.focus('#kept', 1, 3, { within: '#diagram' });
    motion.focus('#kept', 2, 4, { within: '#diagram' });
  }), /scene "library": focus windows in "#diagram" overlap at 2s/);
});

// Opacity multiplies down the tree but not across tweens: a dimmed wrapper that another tween also fades would end
// the focus window at 1 even before its own reveal. Wrappers must be left to focus.
test('focus refuses to dim a wrapper whose opacity another tween animates', () => {
  const kept = shape(1);
  const other = shape(0);
  const diagram = shape(1, [shape(1, [kept]), other]);
  assert.throws(() => motionScene({ '#diagram': diagram, '#kept': kept }, (tl, { motion }) => {
    motion.focus('#kept', 1, 3, { within: '#diagram' });
    tl.to(other, { opacity: 1, duration: .5 }, 4);
  }), /scene "library": focus dims a wrapper in "#diagram" whose opacity another tween animates; wrap it in a group of its own/);
});

test('a focus container that is missing fails naming it', () => {
  assert.throws(() => motionScene({}, (tl, { motion }) => motion.focus('#kept', 1, 2, { within: '#diagram' })), /scene "library": focus container "#diagram" not found/);
});
