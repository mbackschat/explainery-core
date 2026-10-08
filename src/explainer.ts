import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { filmFiles } from './film-files.ts';
import type { Scene, SceneTiming, Story, Timing } from './types.ts';
import { validateProject } from './validate.ts';

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const seconds = (value: number) => String(Number(value.toFixed(6)));
const spoken = (narration: string) => narration.replace(/\{[^{}]*\}/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();

const PLAYER = 'src="film/index.html" runtime-src="player/hyperframe.runtime.js"';

function sceneSection(scene: Scene, slot: SceneTiming, fps: number): string {
  // The scrubber counts whole frames: a fractional step such as 1/30 s rounds, and the player then floors the rounded
  // time to the previous frame.
  const frame = (time: number) => Math.round(time * fps);
  const { category, headline, support } = scene.copy;
  const start = seconds(slot.start);
  const end = seconds(slot.start + slot.duration);
  const player = `${scene.id}-player`;
  return `    <section class="explainer-scene" id="${scene.id}">
      <div class="explainer-stage">
        <hyperframes-player id="${player}" class="explainer-stage-player" ${PLAYER} range-start="${start}" range-end="${end}" muted></hyperframes-player>
        <input class="explainer-scrub" type="range" data-player="${player}" data-fps="${fps}" min="${frame(slot.start)}" max="${frame(slot.start + slot.duration)}" step="1" value="${frame(slot.start + slot.duration / 2)}">
      </div>
      <div class="explainer-text">
${category === undefined ? '' : `        <p class="explainer-category">${escape(category)}</p>\n`}        <h2>${escape(headline)}</h2>
${support === undefined ? '' : `        <p class="explainer-support">${escape(support)}</p>\n`}        <p class="explainer-narration">${escape(spoken(scene.narration))}</p>
      </div>
    </section>`;
}

/**
 * Renders the explainer page: the whole film with audio at the top, then per scene a silent player limited to the
 * scene's window, a scrubber over that window, and the scene's copy and narration beside it.
 *
 * The page links the film's own stylesheets (paths relative to the project, served under film/), so it inherits the
 * theme's tokens and fonts; its own classes are prefixed explainer- to stay clear of theme classes. Each scene opens
 * on its middle frame, and its scrubber moves frame by frame within the scene.
 */
export function explainerPage(story: Story, timing: Timing, { stylesheets }: { stylesheets: string[] }): string {
  const { width, height, fps } = story.canvas;
  const links = stylesheets.map(href => `    <link rel="stylesheet" href="film/${escape(href)}">`).join('\n');
  const sections = story.scenes.map(scene => sceneSection(scene, timing.scenes[scene.id], fps)).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(story.title)}</title>
${links}
    <script src="player/hyperframes-player.js"></script>
    <style>
      body.explainer { margin: 0; padding: 48px clamp(16px, 5vw, 96px); line-height: 1.5; }
      .explainer-header h1 { margin: 0 0 24px; font-size: 40px; font-weight: 900; line-height: 1.1; }
      .explainer-film, .explainer-stage-player { display: block; width: 100%; aspect-ratio: ${width} / ${height}; }
      .explainer-scene { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 40px; align-items: center; margin: 96px 0; }
      .explainer-scrub { width: 100%; margin: 12px 0 0; accent-color: var(--accent); }
      .explainer-category { margin: 0 0 8px; color: var(--accent); font-size: 14px; font-weight: 700; letter-spacing: 3px; }
      .explainer-text h2 { margin: 0 0 12px; font-size: 36px; font-weight: 900; line-height: 1.1; }
      .explainer-support { margin: 0 0 20px; color: var(--text-secondary); font-size: 20px; font-weight: 300; }
      .explainer-narration { margin: 0; padding-left: 16px; border-left: 3px solid var(--accent); color: var(--text-secondary); font-size: 18px; }
      @media (max-width: 900px) { .explainer-scene { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body class="explainer">
    <header class="explainer-header">
      <h1>${escape(story.title)}</h1>
      <hyperframes-player class="explainer-film" ${PLAYER} controls></hyperframes-player>
    </header>
    <main>
${sections}
    </main>
    <script>
      for (const scrub of document.querySelectorAll('.explainer-scrub')) {
        const player = document.getElementById(scrub.dataset.player);
        const show = () => player.seek(Number(scrub.value) / Number(scrub.dataset.fps));
        scrub.addEventListener('input', show);
        if (player.ready) show();
        else player.addEventListener('ready', show, { once: true });
      }
    </script>
  </body>
</html>
`;
}

function stylesheetsOf(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter(tag => /\srel=["']stylesheet["']/.test(tag))
    .map(tag => tag.match(/\shref=["']([^"']+)["']/)![1]);
}

// Replacing the output folder deletes it first, so only a missing, empty, or earlier export folder may be replaced.
async function prepareOutput(outDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (entries.length && !(['index.html', 'film', 'player'].every(entry => entries.includes(entry)))) {
    throw new Error(`${outDir} is not empty and is not an earlier explainer export; choose another --out folder`);
  }
  await rm(outDir, { recursive: true, force: true });
}

/**
 * Exports a validated project as a static explainer folder: index.html (the page), player/ (the HyperFrames player
 * and runtime), and film/ (every file the root composition needs, copied as real files).
 *
 * The folder must be served over http(s): on file:// the player ignores runtime-src and loads its runtime from a CDN.
 */
export async function exportExplainer(projectDir: string, outDir: string): Promise<{ files: number; scenes: number }> {
  const validation = await validateProject(projectDir);
  if (!validation.valid) throw new Error(`The project does not validate:\n${validation.errors.join('\n')}`);
  const { story, timing } = validation;
  const files = await filmFiles(projectDir);
  await prepareOutput(outDir);
  for (const file of files) {
    await mkdir(dirname(join(outDir, 'film', file)), { recursive: true });
    await copyFile(join(projectDir, file), join(outDir, 'film', file));
  }
  const hyperframes = join(dirname(createRequire(join(projectDir, 'package.json')).resolve('hyperframes/package.json')), 'dist');
  await mkdir(join(outDir, 'player'));
  await copyFile(join(hyperframes, 'hyperframes-player.global.js'), join(outDir, 'player/hyperframes-player.js'));
  await copyFile(join(hyperframes, 'hyperframe.runtime.iife.js'), join(outDir, 'player/hyperframe.runtime.js'));
  const stylesheets = stylesheetsOf(await readFile(join(projectDir, 'index.html'), 'utf8'));
  await writeFile(join(outDir, 'index.html'), explainerPage(story, timing, { stylesheets }));
  return { files: files.length, scenes: story.scenes.length };
}
