import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const delivery = '<!doctype html><title>Film</title><p>Selected delivery</p>';
const digest = createHash('sha256').update(delivery).digest('hex');

async function prepare(t: test.TestContext, sha256: string, repositoryPrivate = 'false') {
  const cwd = await mkdtemp(join(tmpdir(), 'explainery-pages-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const bin = join(cwd, 'bin');
  await mkdir(bin);
  await writeFile(join(cwd, 'delivery.html'), delivery);
  await writeFile(join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$@" > gh-args\ncp delivery.html site/film.html\n', { mode: 0o755 });
  const workflow = parse(await readFile(new URL('../.github/workflows/publish-film.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.prepare.steps.find((step: { id?: string }) => step.id === 'delivery');
  await writeFile(join(cwd, 'prepare.sh'), step.run);
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', 'prepare.sh'], {
    cwd, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_REPO: 'owner/story', RELEASE_TAG: 'film-v1', EXPECTED_SHA256: sha256, REPOSITORY_PRIVATE: repositoryPrivate },
  });
  return { cwd, result };
}

test('Pages publishes only the selected release HTML, preserving its exact bytes', async t => {
  const { cwd, result } = await prepare(t, digest);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(join(cwd, 'site')), ['index.html']);
  assert.equal(await readFile(join(cwd, 'site/index.html'), 'utf8'), delivery);
  assert.deepEqual((await readFile(join(cwd, 'gh-args'), 'utf8')).trim().split('\n'), [
    'release', 'download', '--repo', 'owner/story', '--pattern', 'film.html', '--dir', 'site', '--', 'film-v1',
  ]);
});

test('Pages refuses an attachment whose bytes differ from the selected delivery', async t => {
  const { cwd, result } = await prepare(t, '0'.repeat(64));
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(join(cwd, 'site/index.html')), { code: 'ENOENT' });
});

test('Pages requires a SHA-256 before downloading an attachment', async t => {
  const { cwd, result } = await prepare(t, '');
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(join(cwd, 'gh-args')), { code: 'ENOENT' });
});

for (const visibility of ['true', '']) {
  test(`Pages refuses private or unknown repository visibility (${JSON.stringify(visibility)}) before downloading the film`, async t => {
    const { cwd, result } = await prepare(t, digest, visibility);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Private films require access-controlled hosting/);
    await assert.rejects(readFile(join(cwd, 'gh-args')), { code: 'ENOENT' });
  });
}
