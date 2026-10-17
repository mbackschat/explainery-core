import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { filmFiles } from '../src/index.ts';

async function project(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-film-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const files: Record<string, string> = {
  'index.html': `<html><head>
    <script src="node_modules/gsap/dist/gsap.min.js"></script>
    <link rel="stylesheet" href="node_modules/theme/theme.css">
    <script src="https://cdn.example.com/lib.js"></script>
  </head><body>
    <div data-composition-src="compositions/scene.html"></div>
    <img src="assets/logo.png?v=2"><a href="#top">top</a>
    <audio src="assets/narration.wav"></audio>
  </body></html>`,
  'compositions/scene.html': `<template><svg>
    <use href="node_modules/theme/sprite.svg#cube" /><image href="assets/art.svg" />
    <image href="data:image/png;base64,AAAA" />
  </svg></template>`,
  'node_modules/gsap/dist/gsap.min.js': '',
  'node_modules/theme/theme.css': `@import 'base.css'; .a { background: url('texture.svg'); } .b { background: url(data:image/png;base64,AAAA); }`,
  'node_modules/theme/base.css': `@font-face { src: url("fonts/a.ttf"); }`,
  'node_modules/theme/fonts/a.ttf': '',
  'node_modules/theme/texture.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'node_modules/theme/sprite.svg': '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="cube"/></svg>',
  'assets/logo.png': '',
  'assets/narration.wav': '',
  'assets/art.svg': '<svg xmlns="http://www.w3.org/2000/svg"><image href="detail.png"/></svg>',
  'assets/detail.png': '',
  'assets/unused.png': '',
};

test('the film is every file its root composition reaches, resolved the way the browser resolves it', async () => {
  // Composition files mount into index.html, so their URLs resolve from the project root; CSS and SVG files
  // resolve their own references relative to themselves.
  assert.deepEqual(await filmFiles(await project(files)), [
    'assets/art.svg',
    'assets/detail.png',
    'assets/logo.png',
    'assets/narration.wav',
    'compositions/scene.html',
    'index.html',
    'node_modules/gsap/dist/gsap.min.js',
    'node_modules/theme/base.css',
    'node_modules/theme/fonts/a.ttf',
    'node_modules/theme/sprite.svg',
    'node_modules/theme/texture.svg',
    'node_modules/theme/theme.css',
  ]);
});

test('a reference to a missing file fails, naming the file that refers to it', async () => {
  const broken = { ...files };
  delete broken['node_modules/theme/fonts/a.ttf'];
  await assert.rejects(filmFiles(await project(broken)), /node_modules\/theme\/fonts\/a\.ttf \(referenced by node_modules\/theme\/base\.css\)/);
});

test('commented markup does not create runtime file dependencies', async () => {
  const html = files['index.html'].replace('</body>', '<!-- <img src="assets/comment-example.png"><div data-composition-src="comment-scene.html"></div> --></body>');
  assert.deepEqual(await filmFiles(await project({ ...files, 'index.html': html })), await filmFiles(await project(files)));
});

test('inline script strings do not create runtime file dependencies', async () => {
  const html = files['index.html'].replace('</head>', `<script>const example = '<img src="assets/script-example.png">'; const scene = '<div data-composition-src="script-scene.html"></div>';</script></head>`);
  assert.deepEqual(await filmFiles(await project({ ...files, 'index.html': html })), await filmFiles(await project(files)));
});

test('real attributes inside nested templates and SVG remain dependencies', async () => {
  const additions = {
    'compositions/scene.html': `<template><template><svg><use xlink:href="assets/nested.svg#shape"/><image href="assets/a&amp;b.svg"/></svg><img src=assets/unquoted.png></template></template>`,
    'assets/nested.svg': '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="detail.svg#shape"/></svg>',
    'assets/detail.svg': '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="shape"/></svg>',
    'assets/a&b.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'assets/unquoted.png': '',
  };
  const found = await filmFiles(await project({ ...files, ...additions }));
  for (const file of ['assets/nested.svg', 'assets/detail.svg', 'assets/a&b.svg', 'assets/unquoted.png']) assert.ok(found.includes(file), `${file} is a real authored reference`);
});

test('inline styles and style elements retain HTML-root and SVG-local dependencies', async () => {
  const dir = await project({
    'index.html': '<style>@import "theme/base.css"; .hero { background: url(assets/bg.png); }</style><div data-composition-src="compositions/scene.html"></div><img src="assets/icon.svg">',
    'compositions/scene.html': '<template><div style="background: url(&quot;assets/card.png&quot;)"></div></template>',
    'theme/base.css': '',
    'assets/bg.png': '',
    'assets/card.png': '',
    'assets/icon.svg': '<svg><style>.a { fill: url(palette.svg#paint); }</style><rect style="filter: url(filters.svg#blur)"/></svg>',
    'assets/palette.svg': '<svg/>',
    'assets/filters.svg': '<svg/>',
  });
  assert.deepEqual(await filmFiles(dir), ['assets/bg.png', 'assets/card.png', 'assets/filters.svg', 'assets/icon.svg', 'assets/palette.svg', 'compositions/scene.html', 'index.html', 'theme/base.css']);
});

test('static script imports and re-exports form a local dependency closure', async () => {
  const dir = await project({
    'index.html': '<script type="module">import { run } from "./scripts/main.mjs"; run();</script>',
    'scripts/main.mjs': 'import "./side.js"; export { value } from "./lib/value.js"; export * from "./lib/more.mjs";',
    'scripts/side.js': 'import "./main.mjs";',
    'scripts/lib/value.js': 'export const value = 1;',
    'scripts/lib/more.mjs': 'export const more = 2;',
  });
  assert.deepEqual(await filmFiles(dir, { strict: true }), ['index.html', 'scripts/lib/more.mjs', 'scripts/lib/value.js', 'scripts/main.mjs', 'scripts/side.js']);
});

test('strict dependency collection rejects external resources but permits data and fragment references', async () => {
  for (const html of ['<img src="https://example.com/a.png">', '<style>.x { background: url(//example.com/bg.png); }</style>', '<div style="background:url(https://example.com/a.png)"></div>', '<script type="module">import "https://example.com/a.js";</script>']) {
    const dir = await project({ 'index.html': html });
    assert.deepEqual(await filmFiles(dir), ['index.html']);
    await assert.rejects(filmFiles(dir, { strict: true }), /unsupported reusable dependency.*example.com.*index.html/i);
  }
  assert.deepEqual(await filmFiles(await project({ 'index.html': '<img src="data:image/png;base64,AAAA"><style>.shape { filter: url(#blur); }</style><svg><use href="#shape"/></svg>' }), { strict: true }), ['index.html']);
});

test('strict dependency collection refuses runtime loading and unsupported module specifiers', async () => {
  for (const source of ['fetch("data.json")', 'globalThis.fetch("data.json")', 'new XMLHttpRequest()', 'import("./lazy.js")', 'import thing from "bare-package"', 'const thing = require("./legacy.js")']) {
    const dir = await project({ 'index.html': '<script src="scripts/main.js"></script>', 'scripts/main.js': source });
    await assert.rejects(filmFiles(dir, { strict: true }), /unsupported reusable dependency.*scripts\/main.js/i);
  }
});

test('script comments, strings and regex examples do not create imports or runtime loading', async () => {
  const dir = await project({
    'index.html': `<style>/* url(missing.png) */ .a::after { content: 'url(missing.png)'; }</style>
      <script type="module">
        // import "./missing.js"; fetch("missing.json")
        /* new XMLHttpRequest(); import('./missing.js') */
        const example = 'fetch("missing.json") <img src="missing.png">';
        const pattern = /fetch\\("missing"\\)/;
        const template = \`import('./missing.js')\`;
      </script>`,
  });
  assert.deepEqual(await filmFiles(dir, { strict: true }), ['index.html']);
});

test('runtime loading inside template expressions remains executable', async () => {
  const dir = await project({ 'index.html': '<script>const value = `result: ${fetch("data.json")}`;</script>' });
  await assert.rejects(filmFiles(dir, { strict: true }), /unsupported reusable dependency.*fetch/i);
});

test('video posters and embedded object files belong to the reusable dependency closure', async () => {
  const dir = await project({
    'index.html': '<video poster="assets/poster.png"></video><object data="assets/chart.svg"></object>',
    'assets/poster.png': '',
    'assets/chart.svg': '<svg><image href="detail.png"/></svg>',
    'assets/detail.png': '',
  });
  const expected = ['assets/chart.svg', 'assets/detail.png', 'assets/poster.png', 'index.html'];
  assert.deepEqual(await filmFiles(dir), expected);
  assert.deepEqual(await filmFiles(dir, { strict: true }), expected);
});

test('strict collection rejects responsive image choices with fixed-src guidance', async () => {
  for (const markup of ['<img srcset="small.png 1x, large.png 2x">', '<picture><source srcset="small.png 400w, large.png 800w"></picture>']) {
    const dir = await project({ 'index.html': markup });
    assert.deepEqual(await filmFiles(dir), ['index.html']);
    await assert.rejects(filmFiles(dir, { strict: true }), /unsupported reusable dependency:.*srcset.*fixed src.*index.html/i);
  }
});

test('strict collection rejects embedded iframe markup with composition guidance', async () => {
  const dir = await project({ 'index.html': '<iframe srcdoc="&lt;img src=&quot;missing.png&quot;&gt;"></iframe>' });
  assert.deepEqual(await filmFiles(dir), ['index.html']);
  await assert.rejects(filmFiles(dir, { strict: true }), /unsupported reusable dependency:.*iframe srcdoc.*composition.*index.html/i);
});

test('SVG presentation attributes retain external paint, filter, clip, mask and marker resources', async () => {
  const references = { fill: 'paint', stroke: 'stroke', filter: 'filter', 'clip-path': 'clip', mask: 'mask', 'marker-start': 'start', 'marker-mid': 'mid', 'marker-end': 'end' };
  const attributes = Object.entries(references).map(([name, file]) => `${name}="url(${file}.svg#part)"`).join(' ');
  const dir = await project({
    'index.html': '<img src="assets/diagram.svg">',
    'assets/diagram.svg': `<svg xmlns="http://www.w3.org/2000/svg"><path ${attributes}/></svg>`,
    ...Object.fromEntries(Object.values(references).map(file => [`assets/${file}.svg`, '<svg/>'])),
  });
  assert.deepEqual(await filmFiles(dir, { strict: true }), ['index.html', 'assets/diagram.svg', ...Object.values(references).map(file => `assets/${file}.svg`)].sort());
});

test('strict collection rejects standalone HTML documents with different URL bases', async () => {
  for (const [markup, path] of [
    ['<iframe src="documents/panel.html"></iframe>', 'documents/panel.html'],
    ['<object data="documents/panel.html"></object>', 'documents/panel.html'],
    ['<object data="documents/panel" type="text/html"></object>', 'documents/panel'],
  ]) {
    const dir = await project({ 'index.html': markup, [path]: '<p>Embedded document</p>' });
    assert.deepEqual(await filmFiles(dir), [path, 'index.html']);
    await assert.rejects(filmFiles(dir, { strict: true }), /unsupported reusable dependency:.*standalone.*HTML.*composition.*index.html/i);
  }
});
