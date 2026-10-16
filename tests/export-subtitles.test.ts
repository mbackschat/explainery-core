import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExportSubtitles } from '../src/export-subtitles.ts';

test('HTML export reads plain WebVTT cues with identifiers, line breaks and escaped text', () => {
  assert.deepEqual(parseExportSubtitles('\uFEFFWEBVTT\r\n\r\nintro\r\n00:00:00.100 --> 00:00:01.000\r\nA &amp; B\r\n&lt;field&gt;\r\n\r\n00:01.000 --> 00:02.000\r\nNext.\r\n', 2), [
    { start: .1, end: 1, text: 'A & B\n<field>' }, { start: 1, end: 2, text: 'Next.' },
  ]);
});

test('HTML export rejects malformed, unsupported or out-of-range subtitles instead of silently dropping them', () => {
  for (const source of [
    '1\n00:00:00,000 --> 00:00:01,000\nSRT',
    'WEBVTT\n\n',
    'WEBVTT\n\n00:00.500 --> 00:00.100\nReversed',
    'WEBVTT\n\n00:00.000 --> 00:03.000\nToo long',
    'WEBVTT\n\n00:60.000 --> 01:01.000\nInvalid minutes',
    'WEBVTT\n\n00:00.000 --> 00:01.000 align:start\nSettings',
    'WEBVTT\n\n00:00.000 --> 00:01.000\n<b>Markup</b>',
    'WEBVTT\n\n00:00.000 --> 00:01.500\nOne\n\n00:01.000 --> 00:02.000\nOverlap',
  ]) assert.throws(() => parseExportSubtitles(source, 2), /WebVTT|subtitle/i);
});
