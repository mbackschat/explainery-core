import { toMillisecond } from './time.ts';
import type { Timing } from './types.ts';

const SECONDS = /^\d*\.?\d+$/;
// The last signed number of a name. Composition and beat ids are kebab-case slugs (schemas/story.schema.json), so
// a `-1` suffix can belong to an id; splitOffset() therefore tries the whole name first.
const OFFSET = /^(.+?)([+-]\d*\.?\d+)$/;

export interface SnapshotTime { address: string; at: number }

/**
 * Resolves a comma-separated list of snapshot addresses to film seconds, in the given order.
 *
 * An address is absolute film seconds (`12.5`), a composition start (`checkout`), or a beat
 * (`checkout:merge`), each name optionally followed by a signed offset in seconds (`checkout:merge+2`,
 * `checkout:merge-0.5`, `checkout+1`). Beat seconds in timing.json are local to their composition, so a beat
 * resolves to `scenes[composition].start + beats[beat] + offset`. A name that exists as written wins over reading
 * its numeric suffix as an offset, so the beat `step-2` stays addressable beside a beat `step`. Every resolved time
 * must lie within the film, because HyperFrames would otherwise capture a frame that no viewer can reach.
 */
export function snapshotTimes(timing: Timing, list: string): SnapshotTime[] {
  return list.split(',').map(item => item.trim()).map(address => {
    if (!address) throw new Error('empty snapshot address in --at');
    const at = toMillisecond(SECONDS.test(address) ? Number(address) : addressSeconds(timing, address));
    if (at < 0 || at > timing.duration) throw new Error(`snapshot address "${address}" resolves to ${at}s, outside the film (0–${timing.duration}s)`);
    return { address, at };
  });
}

function addressSeconds(timing: Timing, address: string): number {
  const colon = address.indexOf(':');
  if (colon < 0) {
    const composition = splitOffset(address, id => Object.hasOwn(timing.scenes, id));
    if (!composition.found) throw new Error(`snapshot address "${address}": unknown composition "${composition.name}"`);
    return timing.scenes[composition.name].start + composition.offset;
  }
  const id = address.slice(0, colon);
  const slot = Object.hasOwn(timing.scenes, id) ? timing.scenes[id] : undefined;
  if (!slot) throw new Error(`snapshot address "${address}": unknown composition "${id}"`);
  const beat = splitOffset(address.slice(colon + 1), name => Object.hasOwn(slot.beats, name));
  if (!beat.found) {
    const beats = Object.keys(slot.beats);
    throw new Error(`snapshot address "${address}": composition "${id}" has no beat "${beat.name}"; ${beats.length ? `its beats are ${beats.join(', ')}` : 'it has no beats'}`);
  }
  return slot.start + slot.beats[beat.name] + beat.offset;
}

// Splits a name from its optional offset. When neither reading exists, `name` is the one to report as unknown.
function splitOffset(text: string, exists: (name: string) => boolean): { found: boolean; name: string; offset: number } {
  if (exists(text)) return { found: true, name: text, offset: 0 };
  const match = OFFSET.exec(text);
  if (!match) return { found: false, name: text, offset: 0 };
  return { found: exists(match[1]), name: match[1], offset: Number(match[2]) };
}
