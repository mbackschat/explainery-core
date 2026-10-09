import assert from 'node:assert/strict';
import test from 'node:test';
import { checkStory, checkTiming, type Copy, type Scene, type Story, type Timing } from '../src/index.ts';

const story = (): Story => ({
  id: 'demo',
  title: 'Demo',
  theme: 'dark',
  canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    {
      id: 'intro',
      copy: { category: 'START', headline: 'Hello', support: 'A first scene.' },
      narration: 'Say hello {wave} and goodbye.',
      hold: 0.5,
      overlap: 0.3,
    },
  ],
});

const timing = (): Timing => ({
  source: 'estimate',
  duration: 4,
  scenes: { intro: { start: 0, duration: 4, beats: { wave: 0.8 } } },
});

test('a complete story and timing pass their schemas', () => {
  assert.deepEqual(checkStory(story()), []);
  assert.deepEqual(checkTiming(timing()), []);
});

test('a scene without a headline is reported at its path', () => {
  const value = story();
  delete (value.scenes[0].copy as Partial<Copy>).headline;
  assert.deepEqual(checkStory(value), ["/scenes/0/copy: must have required property 'headline'"]);
});

test('a misspelt story key is rejected instead of ignored', () => {
  const value = story();
  (value.scenes[0] as Scene & { hlod: number }).hlod = 1;
  assert.deepEqual(checkStory(value), ['/scenes/0: must NOT have additional property "hlod"']);
});

test('scene ids must be kebab-case because they name composition files', () => {
  const value = story();
  value.scenes[0].id = 'Intro Scene';
  assert.equal(checkStory(value).length, 1);
  assert.match(checkStory(value)[0], /^\/scenes\/0\/id: must match pattern/);
});

test('timing rejects an unknown source and a negative beat', () => {
  const value = timing();
  (value as { source: string }).source = 'guessed';
  value.scenes.intro.beats.wave = -1;
  assert.deepEqual(checkTiming(value), [
    '/source: must be equal to one of the allowed values (estimate, aligned, imported)',
    '/scenes/intro/beats/wave: must be >= 0',
  ]);
});

test('pronunciations map written words to non-empty spellings for the draft voice', () => {
  assert.deepEqual(checkStory({ ...story(), pronunciations: { SPI: 'S-P-I' } }), []);
  assert.notDeepEqual(checkStory({ ...story(), pronunciations: { SPI: '' } }), []);
});

test('an audio length is recorded only together with its audio', () => {
  assert.deepEqual(checkTiming({ ...timing(), audio: 'assets/narration.wav', audioDuration: 3.5 }), []);
  assert.notDeepEqual(checkTiming({ ...timing(), audioDuration: 3.5 }), []);
  assert.notDeepEqual(checkTiming({ ...timing(), audio: 'assets/narration.wav', audioDuration: 0 }), []);
});
