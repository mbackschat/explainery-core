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
