import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { core } from './support/fixture.ts';

// Browsers load the committed runtime/scene.js, so it must be exactly what runtime/scene.ts compiles to.
test('the shipped scene runtime is the current build of its TypeScript source', { timeout: 60000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'explainery-runtime-'));
  await promisify(execFile)(join(core, 'node_modules/.bin/tsc'), ['-p', join(core, 'runtime'), '--outDir', out]);
  assert.equal(await readFile(join(core, 'runtime/scene.js'), 'utf8'), await readFile(join(out, 'scene.js'), 'utf8'), 'run pnpm build:runtime');
});
