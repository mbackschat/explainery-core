import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRenderProgress, formatRenderProgress } from '../src/render-progress.ts';

test('parses pinned machine events without treating weighted percent as frame progress', () => {
  assert.deepEqual(parseRenderProgress('@hf-progress {"code":"capture","done":24,"total":120,"pct":91}'), { stage: 'capture', done: 24, total: 120 });
  for (const line of ['ordinary output', '@hf-progress nope', '@hf-progress null', '@hf-progress {"pct":70}', '@hf-progress {"code":"capture","done":-1,"total":20}']) assert.equal(parseRenderProgress(line), undefined);
});
test('labels units and estimates only the active measurable stage', () => {
  assert.equal(formatRenderProgress({ stage: 'capture', done: 24, total: 120 }, { elapsedMs: 20000, stageElapsedMs: 10000 }), 'capture · 24/120 frames · elapsed 20s · stage ETA 40s');
  assert.equal(formatRenderProgress({ stage: 'compile' }, { elapsedMs: 3000 }), 'compile · elapsed 3s');
  assert.equal(formatRenderProgress({ stage: 'assemble', done: 3, total: 10 }, { elapsedMs: 10000 }), 'assemble · 3/10 seconds · elapsed 10s');
  assert.doesNotMatch(formatRenderProgress({ stage: 'capture', done: 0, total: 20 }, { elapsedMs: 1000, stageElapsedMs: 1000 }), /ETA|%/);
  assert.doesNotMatch(formatRenderProgress({ stage: 'capture', done: 20, total: 20 }, { elapsedMs: 1000, stageElapsedMs: 1000 }), /ETA|%/);
});
