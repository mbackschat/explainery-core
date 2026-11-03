import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseReferenceArgs } from '../.agents/skills/analyze-source-film/scripts/extract-reference.ts';

async function withSuccessfulTools(check: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'source-reference-'));
  try {
    const bin = join(root, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'ffprobe'), `#!${process.execPath}\nconsole.log(JSON.stringify({ streams: [], format: {} }));\n`, { mode: 0o755 });
    await writeFile(join(bin, 'ffmpeg'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.argv.at(-1), 'new frame');\n`, { mode: 0o755 });
    await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runReference(root: string, video: string, subtitles: string, out: string) {
  return spawnSync(process.execPath, [fileURLToPath(new URL('../.agents/skills/analyze-source-film/scripts/extract-reference.ts', import.meta.url)), '--video', video, '--subtitles', subtitles, '--out', out, '--at', '0'], {
    cwd: root,
    env: { ...process.env, PATH: join(root, 'bin') },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('requires explicit source paths, output directory, and sample seconds', () => {
  assert.deepEqual(parseReferenceArgs(['--video', 'source.mp4', '--subtitles', 'source.srt', '--out', 'reference', '--at', '0, 1.25,306']), {
    video: 'source.mp4', subtitles: 'source.srt', out: 'reference', at: [0, 1.25, 306],
  });
  for (const flag of ['--video', '--subtitles', '--out', '--at']) {
    const args = ['--video', 'source.mp4', '--subtitles', 'source.srt', '--out', 'reference', '--at', '0'];
    args.splice(args.indexOf(flag), 2);
    assert.throws(() => parseReferenceArgs(args), /required/i);
  }
});

test('rejects invalid sample seconds and ambiguous command arguments', () => {
  const args = ['--video', 'source.mp4', '--subtitles', 'source.srt', '--out', 'reference'];
  for (const at of ['', '-1', 'NaN', 'Infinity', '1e309', '0,,1', '1, ']) {
    assert.throws(() => parseReferenceArgs([...args, '--at', at]), /seconds|value/i, at);
  }
  assert.throws(() => parseReferenceArgs([...args, '--at', '1', '--at', '2']), /duplicate/i);
  assert.throws(() => parseReferenceArgs([...args, '--at', '1', '--unknown', '2']), /unknown/i);
  assert.throws(() => parseReferenceArgs([...args, '--at']), /value/i);
});

test('propagates a frame extractor failure without claiming a completed frame index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-reference-'));
  try {
    const bin = join(root, 'bin');
    const out = join(root, 'reference');
    await mkdir(bin);
    await writeFile(join(root, 'source.mp4'), 'source bytes');
    await writeFile(join(root, 'source.srt'), '1\n00:00:00,000 --> 00:00:01,000\nText\n');
    await writeFile(join(bin, 'ffprobe'), `#!${process.execPath}\nconsole.log(JSON.stringify({ streams: [], format: {} }));\n`, { mode: 0o755 });
    await writeFile(join(bin, 'ffmpeg'), `#!${process.execPath}\nconsole.error('fixture frame extraction failed');\nprocess.exit(7);\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../.agents/skills/analyze-source-film/scripts/extract-reference.ts', import.meta.url)), '--video', 'source.mp4', '--subtitles', 'source.srt', '--out', out, '--at', '0'], {
      cwd: root,
      env: { ...process.env, PATH: bin },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fixture frame extraction failed/);
    await assert.rejects(stat(join(out, 'frame-index.json')), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, 'source.mp4'), 'utf8'), 'source bytes');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects successful ffmpeg runs with missing or empty output despite stale evidence', async () => {
  for (const body of ['', "require('node:fs').writeFileSync(process.argv.at(-1), '');"]) {
    const root = await mkdtemp(join(tmpdir(), 'source-reference-'));
    try {
      const bin = join(root, 'bin');
      const out = join(root, 'reference');
      await mkdir(bin);
      await mkdir(join(out, 'frames'), { recursive: true });
      await writeFile(join(root, 'source.mp4'), 'source bytes');
      await writeFile(join(root, 'source.srt'), '1\n00:00:00,000 --> 00:00:01,000\nText\n');
      await writeFile(join(bin, 'ffprobe'), `#!${process.execPath}\nconsole.log(JSON.stringify({ streams: [], format: {} }));\n`, { mode: 0o755 });
      await writeFile(join(bin, 'ffmpeg'), `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
      await writeFile(join(out, 'frames/source-000.jpg'), 'stale frame');
      await writeFile(join(out, 'frame-index.json'), '[{"second":0,"path":"frames/source-000.jpg"}]');
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../.agents/skills/analyze-source-film/scripts/extract-reference.ts', import.meta.url)), '--video', 'source.mp4', '--subtitles', 'source.srt', '--out', out, '--at', '0'], {
        cwd: root,
        env: { ...process.env, PATH: bin },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0, `ffmpeg body: ${body || '(no output)'}`);
      await assert.rejects(stat(join(out, 'frame-index.json')), { code: 'ENOENT' });
      assert.equal(await readFile(join(out, 'frames/source-000.jpg'), 'utf8'), 'stale frame');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('rejects source inputs nested inside a symlinked output directory before changing originals', async () => {
  for (const input of ['video', 'subtitles']) {
    const root = await mkdtemp(join(tmpdir(), 'source-reference-'));
    try {
      const out = join(root, 'reference');
      const inputs = join(out, 'inputs');
      await mkdir(inputs, { recursive: true });
      await symlink(out, join(root, 'output-alias'), 'dir');
      const video = input === 'video' ? join(inputs, 'source-metadata.json') : join(root, 'source.mp4');
      const subtitles = input === 'subtitles' ? join(inputs, 'transcript.txt') : join(root, 'source.srt');
      const srt = '1\n00:00:00,000 --> 00:00:01,000\nOriginal text\n';
      await writeFile(video, 'original video bytes');
      await writeFile(subtitles, srt);
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../.agents/skills/analyze-source-film/scripts/extract-reference.ts', import.meta.url)), '--video', video, '--subtitles', subtitles, '--out', join(root, 'output-alias'), '--at', '0'], {
        cwd: root,
        env: { ...process.env, PATH: '' },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /source.*output directory/i);
      assert.equal(await readFile(video, 'utf8'), 'original video bytes');
      assert.equal(await readFile(subtitles, 'utf8'), srt);
      await assert.rejects(stat(join(out, 'narration-cues.json')), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('promotes a newly produced nonempty frame and indexes it after successful extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-reference-'));
  try {
    const bin = join(root, 'bin');
    const out = join(root, 'new/nested/reference');
    await mkdir(bin);
    await writeFile(join(root, 'source.mp4'), 'source bytes');
    await writeFile(join(root, 'source.srt'), '1\n00:00:00,000 --> 00:00:01,000\nText\n');
    await writeFile(join(bin, 'ffprobe'), `#!${process.execPath}\nconsole.log(JSON.stringify({ streams: [], format: {} }));\n`, { mode: 0o755 });
    await writeFile(join(bin, 'ffmpeg'), `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args.indexOf('-ss') > args.indexOf('-i')) process.exit(9);\nrequire('node:fs').writeFileSync(args.at(-1), 'new frame');\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../.agents/skills/analyze-source-film/scripts/extract-reference.ts', import.meta.url)), '--video', 'source.mp4', '--subtitles', 'source.srt', '--out', out, '--at', '0'], {
      cwd: root,
      env: { ...process.env, PATH: bin },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const path = join(out, 'frames/source-000.jpg');
    assert.equal(await readFile(path, 'utf8'), 'new frame');
    assert.deepEqual(JSON.parse(await readFile(join(out, 'frame-index.json'), 'utf8')), [{ second: 0, path }]);
    assert.deepEqual(await readdir(join(out, 'frames')), ['source-000.jpg']);
    assert.equal(await readFile(join(root, 'source.mp4'), 'utf8'), 'source bytes');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('replaces redirected derived files without changing original source bytes', async () => {
  await withSuccessfulTools(async root => {
    const out = join(root, 'reference');
    const video = join(root, 'source.mp4');
    const subtitles = join(root, 'source.srt');
    const srt = '001\n00:00:00,000 --> 00:00:01,000\nOriginal text\n';
    const outputs = ['source-metadata.json', 'source-sha256.json', 'narration-cues.json', 'transcript.txt', 'frame-index.json'];
    await mkdir(out);
    await writeFile(video, 'original video bytes');
    await writeFile(subtitles, srt);
    for (const output of outputs) await symlink(subtitles, join(out, output));
    const result = runReference(root, video, subtitles, out);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(video, 'utf8'), 'original video bytes');
    assert.equal(await readFile(subtitles, 'utf8'), srt);
    for (const output of outputs) assert.equal((await lstat(join(out, output))).isSymbolicLink(), false);
    assert.equal(await readFile(join(out, 'transcript.txt'), 'utf8'), '001. 00:00:00,000 --> 00:00:01,000\nOriginal text\n');
    for (const output of outputs.filter(output => output.endsWith('.json'))) {
      JSON.parse(await readFile(join(out, output), 'utf8'));
    }
  });
});

test('rejects a redirected frames directory before promoting frames outside the output', async () => {
  await withSuccessfulTools(async root => {
    const out = join(root, 'reference');
    const external = join(root, 'external');
    await mkdir(out);
    await mkdir(external);
    await writeFile(join(external, 'sentinel'), 'existing evidence');
    await symlink(external, join(out, 'frames'), 'dir');
    await writeFile(join(root, 'source.mp4'), 'original video bytes');
    await writeFile(join(root, 'source.srt'), '1\n00:00:00,000 --> 00:00:01,000\nOriginal text\n');
    const result = runReference(root, 'source.mp4', 'source.srt', out);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /frames.*(symbolic link|symlink)/i);
    assert.deepEqual(await readdir(external), ['sentinel']);
    await assert.rejects(stat(join(out, 'frame-index.json')), { code: 'ENOENT' });
  });
});

test('records both source hashes when the source basenames coincide', async () => {
  await withSuccessfulTools(async root => {
    await mkdir(join(root, 'video'));
    await mkdir(join(root, 'subtitles'));
    const srt = '1\n00:00:00,000 --> 00:00:01,000\nOriginal text\n';
    await writeFile(join(root, 'video/source'), 'original video bytes');
    await writeFile(join(root, 'subtitles/source'), srt);
    const out = join(root, 'reference');
    const result = runReference(root, 'video/source', 'subtitles/source', out);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(out, 'source-sha256.json'), 'utf8')), {
      'video/source': createHash('sha256').update('original video bytes').digest('hex'),
      'subtitles/source': createHash('sha256').update(srt).digest('hex'),
    });
  });
});
