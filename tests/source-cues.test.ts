import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSrt } from '../.agents/skills/analyze-source-film/scripts/source-cues.ts';

test('preserves source cue identifiers, empty cues, multiline text, and overlaps', () => {
  assert.deepEqual(parseSrt([
    '4',
    '00:00:01,250 --> 00:00:04,000',
    '  Original wording',
    'Second line  ',
    '',
    '9',
    '00:00:03,500 --> 00:00:03,750',
    '',
    '12',
    '01:02:03,004 --> 01:02:04,005',
    'After the empty cue',
    '',
  ].join('\n')), [
    {
      cue: 4,
      sourceCue: '4',
      sourceStart: '00:00:01,250',
      sourceEnd: '00:00:04,000',
      startSeconds: 1.25,
      endSeconds: 4,
      text: '  Original wording\nSecond line  ',
    },
    {
      cue: 9,
      sourceCue: '9',
      sourceStart: '00:00:03,500',
      sourceEnd: '00:00:03,750',
      startSeconds: 3.5,
      endSeconds: 3.75,
      text: '',
    },
    {
      cue: 12,
      sourceCue: '12',
      sourceStart: '01:02:03,004',
      sourceEnd: '01:02:04,005',
      startSeconds: 3723.004,
      endSeconds: 3724.005,
      text: 'After the empty cue',
    },
  ]);
});

test('accepts a BOM, CRLF line endings, and a final empty cue', () => {
  assert.deepEqual(parseSrt('\uFEFF1\r\n00:00:00,000 --> 00:00:00,500\r\nHello\r\n\r\n2\r\n00:00:00,500 --> 00:00:01,000\r\n').map(cue => cue.text), ['Hello', '']);
});

test('rejects malformed cue identifiers and timing instead of dropping evidence', () => {
  for (const input of [
    'not-a-cue\n00:00:00,000 --> 00:00:01,000\nText',
    '1\n00:00:00,000 -> 00:00:01,000\nText',
    '1\n00:60:00,000 --> 01:00:01,000\nText',
    '1\n00:00:60,000 --> 00:01:01,000\nText',
    '1\n00:00:00.000 --> 00:00:01,000\nText',
    '1\n00:00:00,00 --> 00:00:01,000\nText',
    '1\n',
  ]) {
    assert.throws(() => parseSrt(input), /cue|timing/i, input);
  }
});

test('rejects zero or negative cue durations', () => {
  for (const end of ['00:00:01,000', '00:00:00,999']) {
    assert.throws(() => parseSrt(`1\n00:00:01,000 --> ${end}\nText`), /duration/i);
  }
});

test('rejects duplicate numeric cue identifiers', () => {
  assert.throws(() => parseSrt('1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n01\n00:00:01,000 --> 00:00:02,000\nSecond'), /duplicate.*1/i);
});

test('preserves the source spelling of a cue identifier', () => {
  const [cue] = parseSrt('001\n00:00:00,000 --> 00:00:01,000\nText');
  assert.equal(cue.cue, 1);
  assert.equal(cue.sourceCue, '001');
});
