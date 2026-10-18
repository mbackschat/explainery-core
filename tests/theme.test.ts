import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The classes a composition may use to receive the theme's styling; docs/authoring.md documents the copy block.
const compositionContract = new Set(['background', 'copy', 'accent-rule', 'category', 'support', 'diagram-label', 'diagram-tag']);

// Every theme rule must target either a documented composition class or an element the runtime creates under an
// explainery- class. An unprefixed runtime class such as .card silently restyles story markup that happens to share
// the name: a story's SVG .card rects became invisible when the card layer's `.card { opacity: 0 }` arrived.
test('theme selectors reach story markup only through the documented composition classes', () => {
  const css = readFileSync(new URL('../themes/dark/theme.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\([^)]*\)/g, '');
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .map(match => match[1].trim())
    .filter(selector => !selector.startsWith('@'))
    .flatMap(selector => selector.split(','))
    .map(selector => selector.trim());
  const leaks = selectors.filter(selector => {
    const compounds = selector.split(/[\s>+~]+/).filter(Boolean);
    let scoped = false;
    return compounds.some(compound => {
      const classes = [...compound.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => match[1]);
      if (classes.some(name => name.startsWith('explainery-'))) scoped = true;
      return !scoped && classes.length > 0 && !classes.every(name => compositionContract.has(name));
    });
  });
  assert.deepEqual(leaks, []);
});
