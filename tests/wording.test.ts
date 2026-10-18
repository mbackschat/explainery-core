import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { frameErrors, wordingErrors, type Composition, type Scene, type Story } from '../src/index.ts';

const composition = (id: string, headline: string, extra: Partial<Composition> = {}): Composition => ({ id, copy: { headline }, narration: 'Plain words.', ...extra });
const film = (...scenes: (Composition | Scene)[]): Story => ({ id: 'demo', title: 'Demo', theme: 'dark', canvas: { width: 1920, height: 1080, fps: 30 }, scenes });

// Each rejected headline is slop an agent actually produced for a film; the reason names the pattern.
test('slogan headlines fail with the pattern they use', () => {
  const rejected: [string, RegExp][] = [
    ['Change one path. Share the rest', /several sentences/],
    ['More than a shape', /teaser/],
    ['Give data a shared home', /metaphor/],
    ['A language: one home for domain knowledge', /metaphor/],
    ['One core, many hosts', /counted contrast/],
    ['Five pillars, one core', /counted contrast/],
    ['Recap: one language, eight steps', /counted contrast/],
    ['Seamless editing for every team', /hype/],
    ['The cache answers reads.', /ends with a period/],
  ];
  for (const [headline, reason] of rejected) {
    const errors = wordingErrors(film(composition('c', headline)));
    assert.equal(errors.length, 1, `${headline}: ${errors.join('; ')}`);
    assert.match(errors[0], reason);
    assert.match(errors[0], /^story\.yaml composition "c": headline "/);
  }
});

test('plain claims, contrasts and questions pass', () => {
  for (const headline of [
    'An edit copies one tree path and shares the rest',
    'Edits change the working set, not the backend',
    'The cache answers reads; the server answers writes',
    'Save commits one transaction per editing session',
    'Where does the state live?',
    'Define languages, work with models, run apps',
  ]) assert.deepEqual(wordingErrors(film(composition('c', headline))), [], headline);
});

test('support lines, card headlines, scene titles and narration are checked too', () => {
  const story = film(
    { id: 'opening', title: 'One tool, many teams', compositions: [composition('route', 'The four parts of this film', { card: 'agenda', copy: { headline: 'The four parts of this film', support: 'Unlock a powerful workflow.' } })] },
    composition('content', 'A queue assigns each task once', { narration: 'The queue gives every task a home.' }),
  );
  assert.deepEqual(wordingErrors(story).map(error => error.replace(/;.*$/, '')), [
    'story.yaml scene "opening": title "One tool, many teams" is a counted contrast',
    'story.yaml composition "route": support "Unlock a powerful workflow." uses hype words (unlock, powerful)',
    'story.yaml composition "content": narration uses a metaphor (home)',
  ]);
});

const card = (id: string, kind: 'chapter' | 'agenda', headline: string): Composition => composition(id, headline, { card: kind });
const scene = (id: string, ...compositions: Composition[]): Scene => ({ id, title: id, compositions });

test('a film of more than three scenes opens with a route, opens each scene with a chapter card and ends on a recap scene', () => {
  const framed = film(
    scene('hook', composition('problem', 'Two inboxes duplicate each request'), card('route', 'agenda', 'The three parts of this film')),
    scene('one', card('one-question', 'chapter', 'Why do requests get lost?'), composition('one-diagram', 'Requests wait in two inboxes')),
    scene('two', card('two-question', 'chapter', 'Who owns a request?'), composition('two-diagram', 'A shared queue assigns one owner')),
    scene('three', card('three-question', 'chapter', 'What happens on handover?'), composition('three-diagram', 'Handover moves the owner, not the request')),
    scene('recap', card('recap-card', 'agenda', 'Recap of the three parts')),
  );
  assert.deepEqual(frameErrors(framed), []);
  const bare = film(
    scene('one', composition('a', 'Requests wait in two inboxes')),
    scene('two', composition('b', 'A shared queue assigns one owner')),
    scene('three', composition('c', 'Handover moves the owner')),
    scene('four', composition('d', 'The queue keeps a history')),
  );
  assert.deepEqual(frameErrors(bare), [
    'story.yaml: a film of 4 scenes needs an agenda card in its first scene to show the route',
    'story.yaml: a film of 4 scenes needs a closing recap scene of agenda cards alone',
    'story.yaml scene "two": needs a chapter card first, asking the scene\'s question',
    'story.yaml scene "three": needs a chapter card first, asking the scene\'s question',
  ]);
  assert.deepEqual(frameErrors(film(scene('one', composition('a', 'A')), scene('two', composition('b', 'B')), scene('three', composition('c', 'C')))), []);
});

// The guide's good examples are the reference wording, so the lexical check must never reject one of them.
test('every good example in the plain wording guide passes the check', async () => {
  const guide = await readFile(new URL('../docs/plain-wording.md', import.meta.url), 'utf8');
  let section = '';
  let checked = 0;
  for (const line of guide.split('\n')) {
    if (line.startsWith('### ')) section = line;
    const cells = line.split('|').map(cell => cell.trim());
    if (cells.length !== 5 || cells[1] === 'Bad' || cells[1].startsWith('---')) continue;
    const good = cells[3];
    const asCopy = /Headlines|Cards/.test(section);
    const story = film(composition('c', asCopy ? good : 'Plain claim', asCopy ? {} : { narration: good }));
    assert.deepEqual(wordingErrors(story), [], `${section}: ${good}`);
    checked++;
  }
  assert.ok(checked >= 20, `only ${checked} examples found`);
});
