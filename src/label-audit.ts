import { createHash } from 'node:crypto';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadStory } from './validate.ts';

/**
 * The record that a person or a fresh-context reviewer audited every on-screen domain fact against the sources
 * (docs/templates/label-audit.md). No check can judge a fact, so the guard locks only that an audit exists for exactly
 * the on-screen text that ships; `report` names the findings and their dispositions.
 */
export interface LabelAuditRecord { schemaVersion: 1; onScreenText: string; report: string; reviewer: string; recordedOn: string }

const RECORD = 'label-audit.json';
// Spoken text and its delivery are not on screen; changing them must not demand a new label audit.
const OFF_SCREEN = new Set(['narration', 'pronunciations', 'hold']);

function onScreen(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(onScreen);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !OFF_SCREEN.has(key)).map(([key, item]) => [key, onScreen(item)]));
  return value;
}

/** Fingerprints what the viewer reads: every composition file and the story without its spoken text. */
export async function onScreenTextHash(project: string): Promise<string> {
  const loaded = await loadStory(project);
  if (!loaded.value) throw new Error(loaded.errors.join('\n'));
  const names = (await readdir(join(project, 'compositions'))).filter(name => name.endsWith('.html')).sort();
  const compositions = await Promise.all(names.map(async name => [name, await readFile(join(project, 'compositions', name), 'utf8')]));
  return createHash('sha256').update(JSON.stringify({ version: 1, story: onScreen(loaded.value), compositions })).digest('hex');
}

/** Records an audit whose report exists; `report` is relative to the project directory. */
export async function recordLabelAudit(project: string, audit: { report: string; reviewer: string }): Promise<LabelAuditRecord> {
  try { await access(resolve(project, audit.report)); } catch { throw new Error(`audit report ${audit.report} not found`); }
  if (!audit.reviewer.trim()) throw new Error('name the reviewer who audited the labels');
  const record: LabelAuditRecord = { schemaVersion: 1, onScreenText: await onScreenTextHash(project), report: audit.report, reviewer: audit.reviewer, recordedOn: new Date().toISOString().slice(0, 10) };
  await writeFile(join(project, RECORD), JSON.stringify(record, null, 2) + '\n');
  return record;
}

export async function labelAuditErrors(project: string): Promise<string[]> {
  let record: LabelAuditRecord;
  try { record = JSON.parse(await readFile(join(project, RECORD), 'utf8')); }
  catch { return [`${RECORD} missing; audit on-screen facts against the sources (explainery-core docs/templates/label-audit.md) and record it with explainery label-audit`]; }
  if (record.schemaVersion !== 1) return [`unsupported ${RECORD} version`];
  if (record.onScreenText !== await onScreenTextHash(project)) return [`on-screen text changed since the label audit recorded on ${record.recordedOn}; audit the changed labels against the sources and record it again`];
  return [];
}
