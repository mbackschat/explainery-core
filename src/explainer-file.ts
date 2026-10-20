import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { exportSubtitles, type ExplainerExportOptions } from './export-subtitles.ts';
import { renderExplainerPage, stylesheetsOf } from './explainer.ts';
import { hyperframesDist } from './hyperframes.ts';
import { validateProject } from './validate.ts';
import { storyScenes } from './story.ts';
import { requireAssembledTheme } from './theme.ts';
import { localPathname } from './film-files.ts';

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json',
};
// Uncompressed audio would make the file several times larger; AAC at 128 kbit/s is transparent for speech.
const COMPRESS_AUDIO = ['.wav', '.aif', '.aiff', '.flac'];
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script>/g;
const ATTRIBUTE = /(\s(?:src|href|poster|xlink:href)=")([^"]*)"/g;
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;
const CSS_IMPORT = /@import\s+(?:url\(\s*(["']?)([^)"']+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;

async function replaceAsync(text: string, pattern: RegExp, replace: (...match: string[]) => Promise<string>): Promise<string> {
  const replacements = await Promise.all([...text.matchAll(pattern)].map(match => replace(...match)));
  let index = 0;
  return text.replace(pattern, () => replacements[index++]);
}

/** Applies `edit` to the markup outside inline scripts, whose template strings are not references. */
async function outsideScripts(html: string, edit: (markup: string) => Promise<string>): Promise<string> {
  const parts = html.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/);
  return (await Promise.all(parts.map((part, i) => (i % 2 ? part : edit(part))))).join('');
}

const scriptText = (code: string) => code.replaceAll('</script', '<\\/script');

function cssFilePath(projectDir: string, folder: string, ref: string): string {
  const pathname = localPathname(ref);
  return resolve(pathname.startsWith('/') ? projectDir : folder, pathname.replace(/^\//, ''));
}

/** HyperFrames' bundler, which 0.8.142 ships only inside its CLI's hashed dist modules, with no public export. */
async function bundler(projectDir: string): Promise<(projectDir: string, options?: { entryFile: string }) => Promise<string>> {
  const dist = hyperframesDist(projectDir);
  const file = (await readdir(dist)).find(name => /^compiler-[\w-]+\.js$/.test(name));
  const module = file ? await import(pathToFileURL(join(dist, file)).href) : {};
  if (typeof module.bundleToSingleHtml !== 'function') {
    throw new Error(`HyperFrames in ${dist} no longer provides bundleToSingleHtml in dist/compiler-*.js; the single-file export needs updating for this version`);
  }
  return module.bundleToSingleHtml;
}

/** Turns files into data URIs, compressing audio, and collects the references it cannot resolve. */
function embedder(projectDir: string, work: string) {
  const missing = new Set<string>();
  const dataUri = async (path: string, ref: string): Promise<string> => {
    const extension = extname(path).toLowerCase();
    try {
      if (COMPRESS_AUDIO.includes(extension)) {
        const m4a = join(work, `${Math.random().toString(36).slice(2)}.m4a`);
        await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', path, '-c:a', 'aac', '-b:a', '128k', m4a]);
        return `data:audio/mp4;base64,${(await readFile(m4a)).toString('base64')}`;
      }
      return `data:${MIME[extension] ?? 'application/octet-stream'};base64,${(await readFile(path)).toString('base64')}`;
    } catch {
      missing.add(ref);
      return ref;
    }
  };
  /** Imports keep their own resource base; flattening them after URL embedding would lose that base. */
  const css = async (text: string, folder: string, ancestors = new Set<string>()): Promise<string> => {
    const imported = await replaceAsync(text, CSS_IMPORT, async (whole, _urlQuote, urlPath, _stringQuote, stringPath, condition) => {
      const ref = urlPath ?? stringPath;
      if (!ref || EXTERNAL.test(ref)) return whole;
      const path = cssFilePath(projectDir, folder, ref);
      if (ancestors.has(path)) return '';
      let source: string;
      try {
        source = await readFile(path, 'utf8');
      } catch {
        missing.add(ref);
        return '';
      }
      const media = condition.trim();
      if (/^(?:layer|supports)\b/.test(media)) throw new Error(`Cannot embed conditional CSS import "${ref}": use a plain import or media query`);
      const content = await css(source, dirname(path), new Set([...ancestors, path]));
      return media ? `@media ${media} {\n${content}\n}` : content;
    });
    return replaceAsync(imported, CSS_URL, async (whole, _quote, ref) => {
      const fragment = ref.includes('#') ? ref.slice(ref.indexOf('#')) : '';
      return EXTERNAL.test(ref) ? whole : `url("${await dataUri(cssFilePath(projectDir, folder, ref), ref)}${fragment}")`;
    });
  };
  return { missing, dataUri, css };
}

/**
 * The film as one self-contained HTML document: HyperFrames' bundle of the root composition, with what the bundler
 * leaves as file references embedded too. That is the sprite symbols of `<use href="x.svg#id">`, the files behind
 * symlinks such as node_modules/explainery-core (the bundler only reads inside the project), and files over its 2 MB
 * inline limit. Throws when a reference cannot be embedded.
 */
async function selfContainedFilm(projectDir: string, work: string): Promise<string> {
  const { missing, dataUri, css } = embedder(projectDir, work);
  const inlineStylesheets = (html: string): Promise<string> => outsideScripts(html, markup => replaceAsync(markup, /<link\b[^>]*\srel=["']stylesheet["'][^>]*>/g, async whole => {
    const ref = whole.match(/\shref=(["'])([^"']+)\1/)?.[2];
    if (!ref || EXTERNAL.test(ref)) return whole;
    const path = cssFilePath(projectDir, projectDir, ref);
    const media = whole.match(/\smedia=(["'])[^"']*\1/)?.[0] ?? '';
    return `<style${media}>${await css(await readFile(path, 'utf8'), dirname(path), new Set([path]))}</style>`;
  }));
  // HyperFrames 0.8.142 leaves imports across the package symlink relative to an inlined parent stylesheet.
  // tests/explainer-browser.test.ts reproduces that lost base with a film-local theme extending bundled light.
  const entryFile = `.explainery-export-${randomUUID()}.html`;
  const entryPath = join(projectDir, entryFile);
  const source = await inlineStylesheets(await readFile(join(projectDir, 'index.html'), 'utf8'));
  await writeFile(entryPath, source, { flag: 'wx' });
  let film: string;
  try {
    film = await (await bundler(projectDir))(projectDir, { entryFile });
  } finally {
    await rm(entryPath, { force: true });
  }

  const sprites = new Set<string>();
  film = await outsideScripts(film, async markup => markup.replace(/(<use\b[^>]*?\s(?:xlink:)?href=")([^"#]+\.svg)#([^"]+)"/g, (_, head, file, id) => {
    sprites.add(file);
    return `${head}#${id}"`;
  }));
  const symbols = await Promise.all([...sprites].map(async file => {
    try {
      return (await readFile(resolve(projectDir, file), 'utf8')).replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    } catch {
      missing.add(file);
      return '';
    }
  }));
  if (symbols.length) film = film.replace(/<body\b[^>]*>/, body => `${body}<svg width="0" height="0" style="position:absolute" aria-hidden="true">${symbols.join('')}</svg>`);

  film = await replaceAsync(film, /<script\b([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g, async (whole, before, ref, after) => {
    if (EXTERNAL.test(ref)) return whole;
    try {
      return `<script${before}${after}>${scriptText(await readFile(resolve(projectDir, ref), 'utf8'))}</script>`;
    } catch {
      missing.add(ref);
      return whole;
    }
  });
  film = await inlineStylesheets(film);
  film = await outsideScripts(film, async markup => {
    const attributes = await replaceAsync(markup, ATTRIBUTE, async (whole, head, ref) =>
      EXTERNAL.test(ref) || !ref ? whole : `${head}${await dataUri(resolve(projectDir, ref.split('#')[0]), ref)}"`);
    return replaceAsync(attributes, /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g, async (_, open, text, close) => `${open}${await css(text, projectDir)}${close}`);
  });
  if (missing.size) throw new Error(`The film references files the single file cannot embed:\n${[...missing].join('\n')}`);
  return film;
}

/**
 * Exports a validated project as one explainer.html that opens by double-click and plays offline: the same page as
 * the folder export, with the theme, the HyperFrames player, and the film embedded.
 *
 * The film is embedded once, as a script string that each player receives as `srcdoc`. Because it contains the
 * HyperFrames runtime, the player loads none from its CDN (it checks the document for the runtime before injecting
 * its own). Scene players receive the film only when they scroll into view, so the browser never runs every copy at
 * once.
 */
export async function exportExplainerFile(projectDir: string, outFile: string, options: ExplainerExportOptions = {}): Promise<{ bytes: number; scenes: number }> {
  const validation = await validateProject(projectDir);
  if (!validation.valid) throw new Error(`The project does not validate:\n${validation.errors.join('\n')}`);
  const { story, timing } = validation;
  await requireAssembledTheme(projectDir, story);
  const subtitles = await exportSubtitles(options, timing.duration);
  const work = await mkdtemp(join(tmpdir(), 'explainery-file-'));
  try {
    const film = await selfContainedFilm(projectDir, work);
    const { missing, css } = embedder(projectDir, work);
    const styles = await Promise.all(stylesheetsOf(await readFile(join(projectDir, 'index.html'), 'utf8')).map(async href => {
      const path = cssFilePath(projectDir, projectDir, href);
      return `    <style>${await css(await readFile(path, 'utf8'), dirname(path), new Set([path]))}</style>`;
    }));
    if (missing.size) throw new Error(`The page's stylesheets reference files the single file cannot embed:\n${[...missing].join('\n')}`);
    const player = await readFile(join(hyperframesDist(projectDir), 'hyperframes-player.global.js'), 'utf8');
    const boot = `      const film = ${JSON.stringify(film).replace(/</g, '\\u003c')};
      const load = player => player.hasAttribute('srcdoc') || player.setAttribute('srcdoc', film);
      load(document.querySelector('.explainer-film'));
      const scenes = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) { load(entry.target); scenes.unobserve(entry.target); }
      }, { rootMargin: '200px' });
      for (const player of document.querySelectorAll('.explainer-stage-player')) scenes.observe(player);`;
    const page = renderExplainerPage(story, timing, { head: [...styles, `    <script>${scriptText(player)}</script>`].join('\n'), film: '', boot, subtitles });
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, page);
    return { bytes: Buffer.byteLength(page), scenes: storyScenes(story).length };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
