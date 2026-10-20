import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { assembleIndex, checkStory, exportExplainer, exportExplainerFile, validateProject, type Story, type Timing } from '../src/index.ts';
import { fixtureProject } from './support/fixture.ts';

const story: Story = { id: 'theme-fixture', title: 'Theme fixture', theme: 'light', canvas: { width: 640, height: 360, fps: 30 }, scenes: [] };
const timing: Timing = { source: 'estimate', duration: 1, scenes: {} };
const link = '<link rel="stylesheet" data-story-theme href="node_modules/explainery-core/themes/dark/theme.css">';

test('assembly selects the story theme only on its managed stylesheet and preserves overlays', () => {
  const input = `${link}\n<link rel="stylesheet" href="theme/project.css">`;
  const selected = assembleIndex(input, story, timing);
  assert.deepEqual(selected.errors, []);
  assert.equal(selected.html, input.replace('/dark/', '/light/'));
  assert.equal(assembleIndex(selected.html, story, timing).html, selected.html);
  assert.equal(assembleIndex(input.replace(' data-story-theme', ''), story, timing).html, input.replace(' data-story-theme', ''));
});

test('assembly rejects duplicate or misplaced managed theme markers', () => {
  assert.match(assembleIndex(`${link}${link}`, story, timing).errors.join('\n'), /one.*data-story-theme/);
  assert.match(assembleIndex('<div data-story-theme></div>', story, timing).errors.join('\n'), /stylesheet/);
});

test('a film can explicitly select its own theme without shadowing a bundled name', async () => {
  const project = await fixtureProject('scene-runtime', html => html.replace('</head>', `${link}</head>`));
  const path = join(project, 'story.yaml');
  await writeFile(path, (await readFile(path, 'utf8')).replace('theme: dark', 'theme: ./themes/custom/theme.css'));
  assert.match((await validateProject(project)).errors.join('\n'), /themes\/custom\/theme.css/);
  await mkdir(join(project, 'themes/custom'), { recursive: true });
  await writeFile(join(project, 'themes/custom/theme.css'), '@import "../../node_modules/explainery-core/themes/light/theme.css"; :root { --accent: #123456; }');
  const validation = await validateProject(project);
  assert.ok(validation.valid);
  const input = await readFile(join(project, 'index.html'), 'utf8');
  assert.match(assembleIndex(input, validation.story, validation.timing).html, /href="themes\/custom\/theme.css"/);
  assert.match(assembleIndex(input, { ...validation.story, theme: 'light' }, validation.timing).html, /href="node_modules\/explainery-core\/themes\/light\/theme.css"/);
  for (const theme of ['../theme.css', './themes/../theme.css', 'https://example.com/theme.css']) {
    assert.notDeepEqual(checkStory({ ...validation.story, theme }), []);
  }
});

test('validation reports an unavailable managed theme and permits a stale href for assembly', async () => {
  const project = await fixtureProject('scene-runtime', html => html.replace('</head>', `${link}</head>`));
  const path = join(project, 'story.yaml');
  const original = await readFile(path, 'utf8');
  await writeFile(path, original.replace('theme: dark', 'theme: missing-theme'));
  assert.match((await validateProject(project)).errors.join('\n'), /missing-theme.*theme.css/);
  await writeFile(path, original.replace('theme: dark', 'theme: light'));
  assert.deepEqual((await validateProject(project)).errors, []);
});

test('both export formats reject a managed stylesheet that disagrees with the story', async () => {
  const project = await fixtureProject('scene-runtime', html => html.replace('</head>', `${link}</head>`));
  const path = join(project, 'story.yaml');
  await writeFile(path, (await readFile(path, 'utf8')).replace('theme: dark', 'theme: light'));
  for (const exportFilm of [exportExplainer, exportExplainerFile]) {
    await assert.rejects(exportFilm(project, join(project, 'export')), /theme.*stale.*assemble/i);
  }
});

test('full-film preview and render reject a stale theme before invoking HyperFrames', async () => {
  const project = await fixtureProject('scene-runtime', html => html.replace('</head>', `${link}</head>`));
  const path = join(project, 'story.yaml');
  await writeFile(path, (await readFile(path, 'utf8')).replace('theme: dark', 'theme: light'));
  const cli = new URL('../bin/explainery.ts', import.meta.url).pathname;
  for (const command of ['preview', 'render']) {
    await assert.rejects(promisify(execFile)(process.execPath, [cli, command, project, '--film'], { timeout: 10000 }), /theme is stale; run explainery assemble/);
  }
});

test('single-file export embeds nested CSS imports and their relative resources in the page and film', async () => {
  const project = await fixtureProject('scene-runtime', html => html.replace('</head>', '<link rel="stylesheet" href="theme/theme.css" media="print"></head>'));
  await mkdir(join(project, 'theme/nested'), { recursive: true });
  await writeFile(join(project, 'theme/theme.css'), '@import "nested/base.css"; :root { --outer-probe: 1; }');
  await writeFile(join(project, 'theme/nested/base.css'), '@import url("leaf.css"); .import-probe { background: url("mark.svg"); }');
  await writeFile(join(project, 'theme/nested/leaf.css'), ':root { --import-probe: 123; }');
  await writeFile(join(project, 'theme/nested/mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const output = join(project, 'export.html');
  const original = await readFile(join(project, 'index.html'), 'utf8');
  await exportExplainerFile(project, output);
  const html = await readFile(output, 'utf8');
  const film = JSON.parse(html.match(/\bconst film = ([^\n]+);/)![1]) as string;
  assert.ok(/<style media="print">/.test(film), 'stylesheet media conditions survive pre-bundling');
  assert.doesNotMatch(film, /\.explainery-export-/);
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /--import-probe: 123/);
  assert.match(head, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(head, /@import ["']/);
  await writeFile(join(project, 'theme/nested/leaf.css'), '@import "missing.css";');
  await assert.rejects(exportExplainerFile(project, output), /missing.css/);
  assert.equal(await readFile(join(project, 'index.html'), 'utf8'), original);
  assert.deepEqual((await readdir(project)).filter(file => file.startsWith('.explainery-export-')), []);
});

test('folder and single-file exports resolve stylesheet URLs as decoded paths without query strings or fragments', async t => {
  const cases = [
    { name: 'import query and fragment', href: 'theme/theme.css', entry: 'theme.css', imported: 'base.css?v=1#palette', file: 'base.css' },
    { name: 'encoded import path', href: 'theme/theme.css', entry: 'theme.css', imported: 'base%20styles.css', file: 'base styles.css' },
    { name: 'stylesheet link query and fragment', href: 'theme/theme.css?v=1#palette', entry: 'theme.css', imported: 'base.css', file: 'base.css' },
    { name: 'encoded stylesheet link', href: 'theme/theme%20sheet.css', entry: 'theme sheet.css', imported: 'base.css', file: 'base.css' },
  ];
  for (const { name, href, entry, imported, file } of cases) {
    await t.test(name, async () => {
      const project = await fixtureProject('scene-runtime', html => html.replace('</head>', `<link rel="stylesheet" href="${href}"></head>`));
      await mkdir(join(project, 'theme'));
      const palette = ':root { --url-probe: #123456; }';
      await writeFile(join(project, 'theme', file), palette);
      await writeFile(join(project, 'theme', entry), `@import "${imported}"; .url-probe { mask: url("mark%20shape.svg?v=2#part"); }`);
      await writeFile(join(project, 'theme/mark shape.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="part"/></svg>');
      await exportExplainer(project, join(project, 'folder'));
      assert.equal(await readFile(join(project, 'folder/film/theme', file), 'utf8'), palette);
      const output = join(project, 'single.html');
      await exportExplainerFile(project, output);
      const html = await readFile(output, 'utf8');
      const film = JSON.parse(html.match(/\bconst film = ([^\n]+);/)![1]) as string;
      assert.ok(film.includes(palette), 'the embedded film contains the imported palette');
      assert.ok(html.slice(0, html.indexOf('</head>')).includes(palette), 'the outer page contains the imported palette');
      assert.match(film, /data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+#part/);
    });
  }
});
