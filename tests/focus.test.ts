import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clearFocus, readFocus, resolveScene, writeFocus } from '../src/focus.ts';
import type { Story } from '../src/types.ts';

const story: Story = {
  id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 24 },
  scenes: [
    { id: 'chapter', title: 'The chapter', compositions: [{ id: 'part', copy: { headline: 'Part' }, narration: 'Part.' }] },
    { id: 'final', copy: { headline: 'Final thought' }, narration: 'Final.' },
  ],
};

async function project(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-focus-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'story.yaml'), JSON.stringify(story));
  return dir;
}

test('focus resolves exact IDs and case-insensitive editorial titles, including legacy headlines', () => {
  assert.equal(resolveScene(story, 'chapter').id, 'chapter');
  assert.equal(resolveScene(story, 'THE CHAPTER').id, 'chapter');
  assert.equal(resolveScene(story, 'final thought').id, 'final');
  assert.throws(() => resolveScene(story, 'part'), /unknown scene/i);
  assert.throws(() => resolveScene(story, 'chap'), /unknown scene/i);
  const ambiguous: Story = { ...story, scenes: [...story.scenes, { id: 'another', title: 'the chapter', compositions: [{ id: 'other', copy: { headline: 'Other' }, narration: '' }] }] };
  assert.throws(() => resolveScene(ambiguous, 'THE CHAPTER'), /ambiguous.*chapter.*another/i);
  assert.equal(resolveScene(ambiguous, 'chapter').id, 'chapter');
});

test('focus persists only a resolved scene ID and clears without changing authored story files', async t => {
  const dir = await project(t);
  const original = await readFile(join(dir, 'story.yaml'), 'utf8');
  assert.equal(await readFocus(dir, story), undefined);
  assert.equal((await writeFocus(dir, story, 'The chapter')).id, 'chapter');
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.explainery/focus.json'), 'utf8')), { sceneId: 'chapter' });
  assert.equal((await readFocus(dir, story))?.id, 'chapter');
  await clearFocus(dir);
  await clearFocus(dir);
  assert.equal(await readFocus(dir, story), undefined);
  assert.equal(await readFile(join(dir, 'story.yaml'), 'utf8'), original);
});

test('stale and malformed focus state fail loudly instead of selecting the full film', async t => {
  const dir = await project(t);
  await writeFocus(dir, story, 'chapter');
  const changed: Story = { ...story, scenes: [story.scenes[1]] };
  await assert.rejects(readFocus(dir, changed), /stale.*chapter/i);
  const file = join(dir, '.explainery/focus.json');
  for (const value of ['not json', '{}', '{"sceneId":1}', '{"sceneId":""}']) {
    await writeFile(file, value);
    await assert.rejects(readFocus(dir, story), /invalid focus/i);
  }
  const missing = await project(t);
  await mkdir(join(missing, '.explainery'));
  assert.equal(await readFocus(missing, story), undefined);
});
