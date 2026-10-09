import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { explainerPage, exportExplainer, exportExplainerFile, type Story, type Timing } from '../src/index.ts';
import { core, fixtureProject } from './support/fixture.ts';

const story: Story = {
  id: 'demo', title: 'Demo & Co', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    { id: 'library', copy: { category: 'SHARE', headline: 'Town Library', support: 'Publish once.' }, narration: 'Publish it {publish} and   pull it {pull}.' },
    { id: 'branches', copy: { headline: "It's <yours> & ours" }, narration: '{grow} Grow.' },
  ],
};
const timing: Timing = {
  source: 'imported', duration: 16,
  scenes: { library: { start: 0, duration: 8.9, beats: { publish: 2.45, pull: 4.5 } }, branches: { start: 8.2, duration: 7.8, beats: { grow: 2.2 } } },
};
const page = explainerPage(story, timing, { stylesheets: ['node_modules/explainery-core/themes/dark/theme.css', 'theme/brand.css'] });
const section = (id: string) => page.match(new RegExp(`<section class="explainer-scene" id="${id}">[\\s\\S]*?</section>`))![0];

test('the page loads the film stylesheets so it shares the film theme', () => {
  assert.match(page, /<title>Demo &amp; Co<\/title>/);
  assert.ok(page.indexOf('href="film/node_modules/explainery-core/themes/dark/theme.css"') < page.indexOf('href="film/theme/brand.css"'));
});

test('the whole film plays at the top with its audio', () => {
  assert.match(page, /<hyperframes-player class="explainer-film" src="film\/index.html" runtime-src="player\/hyperframe.runtime.js" controls><\/hyperframes-player>/);
});

test('each scene gets a silent player limited to its window and a scrubber over that window', () => {
  const branches = section('branches');
  assert.match(branches, /<hyperframes-player id="branches-player" class="explainer-stage-player" src="film\/index.html" runtime-src="player\/hyperframe.runtime.js" range-start="8.2" range-end="16" muted><\/hyperframes-player>/);
  // The scrubber counts whole frames, so a seek lands exactly on a frame instead of a rounded fraction of a second.
  assert.match(branches, /<input class="explainer-scrub" type="range" data-player="branches-player" data-fps="30" min="246" max="480" step="1" value="363">/);
});

test('scene copy and narration sit beside the player, escaped and without beat markers', () => {
  const library = section('library');
  assert.match(library, /<p class="explainer-category">SHARE<\/p>\s*<h2>Town Library<\/h2>\s*<p class="explainer-support">Publish once.<\/p>/);
  assert.match(library, /<p class="explainer-narration">Publish it and pull it.<\/p>/);
  const branches = section('branches');
  assert.match(branches, /<h2>It&#39;s &lt;yours&gt; &amp; ours<\/h2>/);
  assert.doesNotMatch(branches, /explainer-category|explainer-support/);
  assert.match(branches, /<p class="explainer-narration">Grow.<\/p>/);
});

test('export writes the page, the HyperFrames player, and the film as real files', async () => {
  const project = await fixtureProject('scene-runtime');
  const out = join(project, 'explainer');
  await exportExplainer(project, out);
  assert.match(await readFile(join(out, 'index.html'), 'utf8'), /<section class="explainer-scene" id="probe">/);
  for (const file of ['player/hyperframes-player.js', 'player/hyperframe.runtime.js', 'film/index.html', 'film/compositions/probe.html', 'film/node_modules/explainery-core/runtime/scene.js', 'film/node_modules/gsap/dist/gsap.min.js']) {
    assert.ok((await lstat(join(out, file))).isFile(), file);
  }
});

test('export refuses a project that does not validate', async () => {
  const project = await fixtureProject('scene-runtime');
  await writeFile(join(project, 'timing.json'), '{}');
  await assert.rejects(exportExplainer(project, join(project, 'explainer')), /timing\.json/);
});

test('export never replaces a folder that is not an earlier export', async () => {
  const project = await fixtureProject('scene-runtime');
  await assert.rejects(exportExplainer(project, project), /is not empty and is not an earlier explainer export/);
  assert.ok((await lstat(join(project, 'story.yaml'))).isFile(), 'the project survives');
  const out = join(project, 'explainer');
  await exportExplainer(project, out);
  await exportExplainer(project, out);
});

test('the export command writes the folder and reports what it shipped', async () => {
  const project = await fixtureProject('scene-runtime');
  const cli = join(core, 'bin/explainery.ts');
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'export', project, '--out', join(project, 'site')]);
  assert.match(stdout, /Exported 1 scene and 4 film files to .*site; serve it over http/);
  assert.ok((await lstat(join(project, 'site/index.html'))).isFile());
});

// A film that needs everything the single-file export must embed: a sprite symbol, audio over HyperFrames' 2 MB
// inline limit, and the framework files behind the node_modules/explainery-core symlink.
async function filmWithAssets(): Promise<string> {
  const project = await fixtureProject('scene-runtime', html => html.replace('<div id="probe"', [
    '<svg width="10" height="10"><use href="assets/sprite.svg#dot"/></svg>',
    '      <audio id="narration" src="assets/narration.wav" data-start="0" data-duration="2" data-track-index="2"></audio>',
    '      <div id="probe"',
  ].join('\n')));
  await mkdir(join(project, 'assets'));
  await writeFile(join(project, 'assets/sprite.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="dot" viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/></symbol></svg>');
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '36', join(project, 'assets/narration.wav')]);
  return project;
}

const embeddedFilm = (page: string) => JSON.parse(page.match(/^\s*const film = (".*");$/m)![1]) as string;

// Relative file references left in the film's markup and styles; inline script bodies are skipped, since their
// template strings are not references.
const fileReferences = (html: string) => [...html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').matchAll(/\s(?:src|href|poster|xlink:href)="([^"]*)"|url\(\s*["']?([^"')]*)/g)]
  .map(match => match[1] ?? match[2])
  .filter(ref => ref && !/^(?:data:|#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref));

test('the single-file export embeds the whole film once, with every file it needs inlined', async () => {
  const project = await filmWithAssets();
  const out = join(project, 'explainer.html');
  assert.deepEqual(await exportExplainerFile(project, out).then(({ scenes }) => scenes), 1);
  const page = await readFile(out, 'utf8');
  assert.equal(page.match(/const film = /g)?.length, 1, 'the film is embedded once');
  assert.doesNotMatch(page, /<hyperframes-player[^>]*\ssrc=/, 'no player loads a file');
  const tags = page.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/g, '$1</script>');
  assert.doesNotMatch(tags, /<(?:script|link)\b[^>]*\s(?:src|href)="(?!data:)/, 'the page loads no file');
  const film = embeddedFilm(page);
  assert.deepEqual(fileReferences(film), []);
  assert.match(film, /<symbol id="dot"/);
  assert.match(film, /<use href="#dot"/);
  assert.match(film, /src="data:audio\/mp4;base64,/);
  assert.match(film, /__hyperframes\s*=|hyperframe\.runtime\.iife\.js/, 'the HyperFrames runtime is inside, so the player fetches none');
  assert.match(film, /defineScene/, 'the framework runtime is inlined');
});

test('the single-file export refuses a reference it cannot embed', async () => {
  const project = await fixtureProject('scene-runtime', html => html.replace('<div id="probe"', '<img src="assets/missing.png">\n      <div id="probe"'));
  await assert.rejects(exportExplainerFile(project, join(project, 'explainer.html')), /assets\/missing\.png/);
});

test('the export command writes the single file next to the project by default', async () => {
  const project = await fixtureProject('scene-runtime');
  const cli = join(core, 'bin/explainery.ts');
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'export', project, '--single-file']);
  assert.match(stdout, /Exported 1 scene into .*explainer\.html \([0-9.]+ MB\); open it by double-click/);
  assert.ok((await lstat(join(project, 'explainer.html'))).isFile());
});
