import assert from 'node:assert/strict';
import test from 'node:test';
import { spokenText, voicedText } from '../src/index.ts';

test('a draft voice speaks each word in its pronunciation, while readers still see the written word', () => {
  const narration = 'The DG SPI {spi} serves GraalJS hosts.';
  const pronunciations = { SPI: 'S-P-I', GraalJS: 'Graal J-S' };
  assert.equal(voicedText(narration, pronunciations), 'The DG S-P-I serves Graal J-S hosts.');
  assert.equal(spokenText(narration), 'The DG SPI serves GraalJS hosts.');
});

test('a pronunciation replaces whole words only, beside punctuation, and is case-sensitive', () => {
  const pronunciations = { SPI: 'S-P-I', 'C++': 'C plus plus' };
  assert.equal(voicedText('SPI: SPIs, (SPI), spi, ESPI and C++.', pronunciations), 'S-P-I: SPIs, (S-P-I), spi, ESPI and C plus plus.');
});

test('without pronunciations the voiced text is the spoken text', () => {
  assert.equal(voicedText('Say {wave} hello.'), 'Say hello.');
});
