#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assembleIndex, exportExplainer, validateProject } from '../src/index.mjs';

const USAGE = 'Usage: explainery validate [project-dir]\n       explainery assemble [project-dir] [--check]\n       explainery export [project-dir] [--out <dir>]';
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const optionValues = ['--out'].map(option);
const [command, dir = '.'] = args.filter(arg => !arg.startsWith('--') && !optionValues.includes(arg));
const project = resolve(dir);

function fail(errors) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
}

function report(message) {
  console.log(message);
}

async function validate() {
  const { errors, story } = await validateProject(project);
  if (errors.length) return fail(errors);
  const count = story.scenes.length;
  return report(`Valid: ${count} ${count === 1 ? 'scene' : 'scenes'} in ${project}`);
}

async function assemble({ check }) {
  const { errors, story, timing } = await validateProject(project);
  if (errors.length) return fail(errors);
  const file = join(project, 'index.html');
  const current = await readFile(file, 'utf8');
  const assembled = assembleIndex(current, story, timing);
  if (assembled.errors.length) return fail(assembled.errors);
  if (assembled.html === current) return report('index.html is up to date');
  if (check) return fail(['index.html is out of date with story.yaml and timing.json; run explainery assemble']);
  await writeFile(file, assembled.html);
  return report(`Assembled ${story.scenes.length} scenes into index.html`);
}

async function exportPage(out) {
  const target = resolve(out ?? join(project, 'explainer'));
  try {
    const { scenes, files } = await exportExplainer(project, target);
    return report(`Exported ${scenes} ${scenes === 1 ? 'scene' : 'scenes'} and ${files} film files to ${target}; serve it over http, not file://`);
  } catch (error) {
    return fail([error.message]);
  }
}

switch (command) {
  case 'validate':
    await validate();
    break;
  case 'assemble':
    await assemble({ check: args.includes('--check') });
    break;
  case 'export':
    await exportPage(option('--out'));
    break;
  default:
    console.error(USAGE);
    process.exitCode = 2;
}
