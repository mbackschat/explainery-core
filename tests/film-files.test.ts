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
