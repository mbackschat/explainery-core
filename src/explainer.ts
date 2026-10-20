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
import { requireAssembledTheme } from './theme.ts';

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
        <hyperframes-player id="${player}" class="explainer-stage-player"${film ? ` ${film}` : ''} range-start="${start}" range-end="${end}" muted disable-click-to-play></hyperframes-player>
        <div class="explainer-scene-controls">
          <button type="button" class="explainer-scene-play" disabled>Play scene</button>
          <span class="explainer-scene-status">Loading · silent</span>
          <span class="explainer-scene-time"></span>
        </div>
        <input aria-label="Scene position" title="Drag to explore this silent scene" class="explainer-scrub" type="range" data-player="${player}" data-fps="${fps}" min="${frame(slot.start)}" max="${frame(slot.start + slot.duration)}" step="1" value="${frame(slot.start)}">
      </div>
      <div class="explainer-text">
${category === undefined ? '' : `        <p class="explainer-category">${escape(category)}</p>\n`}        <h3>${escape(scene.title)}</h3>
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
 * explainer- to stay clear of theme classes. Each scene opens at its entrance, and its scrubber moves frame by
 * frame within the scene.
 */
export function renderExplainerPage(story: Story, timing: Timing, { head, film, boot, subtitles = [] }: PageSource): string {
  const { width, height, fps } = story.canvas;
  const chapters = sceneChapters(story, timing);
  const scenes = storyScenes(story);
  const sections = scenes.map(scene => sceneSection(scene, sceneRange(scene, timing), fps, film)).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(story.title)}</title>
${head}
    <style>
      body.explainer { margin: 0; padding: 48px clamp(16px, 5vw, 96px); line-height: 1.5; }
      .explainer-film, .explainer-stage-player { display: block; width: 100%; aspect-ratio: ${width} / ${height}; }
      .explainer-viewer { background: #000; color: #fff; }
      .explainer-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px; transition: opacity .3s ease; }
      .explainer-controls-idle { cursor: none; }
      .explainer-controls-idle .explainer-tools { opacity: 0; pointer-events: none; }
      .explainer-tools label { display: flex; align-items: center; gap: 8px; max-width: 100%; min-width: 0; }
      .explainer-tools select { width: 16rem; max-width: 100%; min-width: 0; }
      .explainer-tools button, .explainer-tools select { font: inherit; color: #fff; background: #202020; border: 1px solid #888; border-radius: 4px; padding: 8px; }
      .explainer-tools :focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
      .explainer-tools button[aria-pressed="true"] { background: #fff; color: #000; }
      .explainer-caption { display: grid; flex-shrink: 0; box-sizing: content-box; min-height: 2.6em; margin: 0; padding: 8px 16px; text-align: center; white-space: pre-line; font: 500 clamp(16px, 2vw, 24px)/1.3 sans-serif; }
      .explainer-caption[hidden] { display: none; }
      /* Overlapping invisible cues reserve the tallest wrapped cue at this width, preventing playback reflow. */
      .explainer-caption > span { grid-area: 1 / 1; }
      .explainer-caption-size { visibility: hidden; }
      .explainer-viewer:fullscreen { display: flex; flex-direction: column; justify-content: center; padding: 16px; box-sizing: border-box; }
      .explainer-viewer:fullscreen .explainer-film { flex: 1; min-height: 0; aspect-ratio: auto; }
      .explainer-status { margin: 0; padding: 0 12px; }
      .explainer-scene-intro { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--border, #444); }
      .explainer-scene-intro h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
      .explainer-scene-intro p { margin: 0 0 10px; color: var(--text-secondary, #aaa); font-size: 14px; }
      .explainer-scene-index { font-size: 14px; line-height: 1.8; color: var(--text-secondary, #aaa); }
      .explainer-scene-index a { color: inherit; text-underline-offset: 3px; }
      .explainer-scene-index a:hover, .explainer-scene-index a:focus-visible { color: var(--text, #fff); }
      .explainer-scene-intro + .explainer-scene { margin-top: 32px; }
      .explainer-scene { scroll-margin-top: 24px; display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 40px; align-items: center; margin: 96px 0; }
      .explainer-scene-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 12px; font-size: 13px; color: var(--text-secondary, #aaa); }
      .explainer-scene-play { min-width: 7em; padding: 4px 8px; border: 1px solid var(--border, #444); border-radius: 4px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      .explainer-scene-time { margin-left: auto; font-variant-numeric: tabular-nums; }
      .explainer-stage-player { cursor: pointer; }
      .explainer-scrub { appearance: none; display: block; width: 100%; height: 20px; margin: 2px 0 0; padding: 0; background: transparent; cursor: pointer; }
      .explainer-scrub::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: var(--border, #444); }
      .explainer-scrub::-moz-range-track { height: 3px; border-radius: 2px; background: var(--border, #444); }
      .explainer-scrub::-webkit-slider-thumb { appearance: none; width: 10px; height: 10px; margin-top: -3.5px; border: 0; border-radius: 50%; background: var(--accent, #aaa); }
      .explainer-scrub::-moz-range-thumb { width: 10px; height: 10px; border: 0; border-radius: 50%; background: var(--accent, #aaa); }
      .explainer-category { margin: 0 0 8px; color: var(--accent); font-size: 14px; font-weight: 700; letter-spacing: 3px; }
      .explainer-text h3 { margin: 0 0 12px; font-size: 36px; font-weight: 900; line-height: 1.1; }
      .explainer-support { margin: 0 0 20px; color: var(--text-secondary); font-size: 20px; font-weight: 300; }
      .explainer-narration { margin: 0; padding-left: 16px; border-left: 3px solid var(--accent); color: var(--text-secondary); font-size: 18px; }
      @media (max-width: 900px) { .explainer-scene { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body class="explainer">
    <header class="explainer-header">
      <div class="explainer-viewer">
        <hyperframes-player class="explainer-film"${film ? ` ${film}` : ''} controls></hyperframes-player>
${subtitles.length ? `        <p class="explainer-caption" hidden>
          <span class="explainer-caption-text"></span>
${subtitles.map(cue => `          <span class="explainer-caption-size" aria-hidden="true">${escape(cue.text)}</span>`).join('\n')}
        </p>\n` : ''}        <div class="explainer-tools">
          <label>Chapter <select class="explainer-chapters" aria-label="Chapters" disabled>
${chapters.map(chapter => `            <option value="${chapter.start}">${escape(chapter.title)}</option>`).join('\n')}
          </select></label>
${subtitles.length ? '          <button type="button" class="explainer-cc" aria-label="Subtitles" aria-pressed="false">CC / Subtitles</button>\n' : ''}          <button type="button" class="explainer-fullscreen" hidden>Fullscreen</button>
        </div>
        <p class="explainer-status" role="status"></p>
      </div>
    </header>
    <main>
      <header class="explainer-scene-intro">
        <h2>Individual scenes</h2>
        <p>Play each scene silently, or drag its slider to explore. Click the picture to play or pause; narration is written alongside.</p>
        <nav class="explainer-scene-index" aria-label="Individual scenes">
          ${scenes.map(scene => `<a href="#${escape(scene.id)}">${escape(scene.title)}</a>`).join(' <span aria-hidden="true">·</span> ')}
        </nav>
      </header>
${sections}
    </main>
    <script>
${boot}
      const sceneUpdates = [];
      const mainPlayer = document.querySelector('.explainer-film');
      const chapterMenu = document.querySelector('.explainer-chapters');
      const chapterStarts = [...chapterMenu.options].map(option => Number(option.value));
      const subtitleCues = ${JSON.stringify(subtitles).replace(/</g, '\\u003c')};
      const cc = document.querySelector('.explainer-cc');
      const caption = document.querySelector('.explainer-caption');
      const captionText = document.querySelector('.explainer-caption-text');
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
          if (captionText.textContent !== text) captionText.textContent = text;
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
      const followPlayer = () => { updateControls(); updateControlVisibility(); for (const update of sceneUpdates) update(); requestAnimationFrame(followPlayer); };
      requestAnimationFrame(followPlayer);
      const viewer = document.querySelector('.explainer-viewer');
      const toolbar = document.querySelector('.explainer-tools');
      const nativeControls = mainPlayer.shadowRoot.querySelector('.hfp-controls');
      // HyperFrames 0.8.142 exposes no auto-hide coordination API. Scope this override to its pinned controls
      // selector so its independent timer cannot hide volume/playback while the shared toolbar is being used.
      const controlsStyle = document.createElement('style');
      controlsStyle.textContent = ':host([data-explainery-idle]), :host([data-explainery-idle]) * { cursor: none !important; } :host(:not([data-explainery-idle])) .hfp-controls { opacity: 1 !important; pointer-events: auto !important; } :host([data-explainery-idle]) .hfp-controls { opacity: 0 !important; pointer-events: none !important; }';
      mainPlayer.shadowRoot.appendChild(controlsStyle);
      let lastActivity = performance.now();
      let wasPaused = true;
      let controlsIdle = false;
      let pointerHeld = false;
      let keyboardMode = false;
      const setControlsIdle = idle => {
        if (controlsIdle === idle) return;
        controlsIdle = idle;
        viewer.classList.toggle('explainer-controls-idle', idle);
        mainPlayer.toggleAttribute('data-explainery-idle', idle);
        frame.contentDocument?.documentElement.toggleAttribute('data-explainery-idle', idle);
      };
      const showControls = () => { lastActivity = performance.now(); setControlsIdle(false); };
      const pointerActivity = () => { keyboardMode = false; showControls(); };
      const pointerDown = () => { pointerHeld = true; pointerActivity(); };
      const pointerUp = () => { pointerHeld = false; showControls(); };
      const keyboardActivity = () => { keyboardMode = true; showControls(); };
      const wireActivity = target => {
        target.addEventListener('pointermove', pointerActivity);
        target.addEventListener('pointerdown', pointerDown);
        target.addEventListener('pointerup', pointerUp);
        target.addEventListener('pointercancel', pointerUp);
        target.addEventListener('keydown', keyboardActivity);
        target.addEventListener('focusin', showControls);
      };
      wireActivity(viewer);
      document.addEventListener('keydown', () => { keyboardMode = true; });
      document.addEventListener('pointerup', pointerUp);
      document.addEventListener('pointercancel', pointerUp);
      // Composition iframe events do not bubble to the host; activity over the film must also reveal controls.
      const frame = mainPlayer.shadowRoot.querySelector('iframe');
      const wireFilmActivity = () => {
        const frameDocument = frame.contentDocument;
        if (!frameDocument) return;
        if (!frameDocument.querySelector('style[data-explainery-cursor]')) {
          const cursorStyle = frameDocument.createElement('style');
          cursorStyle.setAttribute('data-explainery-cursor', '');
          cursorStyle.textContent = 'html[data-explainery-idle], html[data-explainery-idle] * { cursor: none !important; }';
          frameDocument.head.appendChild(cursorStyle);
        }
        frameDocument.documentElement.toggleAttribute('data-explainery-idle', controlsIdle);
        wireActivity(frameDocument);
      };
      frame.addEventListener('load', wireFilmActivity);
      mainPlayer.addEventListener('ready', wireFilmActivity);
      wireFilmActivity();
      const updateControlVisibility = () => {
        const paused = mainPlayer.paused;
        if (paused !== wasPaused) { wasPaused = paused; showControls(); }
        const focused = document.activeElement === mainPlayer ? mainPlayer.shadowRoot.activeElement : document.activeElement;
        const usingKeyboard = keyboardMode && (toolbar.contains(focused) || nativeControls.contains(focused));
        const usingPointer = pointerHeld || toolbar.matches(':hover') || nativeControls.matches(':hover');
        if (usingKeyboard || usingPointer) lastActivity = performance.now();
        setControlsIdle(mainPlayer.ready && !paused && !usingKeyboard && !usingPointer && performance.now() - lastActivity >= 3000);
      };
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
      // WebKit 26.0 loses a button click when its text node is replaced between pointerdown and pointerup.
      const setControlText = (element, text) => {
        if (element.textContent !== text) element.textContent = text;
      };
      const sceneTime = seconds => {
        const whole = Math.max(0, Math.floor(seconds));
        return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
      };
      for (const scrub of document.querySelectorAll('.explainer-scrub')) {
        const player = document.getElementById(scrub.dataset.player);
        const stage = scrub.closest('.explainer-stage');
        const button = stage.querySelector('.explainer-scene-play');
        const status = stage.querySelector('.explainer-scene-status');
        const time = stage.querySelector('.explainer-scene-time');
        const fps = Number(scrub.dataset.fps);
        const start = Number(player.getAttribute('range-start'));
        const end = Number(player.getAttribute('range-end'));
        const update = () => {
          if (!player.ready) return;
          const ended = player.paused && player.currentTime >= end - 1 / fps;
          const position = String(Math.round(player.currentTime * fps));
          if (scrub.value !== position) scrub.value = position;
          setControlText(button, player.paused ? (ended ? 'Replay scene' : 'Play scene') : 'Pause');
          setControlText(status, (ended ? 'Ended' : player.paused ? 'Paused' : 'Playing') + ' · silent');
          setControlText(time, sceneTime(Math.min(end - start, Math.max(0, player.currentTime - start))) + ' / ' + sceneTime(end - start));
        };
        const toggle = () => {
          if (!player.ready) return;
          if (player.paused) {
            if (player.currentTime >= end - 1 / fps) player.seek(start);
            player.play();
          } else player.pause();
          update();
        };
        button.addEventListener('click', toggle);
        player.addEventListener('click', toggle);
        scrub.addEventListener('input', () => {
          player.pause();
          player.seek(Number(scrub.value) / fps);
          update();
        });
        const ready = () => {
          player.seek(start);
          button.disabled = false;
          update();
        };
        if (player.ready) ready();
        else player.addEventListener('ready', ready, { once: true });
        sceneUpdates.push(update);
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
  await requireAssembledTheme(projectDir, story);
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
