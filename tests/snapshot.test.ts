import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotTimes } from '../src/snapshot.ts';
import type { Timing } from '../src/types.ts';

const timing: Timing = {
  source: 'aligned', duration: 20,
  scenes: {
    intro: { start: 0, duration: 4, beats: {} },
    checkout: { start: 4.1, duration: 9, beats: { merge: 1.2, 'step-2': 3, step: 2.5 } },
    'part-2': { start: 13.1, duration: 6.9, beats: { retry: .4 } },
  },
};
const at = (list: string) => snapshotTimes(timing, list).map(time => time.at);

test('absolute seconds pass through, and a composition alone addresses its start', () => {
  assert.deepEqual(at('0,2.5,20'), [0, 2.5, 20]);
  assert.deepEqual(at('checkout,part-2'), [4.1, 13.1]);
});

test('a beat address resolves through timing.json as composition start plus beat plus offset', () => {
  assert.deepEqual(at('checkout:merge,checkout:merge+2,checkout:merge-0.5,part-2:retry+.1'), [5.3, 7.3, 4.8, 13.6]);
  assert.deepEqual(at('checkout+1.5,part-2-1'), [5.6, 12.1]);
  assert.deepEqual(snapshotTimes(timing, ' checkout:merge , 3 '), [{ address: 'checkout:merge', at: 5.3 }, { address: '3', at: 3 }]);
});

test('an id that itself ends in a signed number wins over reading that number as an offset', () => {
  assert.deepEqual(at('checkout:step-2,checkout:step-2-1,part-2'), [7.1, 6.1, 13.1]);
});

test('unknown compositions and beats, empty items and times outside the film fail with the address named', () => {
  for (const [list, message] of [
    ['payments:merge', /"payments:merge".*unknown composition "payments"/],
    ['payments+2', /unknown composition "payments"/],
    ['toString', /unknown composition "toString"/],
    ['checkout:constructor', /no beat "constructor"/],
    ['checkout:mrege+2', /"checkout:mrege\+2".*composition "checkout" has no beat "mrege".*merge, step-2, step/],
    ['intro:merge', /composition "intro" has no beat "merge".*no beats/],
    ['checkout:merge+x', /no beat "merge\+x"/],
    ['3,,4', /empty snapshot address/],
    ['', /empty snapshot address/],
    ['part-2:retry+10', /"part-2:retry\+10" resolves to 23.5s, outside the film \(0–20s\)/],
    ['intro-1', /resolves to -1s, outside the film/],
  ] as const) assert.throws(() => snapshotTimes(timing, list), message, list);
});
