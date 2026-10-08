import { access, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

const HTML_REFERENCE = /\s(?:src|href|xlink:href|data-composition-src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const CSS_REFERENCE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function references(text, pattern) {
  return [...text.matchAll(pattern)].map(match => match.slice(1).find(value => value !== undefined)).filter(Boolean);
}

/**
 * Lists every project file the root composition needs at runtime, as sorted project-relative paths.
 *
 * The crawl starts at index.html and follows src, href, and data-composition-src in HTML, url() and @import in CSS,
 * and href in SVG. Composition files mount into index.html, so their URLs resolve from the project root; CSS and
 * SVG files resolve references relative to themselves, as the browser does. Absolute URLs, data: URIs, and
 * fragments are skipped. A reference to a missing file, or one that leaves the project, throws.
 */
export async function filmFiles(projectDir) {
  const found = new Set();
  const problems = [];
  const visit = async (path, from) => {
    if (found.has(path)) return;
    if (path.startsWith('../')) {
      problems.push(`${path} (referenced by ${from}) lies outside the project`);
      return;
    }
    try {
      await access(join(projectDir, path));
    } catch {
      problems.push(`${path} (referenced by ${from}) is missing`);
      return;
    }
    found.add(path);
    const extension = posix.extname(path);
    if (!['.html', '.css', '.svg'].includes(extension)) return;
    const text = await readFile(join(projectDir, path), 'utf8');
    const base = extension === '.html' ? '' : posix.dirname(path);
    const refs = references(text, extension === '.css' ? CSS_REFERENCE : HTML_REFERENCE).filter(ref => !EXTERNAL.test(ref));
    for (const ref of refs) await visit(posix.normalize(posix.join(base, ref.split(/[?#]/)[0])), path);
  };
  await visit('index.html', 'the project');
  if (problems.length) throw new Error(`The film references files it cannot ship:\n${problems.join('\n')}`);
  return [...found].sort();
}
