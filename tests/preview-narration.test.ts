import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { addPreviewNarration, previewNarrationCues } from '../src/preview-narration.ts';
import type { Story, Timing } from '../src/types.ts';

const story: Story = {
  id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    { id: 'a', copy: { headline: 'A' }, narration: '{open} One two. {change} Three four.', hold: 2 },
    { id: 'b', copy: { headline: 'B' }, narration: 'Next sentence.', hold: 1 },
  ],
};
const timing: Timing = { source: 'estimate', duration: 14, scenes: {
  a: { start: 2, duration: 8, beats: { open: 0, change: 3 } },
  b: { start: 9, duration: 5, beats: {} },
} };

test('preview wording follows beat anchors, excludes markers and leaves the authored hold empty', () => {
  assert.deepEqual(previewNarrationCues(story, timing), [
    { start: 2, end: 5, text: 'One two.' },
    { start: 5, end: 8, text: 'Three four.' },
    { start: 9, end: 13, text: 'Next sentence.' },
  ]);
});

test('long narration is readable in short chunks without losing or duplicating words', () => {
  const narration = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const long: Story = { ...story, scenes: [{ id: 'a', copy: { headline: 'A' }, narration }] };
  const cues = previewNarrationCues(long, { ...timing, scenes: { a: { start: 0, duration: 20, beats: {} } } });
  assert.equal(cues.map(cue => cue.text).join(' '), narration);
  assert.ok(cues.every(cue => cue.text.length <= 84 && cue.end > cue.start));
  for (let i = 1; i < cues.length; i++) assert.equal(cues[i].start, cues[i - 1].end);
});


test('preview clips use the selected clock and treat script markup as text', () => {
  const { document } = parseHTML('<html><head></head><body><div data-composition-id="main"></div></body></html>');
  const escaped: Story = { ...story, scenes: [{ id: 'a', copy: { headline: 'A' }, narration: '<img src=x> words.' }] };
  addPreviewNarration(document, escaped, { ...timing, scenes: { a: { start: 2, duration: 4, beats: {} } } }, { start: 3, end: 5, duration: 2, compositionIds: new Set(['a']) });
  const clip = document.querySelector('[data-preview-narration] .clip')!;
  assert.equal(clip.getAttribute('data-start'), '0');
  assert.equal(clip.getAttribute('data-duration'), '2');
  assert.equal(clip.textContent, '<img src=x> words.');
  assert.equal(clip.querySelector('img'), null);
});
