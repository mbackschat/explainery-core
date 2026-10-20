import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import type { Story } from './types.ts';

export const themeHref = (theme: string): string => theme.startsWith('./') ? theme.slice(2) : `node_modules/explainery-core/themes/${theme}/theme.css`;

/** Checks the explicitly managed theme without imposing theme selection on legacy authored roots. */
export async function validateTheme(project: string, story: Story): Promise<string[]> {
  let html: string;
  try {
    html = await readFile(join(project, 'index.html'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (!parseHTML(html).document.querySelector('[data-story-theme]')) return [];
  const href = themeHref(story.theme);
  try {
    await access(join(project, href));
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return [`story.yaml theme "${story.theme}": missing ${href}`];
  }
}

/** A full-film consumer must use the assembled theme, as isolated scene views do. */
export async function requireAssembledTheme(project: string, story: Story): Promise<void> {
  const html = await readFile(join(project, 'index.html'), 'utf8');
  const markers = [...parseHTML(html).document.querySelectorAll('[data-story-theme]')];
  if (!markers.length) return;
  if (markers.length > 1) throw new Error('index.html: keep one data-story-theme stylesheet');
  const marker = markers[0];
  if (marker.localName !== 'link' || marker.getAttribute('rel') !== 'stylesheet') {
    throw new Error('index.html: data-story-theme belongs on a stylesheet link');
  }
  if (marker.getAttribute('href') !== themeHref(story.theme)) {
    throw new Error('index.html: theme is stale; run explainery assemble');
  }
}
