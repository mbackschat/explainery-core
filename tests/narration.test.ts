import assert from 'node:assert/strict';
import test from 'node:test';
import { spokenText, voicedText } from '../src/index.ts';

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
