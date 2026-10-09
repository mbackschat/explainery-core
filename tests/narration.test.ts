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
