import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

// Chrome parses an SVG loaded through <use href>, <image>, or CSS url() as strict XML and silently draws nothing
// when it is malformed; a "--" inside an XML comment was enough to blank the cube sprite (reproduced 2026-10-08).
const root = fileURLToPath(new URL('../', import.meta.url));

async function svgFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : svgFiles(path);
    return entry.name.endsWith('.svg') ? [path] : [];
  }));
  return nested.flat();
}

test('every shipped SVG is well-formed XML', async () => {
  const files = await svgFiles(root);
  assert.ok(files.length > 0);
  await promisify(execFile)('xmllint', ['--noout', ...files]).catch((error: { stderr: string }) => assert.fail(error.stderr));
});
