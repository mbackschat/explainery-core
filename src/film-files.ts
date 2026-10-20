import { access, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { parseHTML } from 'linkedom';

const MARKUP_ATTRIBUTES = ['src', 'href', 'xlink:href', 'data-composition-src'];
const SVG_STYLE_ATTRIBUTES = ['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'cursor'];
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const EMBEDDED = /^(?:data:|#)/i;
const CSS_REFERENCE = /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^)"'\\])*))\s*\)|@import\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi;

/** URL query strings and fragments select a resource variant, never its local filename. */
export const localPathname = (ref: string): string => decodeURIComponent(ref.split(/[?#]/)[0]);

function cssReferences(text: string): string[] {
  const uncommented = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\//g, value => value.startsWith('/*') ? '' : value);
  return [...uncommented.matchAll(CSS_REFERENCE)].flatMap(match => {
    const value = match.slice(1).find(value => value !== undefined)?.trim();
    return value ? [value.replace(/\\([\da-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex: string | undefined, character: string) => hex ? String.fromCodePoint(parseInt(hex, 16)) : character)] : [];
  });
}

interface ScriptToken { value: string; kind: 'word' | 'string' | 'punctuation' }

/** Keeps executable template expressions while excluding strings, comments and regex examples from dependency checks. */
function scriptTokens(text: string): ScriptToken[] {
  const tokens: ScriptToken[] = [];
  let at = 0;
  const scan = (templateExpression = false): void => {
    let braces = 0;
    while (at < text.length) {
      const character = text[at];
      if (/\s/.test(character)) { at++; continue; }
      if (text.startsWith('//', at)) { at = text.indexOf('\n', at); if (at < 0) at = text.length; continue; }
      if (text.startsWith('/*', at)) { const end = text.indexOf('*/', at + 2); at = end < 0 ? text.length : end + 2; continue; }
      if (character === '"' || character === "'") {
        const quote = character;
        let value = '';
        at++;
        while (at < text.length && text[at] !== quote) {
          if (text[at] !== '\\') { value += text[at++]; continue; }
          at++;
          const escaped = text[at++];
          const digits = escaped === 'x' ? 2 : escaped === 'u' ? 4 : 0;
          if (digits && new RegExp(`^[\\da-f]{${digits}}$`, 'i').test(text.slice(at, at + digits))) {
            value += String.fromCodePoint(parseInt(text.slice(at, at + digits), 16));
            at += digits;
          } else if (escaped !== '\n' && escaped !== '\r') value += ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[escaped] ?? escaped;
        }
        at++;
        tokens.push({ value, kind: 'string' });
        continue;
      }
      if (character === '`') {
        at++;
        while (at < text.length && text[at] !== '`') {
          if (text[at] === '\\') at += 2;
          else if (text.startsWith('${', at)) { at += 2; scan(true); }
          else at++;
        }
        at++;
        tokens.push({ value: '', kind: 'string' });
        continue;
      }
      if (templateExpression && character === '}' && braces === 0) { at++; return; }
      if (character === '{') braces++;
      if (character === '}') braces--;
      const previous = tokens.at(-1);
      if (character === '/' && (!previous || /^(?:[=(:,;!&|?{\[]|return|throw|case|yield|await|=>)$/.test(previous.value))) {
        at++;
        let inClass = false;
        while (at < text.length) {
          const part = text[at++];
          if (part === '\\') at++;
          else if (part === '[') inClass = true;
          else if (part === ']') inClass = false;
          else if (part === '/' && !inClass) break;
        }
        while (/[a-z]/i.test(text[at] ?? '') && at < text.length) at++;
        tokens.push({ value: '', kind: 'string' });
        continue;
      }
      const word = /^[\w$]+/.exec(text.slice(at));
      if (word) { tokens.push({ value: word[0], kind: 'word' }); at += word[0].length; }
      else {
        const value = text.startsWith('=>', at) ? '=>' : character;
        tokens.push({ value, kind: 'punctuation' });
        at += value.length;
      }
    }
  };
  scan();
  return tokens;
}

function scriptReferences(text: string, unsupported: (detail: string) => void): string[] {
  const tokens = scriptTokens(text);
  const refs: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'word') continue;
    const next = tokens[index + 1];
    if (token.value === 'XMLHttpRequest' || (['fetch', 'require'].includes(token.value) && next?.value === '(')) unsupported(`${token.value} runtime loading`);
    if (token.value === 'import' && next?.value === '(') { unsupported('dynamic import'); continue; }
    if (token.value === 'import' && next?.value === '.') { unsupported('import.meta'); continue; }
    if (token.value === 'import' && next?.kind === 'string') { refs.push(next.value); continue; }
    if (token.value !== 'import' && !(token.value === 'export' && ['{', '*'].includes(next?.value))) continue;
    let source: string | undefined;
    for (let cursor = index + 1; cursor < tokens.length && tokens[cursor].value !== ';'; cursor++) {
      if (tokens[cursor].value === 'from' && tokens[cursor + 1]?.kind === 'string') { source = tokens[cursor + 1].value; break; }
      if (cursor > index + 1 && ['import', 'export'].includes(tokens[cursor].value)) break;
    }
    if (source !== undefined) refs.push(source);
    else if (token.value === 'import') unsupported('unrecognized import');
  }
  return refs;
}

function markupReferences(markup: string, unsupported: (detail: string) => void): { resources: string[]; modules: string[] } {
  const { document, HTMLTemplateElement } = parseHTML(markup);
  const elements = [...document.querySelectorAll('*')];
  const resources: string[] = [];
  const modules: string[] = [];
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    for (const name of MARKUP_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) resources.push(value);
    }
    const resourceAttribute = element.localName === 'video' ? 'poster' : element.localName === 'object' ? 'data' : undefined;
    const resource = resourceAttribute && element.getAttribute(resourceAttribute);
    if (resource) resources.push(resource);
    if ((element.localName === 'iframe' && element.hasAttribute('src'))
      || (element.localName === 'object' && (/\.(?:html?|xhtml)(?:[?#]|$)/i.test(resource ?? '') || /^(?:text\/html|application\/xhtml\+xml)$/i.test(element.getAttribute('type') ?? '')))) {
      unsupported('standalone iframe/object HTML; use root-mounted compositions with explicit local resources');
    }
    if (['img', 'source'].includes(element.localName) && element.hasAttribute('srcset')) {
      unsupported(`${element.localName} srcset; use a fixed src resource for reusable renders`);
    }
    if (element.localName === 'iframe' && element.hasAttribute('srcdoc')) {
      unsupported('iframe srcdoc; move the embedded markup into root-mounted compositions with explicit local resources');
    }
    resources.push(...cssReferences(element.getAttribute('style') ?? ''));
    if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
      for (const name of SVG_STYLE_ATTRIBUTES) resources.push(...cssReferences(element.getAttribute(name) ?? ''));
    }
    if (element.localName === 'style') resources.push(...cssReferences(element.textContent ?? ''));
    if (element.localName === 'script') {
      const type = element.getAttribute('type')?.toLowerCase();
      if (type === 'importmap') unsupported('import maps');
      else if (!type || ['module', 'text/javascript', 'application/javascript'].includes(type)) modules.push(...scriptReferences(element.textContent ?? '', unsupported));
    }
    if (element instanceof HTMLTemplateElement) elements.push(...element.content.querySelectorAll('*'));
  }
  return { resources, modules };
}

/**
 * Lists the local runtime dependency closure as sorted project-relative paths.
 *
 * HTML compositions mount at the root, so their markup, inline CSS and inline modules resolve from the project root.
 * External CSS, SVG and JavaScript resolve relative to their files. Script imports must be relative or root-relative.
 * Strict mode rejects external resources and runtime loading whose dependencies cannot be retained for reuse;
 * data URIs and fragments are self-contained. Missing files and paths outside the project always fail.
 */
export async function filmFiles(projectDir: string, { strict = false }: { strict?: boolean } = {}): Promise<string[]> {
  const found = new Set<string>();
  const problems: string[] = [];
  const visit = async (path: string, from: string): Promise<void> => {
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
    const extension = posix.extname(path).toLowerCase();
    if (!['.html', '.css', '.svg', '.js', '.mjs'].includes(extension)) return;
    const text = await readFile(join(projectDir, path), 'utf8');
    const base = extension === '.html' ? '' : posix.dirname(path);
    const unsupported = (detail: string) => { if (strict) problems.push(`unsupported reusable dependency: ${detail} (referenced by ${path})`); };
    const refs = extension === '.css' ? { resources: cssReferences(text), modules: [] }
      : ['.js', '.mjs'].includes(extension) ? { resources: [], modules: scriptReferences(text, unsupported) }
      : markupReferences(text, unsupported);
    for (const [kind, values] of Object.entries(refs)) {
      for (const ref of values) {
        if (EMBEDDED.test(ref)) continue;
        if (EXTERNAL.test(ref)) { unsupported(ref); continue; }
        if (kind === 'modules' && !/^(?:\.{1,2}\/|\/)/.test(ref)) { unsupported(`bare module import "${ref}"`); continue; }
        const pathname = localPathname(ref);
        await visit(posix.normalize(posix.join(pathname.startsWith('/') ? '' : base, pathname.replace(/^\//, ''))), path);
      }
    }
  };
  await visit('index.html', 'the project');
  if (problems.length) throw new Error(`The film references files it cannot ship:\n${problems.join('\n')}`);
  return [...found].sort();
}
