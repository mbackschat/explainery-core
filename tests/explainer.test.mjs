import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { explainerPage, exportExplainer } from '../src/index.mjs';
import { core, fixtureProject } from './support/fixture.mjs';

const story = {
  id: 'demo', title: 'Demo & Co', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 },
  scenes: [
    { id: 'registry', copy: { category: 'SHARE', headline: 'Team Registry', support: 'Publish once.' }, narration: 'Publish it {publish} and   pull it {pull}.' },
    { id: 'scopes', copy: { headline: "It's <yours> & ours" }, narration: '{grow} Grow.' },
  ],
};
const timing = {
  source: 'imported', duration: 16,
  scenes: { registry: { start: 0, duration: 8.9, beats: { publish: 2.45, pull: 4.5 } }, scopes: { start: 8.2, duration: 7.8, beats: { grow: 2.2 } } },
};
const page = explainerPage(story, timing, { stylesheets: ['node_modules/explainery-core/themes/dark/theme.css', 'theme/brand.css'] });
const section = id => page.match(new RegExp(`<section class="explainer-scene" id="${id}">[\\s\\S]*?</section>`))[0];

test('the page loads the film stylesheets so it shares the film theme', () => {
  assert.match(page, /<title>Demo &amp; Co<\/title>/);
  assert.ok(page.indexOf('href="film/node_modules/explainery-core/themes/dark/theme.css"') < page.indexOf('href="film/theme/brand.css"'));
});

test('the whole film plays at the top with its audio', () => {
  assert.match(page, /<hyperframes-player class="explainer-film" src="film\/index.html" runtime-src="player\/hyperframe.runtime.js" controls><\/hyperframes-player>/);
});

test('each scene gets a silent player limited to its window and a scrubber over that window', () => {
  const scopes = section('scopes');
  assert.match(scopes, /<hyperframes-player id="scopes-player" class="explainer-stage-player" src="film\/index.html" runtime-src="player\/hyperframe.runtime.js" range-start="8.2" range-end="16" muted><\/hyperframes-player>/);
  // The scrubber counts whole frames, so a seek lands exactly on a frame instead of a rounded fraction of a second.
  assert.match(scopes, /<input class="explainer-scrub" type="range" data-player="scopes-player" data-fps="30" min="246" max="480" step="1" value="363">/);
});

test('scene copy and narration sit beside the player, escaped and without beat markers', () => {
  const registry = section('registry');
  assert.match(registry, /<p class="explainer-category">SHARE<\/p>\s*<h2>Team Registry<\/h2>\s*<p class="explainer-support">Publish once.<\/p>/);
  assert.match(registry, /<p class="explainer-narration">Publish it and pull it.<\/p>/);
  const scopes = section('scopes');
  assert.match(scopes, /<h2>It&#39;s &lt;yours&gt; &amp; ours<\/h2>/);
  assert.doesNotMatch(scopes, /explainer-category|explainer-support/);
  assert.match(scopes, /<p class="explainer-narration">Grow.<\/p>/);
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
  const cli = join(core, 'bin/explainery.mjs');
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'export', project, '--out', join(project, 'site')]);
  assert.match(stdout, /Exported 1 scene and 4 film files to .*site; serve it over http/);
  assert.ok((await lstat(join(project, 'site/index.html'))).isFile());
});
