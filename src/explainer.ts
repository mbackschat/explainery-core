import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sceneChapters } from './chapters.ts';
import { exportSubtitles, type ExplainerExportOptions } from './export-subtitles.ts';
import type { SubtitleCue } from './subtitles.ts';
import { filmFiles } from './film-files.ts';
import { hyperframesDist } from './hyperframes.ts';
import { spokenText } from './narration.ts';
import { sceneRange, storyScenes } from './story.ts';
import type { Scene, Story, Timing } from './types.ts';
import { validateProject } from './validate.ts';

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const seconds = (value: number) => String(Number(value.toFixed(6)));

const PLAYER = 'src="film/index.html" runtime-src="player/hyperframe.runtime.js"';

/** How a page brings in its theme and player, and how its players reach the film. */
export interface PageSource {
  /** Markup for <head>: the film's stylesheets and the player element's script. */
  head: string;
  /** Attributes that point a player at the film; empty when `boot` hands the film over instead. */
  film: string;
  /** Script that runs before the scrubbers are wired. */
  boot: string;
  subtitles?: SubtitleCue[];
}

function sceneSection(scene: Scene, slot: { start: number; duration: number }, fps: number, film: string): string {
  // The scrubber counts whole frames: a fractional step such as 1/30 s rounds, and the player then floors the rounded
  // time to the previous frame.
  const frame = (time: number) => Math.round(time * fps);
  const { category, support } = scene.compositions.length === 1 ? scene.compositions[0].copy : {};
  const start = seconds(slot.start);
  const end = seconds(slot.start + slot.duration);
  const player = `${scene.id}-player`;
  return `    <section class="explainer-scene" id="${scene.id}">
      <div class="explainer-stage">
        <hyperframes-player id="${player}" class="explainer-stage-player"${film ? ` ${film}` : ''} range-start="${start}" range-end="${end}" muted></hyperframes-player>
        <input class="explainer-scrub" type="range" data-player="${player}" data-fps="${fps}" min="${frame(slot.start)}" max="${frame(slot.start + slot.duration)}" step="1" value="${frame(slot.start + slot.duration / 2)}">
      </div>
      <div class="explainer-text">
${category === undefined ? '' : `        <p class="explainer-category">${escape(category)}</p>\n`}        <h2>${escape(scene.title)}</h2>
${support === undefined ? '' : `        <p class="explainer-support">${escape(support)}</p>\n`}        <p class="explainer-narration">${escape(spokenText(scene.compositions.map(composition => composition.narration).join(' ')))}</p>
      </div>
    </section>`;
}

/**
 * Renders the explainer page with the full film, then a silent player for each editorial scene's enclosing range.
 *
 * Each section has a scrubber, the editorial title, and combined composition narration. A single-composition scene
 * also retains its category and support copy, preserving the existing flat-story page.
 *
 * The page uses the film's own stylesheets, so it inherits the theme's tokens and fonts; its own classes are prefixed
 * explainer- to stay clear of theme classes. Each scene opens on its middle frame, and its scrubber moves frame by
 * frame within the scene.
 */
export function renderExplainerPage(story: Story, timing: Timing, { head, film, boot, subtitles = [] }: PageSource): string {
  const { width, height, fps } = story.canvas;
  const chapters = sceneChapters(story, timing);
  const sections = storyScenes(story).map(scene => sceneSection(scene, sceneRange(scene, timing), fps, film)).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(story.title)}</title>
${head}
    <style>
      body.explainer { margin: 0; padding: 48px clamp(16px, 5vw, 96px); line-height: 1.5; }
      .explainer-header h1 { margin: 0 0 24px; font-size: 40px; font-weight: 900; line-height: 1.1; }
      .explainer-film, .explainer-stage-player { display: block; width: 100%; aspect-ratio: ${width} / ${height}; }
      .explainer-viewer { background: #000; color: #fff; }
      .explainer-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px; }
      .explainer-tools label { display: flex; align-items: center; gap: 8px; flex: 1 1 240px; min-width: 0; }
      .explainer-tools select { flex: 1; min-width: 0; }
      .explainer-tools button, .explainer-tools select { font: inherit; color: #fff; background: #202020; border: 1px solid #888; border-radius: 4px; padding: 8px; }
      .explainer-tools :focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
      .explainer-tools button[aria-pressed="true"] { background: #fff; color: #000; }
      .explainer-caption { min-height: 2.6em; margin: 0; padding: 8px 16px; text-align: center; white-space: pre-line; font: 500 clamp(16px, 2vw, 24px)/1.3 sans-serif; }
      .explainer-viewer:fullscreen { display: flex; flex-direction: column; justify-content: center; padding: 16px; box-sizing: border-box; }
      .explainer-viewer:fullscreen .explainer-film { flex: 1; min-height: 0; aspect-ratio: auto; }
      .explainer-status { margin: 0; padding: 0 12px; }
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
      <div class="explainer-viewer">
        <hyperframes-player class="explainer-film"${film ? ` ${film}` : ''} controls></hyperframes-player>
${subtitles.length ? '        <p class="explainer-caption" hidden></p>\n' : ''}        <div class="explainer-tools">
          <label>Chapter <select class="explainer-chapters" aria-label="Chapters" disabled>
${chapters.map(chapter => `            <option value="${chapter.start}">${escape(chapter.title)}</option>`).join('\n')}
          </select></label>
${subtitles.length ? '          <button type="button" class="explainer-cc" aria-label="Subtitles" aria-pressed="false">CC / Subtitles</button>\n' : ''}          <button type="button" class="explainer-fullscreen" hidden>Fullscreen</button>
        </div>
        <p class="explainer-status" role="status"></p>
      </div>
    </header>
    <main>
${sections}
    </main>
    <script>
${boot}
      const mainPlayer = document.querySelector('.explainer-film');
      const chapterMenu = document.querySelector('.explainer-chapters');
      const chapterStarts = [...chapterMenu.options].map(option => Number(option.value));
      const subtitleCues = ${JSON.stringify(subtitles).replace(/</g, '\\u003c')};
      const cc = document.querySelector('.explainer-cc');
      const caption = document.querySelector('.explainer-caption');
      let subtitlesEnabled = false;
      let currentChapter = -1;
      const updateControls = () => {
        const time = mainPlayer.currentTime;
        const index = chapterStarts.findLastIndex(start => start <= time);
        if (index !== currentChapter) {
          chapterMenu.selectedIndex = Math.max(0, index);
          currentChapter = index;
        }
        if (caption) {
          const text = subtitlesEnabled ? subtitleCues.filter(cue => cue.start <= time && time < cue.end).map(cue => cue.text).join('\\n') : '';
          if (caption.textContent !== text) caption.textContent = text;
        }
      };
      const ready = () => { chapterMenu.disabled = false; updateControls(); };
      if (mainPlayer.ready) ready();
      else mainPlayer.addEventListener('ready', ready, { once: true });
      chapterMenu.addEventListener('change', () => {
        const playing = !mainPlayer.paused;
        mainPlayer.seek(Number(chapterMenu.value));
        if (playing) mainPlayer.play();
        updateControls();
      });
      cc?.addEventListener('click', () => {
        subtitlesEnabled = !subtitlesEnabled;
        cc.setAttribute('aria-pressed', String(subtitlesEnabled));
        caption.hidden = !subtitlesEnabled;
        updateControls();
      });
      // HyperFrames 0.8.142 seek() updates currentTime without always emitting timeupdate, including paused scrubs.
      // Read its clock on animation frames; never advance a separate subtitle clock.
      const followPlayer = () => { updateControls(); requestAnimationFrame(followPlayer); };
      requestAnimationFrame(followPlayer);
      const viewer = document.querySelector('.explainer-viewer');
      const fullscreen = document.querySelector('.explainer-fullscreen');
      if (document.fullscreenEnabled && viewer.requestFullscreen) {
        fullscreen.hidden = false;
        fullscreen.addEventListener('click', async () => {
          try {
            if (document.fullscreenElement === viewer) await document.exitFullscreen();
            else await viewer.requestFullscreen();
            document.querySelector('.explainer-status').textContent = '';
          } catch {
            document.querySelector('.explainer-status').textContent = 'Fullscreen is unavailable in this browser.';
          }
        });
        document.addEventListener('fullscreenchange', () => {
          fullscreen.textContent = document.fullscreenElement === viewer ? 'Exit fullscreen' : 'Fullscreen';
        });
      }
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

/** The page of the folder export, which links the film's stylesheets and player from film/ and player/. */
export function explainerPage(story: Story, timing: Timing, { stylesheets, subtitles }: { stylesheets: string[]; subtitles?: SubtitleCue[] }): string {
  const links = stylesheets.map(href => `    <link rel="stylesheet" href="film/${escape(href)}">`);
  return renderExplainerPage(story, timing, { head: [...links, '    <script src="player/hyperframes-player.js"></script>'].join('\n'), film: PLAYER, boot: '', subtitles });
}

export function stylesheetsOf(html: string): string[] {
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
export async function exportExplainer(projectDir: string, outDir: string, options: ExplainerExportOptions = {}): Promise<{ files: number; scenes: number }> {
  const validation = await validateProject(projectDir);
  if (!validation.valid) throw new Error(`The project does not validate:\n${validation.errors.join('\n')}`);
  const { story, timing } = validation;
  const subtitles = await exportSubtitles(options, timing.duration);
  const files = await filmFiles(projectDir);
  await prepareOutput(outDir);
  for (const file of files) {
    await mkdir(dirname(join(outDir, 'film', file)), { recursive: true });
    await copyFile(join(projectDir, file), join(outDir, 'film', file));
  }
  const hyperframes = hyperframesDist(projectDir);
  await mkdir(join(outDir, 'player'));
  await copyFile(join(hyperframes, 'hyperframes-player.global.js'), join(outDir, 'player/hyperframes-player.js'));
  await copyFile(join(hyperframes, 'hyperframe.runtime.iife.js'), join(outDir, 'player/hyperframe.runtime.js'));
  const stylesheets = stylesheetsOf(await readFile(join(projectDir, 'index.html'), 'utf8'));
  await writeFile(join(outDir, 'index.html'), explainerPage(story, timing, { stylesheets, subtitles }));
  return { files: files.length, scenes: storyScenes(story).length };
}
