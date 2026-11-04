import assert from 'node:assert/strict';
import test from 'node:test';
import { spokenText, voicedText } from '../src/index.ts';

test('pronunciation profiles follow the stored language and preserve canonical terms', async () => {
  const { storyPronunciations, pronunciationErrors } = await import('../src/narration.ts');
  const german = { voice: { lang: 'de' }, pronunciations: { A12: 'A zwölf', JSON: 'Dschäison' } };
  const text = 'A12 nutzt API und JSON.';
  assert.equal(voicedText(text, storyPronunciations(german)), 'A zwölf nutzt A-P-eye und Dschäison.');
  assert.equal(spokenText(text), text);
  assert.deepEqual(pronunciationErrors({ API: 'A P I' }, 'de'), []);
  assert.equal(voicedText('API', storyPronunciations({ voice: { name: 'ff_siwis' } })), 'A-P-eye');
  assert.equal(voicedText('API', storyPronunciations({ voice: { lang: 'en-gb' } })), 'A-P-eye');
});

test('a draft voice speaks each word in its pronunciation, while readers still see the written word', () => {
  const narration = 'The SQL {sql} layer stores JSON files.';
  const pronunciations = { SQL: 'S-Q-L', JSON: 'Jason' };
  assert.equal(voicedText(narration, pronunciations), 'The S-Q-L layer stores Jason files.');
  assert.equal(spokenText(narration), 'The SQL layer stores JSON files.');
});

test('a pronunciation replaces whole words only, beside punctuation, and is case-sensitive', () => {
  const pronunciations = { SQL: 'S-Q-L', 'C++': 'C plus plus' };
  assert.equal(voicedText('SQL: SQLs, (SQL), sql, MSSQL and C++.', pronunciations), 'S-Q-L: SQLs, (S-Q-L), sql, MSSQL and C plus plus.');
});

test('without pronunciations the voiced text is the spoken text', () => {
  assert.equal(voicedText('Say {wave} hello.'), 'Say hello.');
});


test('voiced narration retains canonical and spoken offsets for expansions and unchanged text', async () => {
  const { voicedNarration } = await import('../src/narration.ts');
  const mapped = voicedNarration('{start} Use API, then Data Store.', { API: 'A P I', 'Data Store': 'data storage' });
  assert.equal(mapped.written, 'Use API, then Data Store.');
  assert.equal(mapped.text, 'Use A P I, then data storage.');
  assert.deepEqual(mapped.spans.map(span => [mapped.written.slice(span.writtenStart, span.writtenEnd), mapped.text.slice(span.spokenStart, span.spokenEnd)]), [
    ['Use ', 'Use '], ['API', 'A P I'], [', then ', ', then '], ['Data Store', 'data storage'], ['.', '.'],
  ]);
});


test('beat-adjacent punctuation uses the same canonical words for voice, captions and markers', async () => {
  const { spokenWords } = await import('../src/narration.ts');
  assert.deepEqual(spokenWords('Hello {pause}, then continue {done}.'), {
    words: ['Hello,', 'then', 'continue.'], markers: [{ beat: 'pause', before: 1 }, { beat: 'done', before: 3 }],
  });
});

test('each beat carries the written words spoken from its marker up to the next marker', async () => {
  const { beatNarration } = await import('../src/narration.ts');
  assert.deepEqual(beatNarration('Before. {merge} Two ledgers  merge, {retry}then a retry {end}.'), { merge: 'Two ledgers merge,', retry: 'then a retry.', end: '' });
  assert.deepEqual(beatNarration('No markers here.'), {});
});

test('common acronyms read the same in every film unless a story gives its own reading', async () => {
  const { storyPronunciations } = await import('../src/narration.ts');
  assert.equal(voicedText('The CLI calls the API.', storyPronunciations({})), 'The C-L-eye calls the A-P-eye.');
  assert.equal(voicedText('The CLI calls the API.', storyPronunciations({ pronunciations: { API: 'app eye' } })), 'The C-L-eye calls the app eye.');
});

// espeak reads a separate letter I as the unstressed pronoun before a verb ("The C L I blocks" became `sˈiː ˈɛl aɪ`,
// heard as "C-L", checked on 2026-10-18), and a separate A as the article.
test('a reading that spells the letter I, or a lone letter A, is reported', async () => {
  const { COMMON_PRONUNCIATIONS, pronunciationErrors } = await import('../src/narration.ts');
  assert.deepEqual(pronunciationErrors({ CLI: 'C L I', AI: 'A-I', XA: 'A I', A12: 'A-twelve', API: 'A-P-eye', IO: 'I O' }), [
    'pronunciation of "CLI" spells the letter I as "I", which the voice reads as an unstressed pronoun; write "eye", hyphenated to its neighbours (for example "C-L-eye")',
    'pronunciation of "AI" spells the letter I as "I", which the voice reads as an unstressed pronoun; write "eye", hyphenated to its neighbours (for example "C-L-eye")',
    'pronunciation of "XA" spells the letter A as a separate word, which the voice reads as the article; hyphenate it to the next letter (for example "A-eye")',
    'pronunciation of "XA" spells the letter I as "I", which the voice reads as an unstressed pronoun; write "eye", hyphenated to its neighbours (for example "C-L-eye")',
    'pronunciation of "IO" spells the letter I as "I", which the voice reads as an unstressed pronoun; write "eye", hyphenated to its neighbours (for example "C-L-eye")',
  ]);
  assert.deepEqual(pronunciationErrors(COMMON_PRONUNCIATIONS), []);
});

test('non-English voice plans retain English terms, canonical spans and German KI letter separation', async () => {
  const { storyVoicePlan, resolvedVoiceInput } = await import('../src/narration.ts');
  const source = '{begin} Die API nutzt KI und Plattformcode.';
  const plan = storyVoicePlan(source, { voice: { lang: 'de' } });
  assert.equal(plan.written, 'Die API nutzt KI und Plattformcode.');
  assert.equal(plan.text, 'Die A-P-eye nutzt K I und platform code.');
  assert.deepEqual(plan.runs, [
    { text: 'Die ', lang: 'de' }, { text: 'A-P-eye', lang: 'en-us' },
    { text: ' nutzt K I und ', lang: 'de' }, { text: 'platform code', lang: 'en-us' }, { text: '.', lang: 'de' },
  ]);
  assert.deepEqual(plan.spans.map(span => [plan.written.slice(span.writtenStart, span.writtenEnd), plan.text.slice(span.spokenStart, span.spokenEnd)]), [
    ['Die ', 'Die '], ['API', 'A-P-eye'], [' nutzt ', ' nutzt '], ['KI', 'K I'], [' und ', ' und '], ['Plattformcode', 'platform code'], ['.', '.'],
  ]);
  assert.deepEqual(resolvedVoiceInput(source, { voice: { lang: 'de' } }), { text: plan.text, runs: plan.runs });
});

test('technical terms match longest first and only on Unicode whole-term boundaries under every non-English narrator', async () => {
  const { storyVoicePlan } = await import('../src/narration.ts');
  for (const lang of ['de', 'fr-fr']) {
    const plan = storyVoicePlan('Workflow Engines, Engine Web-Stack; API APIs; XEngine Engineé.', { voice: { lang } });
    assert.deepEqual(plan.runs.filter(run => run.lang === 'en-us'), [
      { text: 'Workflow Engines', lang: 'en-us' }, { text: 'Engine', lang: 'en-us' },
      { text: 'Web-Stack', lang: 'en-us' }, { text: 'A-P-eye', lang: 'en-us' }, { text: 'A-P-eyes', lang: 'en-us' },
    ]);
    assert.equal(plan.spans[0].writtenEnd, 'Workflow Engines'.length);
  }
});

test('legacy English term overrides retain English language and explicit native readings are rejected', async () => {
  const { storyVoicePlan } = await import('../src/narration.ts');
  assert.deepEqual(storyVoicePlan('API', { voice: { lang: 'de' }, pronunciations: { API: 'app eye' } }).runs, [{ text: 'app eye', lang: 'en-us' }]);
  assert.deepEqual(storyVoicePlan('Widget', { voice: { lang: 'de' }, pronunciations: { Widget: { text: 'Widget', lang: 'en-gb' } } }).runs, [{ text: 'Widget', lang: 'en-gb' }]);
  assert.throws(() => storyVoicePlan('API', { voice: { lang: 'de' }, pronunciations: { API: { text: 'A P I', lang: 'de' } } }), /API.*English/);
});

test('English voice input retains its historical text-only representation and defaults', async () => {
  const { resolvedVoiceInput } = await import('../src/narration.ts');
  assert.deepEqual(resolvedVoiceInput('Engine API Plattformcode.', {}), { text: 'Engine A-P-eye Plattformcode.' });
  assert.deepEqual(resolvedVoiceInput('Hallo.', { voice: { lang: 'de' }, pronunciations: { Absent: { text: 'absent', lang: 'en-us' } } }), { text: 'Hallo.' });
});

test('longer or split native-language overrides cannot mask canonical English terms', async () => {
  const { storyVoicePlan } = await import('../src/narration.ts');
  const overrides: Record<string, import('../src/types.ts').Pronunciation>[] = [
    { 'Die Engine': { text: 'Die Engine', lang: 'de' } },
    { 'Die Engine': 'Der Antrieb' },
    { 'Die Agent': 'Die Agent', Loop: 'Loop' },
  ];
  for (const pronunciations of overrides) {
    assert.throws(() => storyVoicePlan('Die Engine. Die Agent Loop.', { voice: { lang: 'de' }, pronunciations }), /English/);
  }
  assert.throws(() => storyVoicePlan('Widget', { voice: { lang: 'de' }, pronunciations: { Widget: { text: 'Engine', lang: 'de' } } }), /English/);
});
