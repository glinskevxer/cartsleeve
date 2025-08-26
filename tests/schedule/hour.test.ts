import { beforeEach, describe, expect, it } from 'vitest';
import { fillHour, isCleanHour, musicSlots } from '../../src/schedule/hour.js';
import type { EntrySpec } from '../support/fixtures.js';
import { resetFixtures } from '../support/fixtures.js';
import { clockOf, hourInput, libraryOf, musicClock } from '../support/hour.js';

beforeEach(() => {
  resetFixtures();
});

/** Eight distinct three minute records, all in A. */
const EIGHT: EntrySpec[] = Array.from({ length: 8 }, (_, index) => ({
  number: `M000${index + 1}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
}));

/** Four records all by one artist, so the artist rule has to be relaxed. */
const ONE_ARTIST: EntrySpec[] = Array.from({ length: 4 }, (_, index) => ({
  number: `M000${index + 1}`,
  category: 'A',
  billed: 'Dolly Parton',
  title: `Song ${index + 1}`,
  runtime: '3:00',
}));

describe('fillHour with music only', () => {
  it('fills every slot', () => {
    const outcome = fillHour(hourInput({ clock: musicClock(4), library: libraryOf(EIGHT) }));
    expect(outcome.slots).toHaveLength(4);
    expect(outcome.holes).toBe(0);
    expect(outcome.placed).toHaveLength(4);
    expect(isCleanHour(outcome)).toBe(true);
  });

  it('never plays the same cart twice in the hour', () => {
    const outcome = fillHour(hourInput({ clock: musicClock(4), library: libraryOf(EIGHT) }));
    const carts = outcome.placed.map((each) => each.cart);
    expect(new Set(carts).size).toBe(carts.length);
  });

  it('stacks the placements end to end when nothing overlaps', () => {
    const outcome = fillHour(hourInput({ clock: musicClock(3), library: libraryOf(EIGHT) }));
    expect(outcome.slots.map((slot) => slot.at)).toEqual([0, 1800, 3600]);
    expect(outcome.endsAt).toBe(5400);
  });

  it('starts where it was told to', () => {
    const outcome = fillHour(
      hourInput({ clock: musicClock(2), library: libraryOf(EIGHT), startsAt: 36_000 }),
    );
    expect(outcome.slots[0]?.at).toBe(36_000);
    expect(outcome.endsAt).toBe(36_000 + 3600);
  });

  it('holes every slot when the category is empty', () => {
    const outcome = fillHour(hourInput({ clock: musicClock(3), library: libraryOf([]) }));
    expect(outcome.holes).toBe(3);
    expect(outcome.placed).toEqual([]);
    expect(outcome.slots.every((slot) => slot.hole !== undefined)).toBe(true);
    expect(isCleanHour(outcome)).toBe(false);
  });

  it('says why each hole happened', () => {
    const outcome = fillHour(hourInput({ clock: musicClock(1), library: libraryOf([]) }));
    expect(outcome.slots[0]?.hole?.reason).toBe('no candidates');
  });

  it('gives the same hour on a rerun', () => {
    const once = fillHour(hourInput({ clock: musicClock(4), library: libraryOf(EIGHT) }));
    resetFixtures();
    const again = fillHour(hourInput({ clock: musicClock(4), library: libraryOf(EIGHT) }));
    expect(again.placed.map((each) => each.cart)).toEqual(once.placed.map((each) => each.cart));
  });
});

describe('fillHour with non music elements', () => {
  const withBreak = () =>
    clockOf([
      { kind: 'music', target: '0:00', category: 'A' },
      { kind: 'stopset', target: '3:00', name: 'break one', budget: '2:00' },
      { kind: 'music', target: '5:00', category: 'A' },
      { kind: 'news', target: '8:00', length: '3:00' },
      { kind: 'music', target: '11:00', category: 'A' },
    ]);

  it('places the non music elements and their lengths', () => {
    const outcome = fillHour(hourInput({ clock: withBreak(), library: libraryOf(EIGHT) }));
    expect(outcome.slots).toHaveLength(5);
    expect(outcome.slots[1]?.length).toBe(1200);
    expect(outcome.slots[3]?.length).toBe(1800);
  });

  it('pushes the music later by the length of what sits between', () => {
    const outcome = fillHour(hourInput({ clock: withBreak(), library: libraryOf(EIGHT) }));
    expect(outcome.slots.map((slot) => slot.at)).toEqual([0, 1800, 3000, 4800, 6600]);
  });

  it('gives the music slots back on their own', () => {
    const outcome = fillHour(hourInput({ clock: withBreak(), library: libraryOf(EIGHT) }));
    expect(musicSlots(outcome)).toHaveLength(3);
    expect(musicSlots(outcome).every((slot) => slot.cart !== undefined)).toBe(true);
  });

  it('plays a fixed cart where the clock names it', () => {
    const library = libraryOf([
      ...EIGHT,
      { number: 'J0001', billed: '', category: 'X', runtime: '0:10' },
    ]);
    const clock = clockOf([
      { kind: 'fixed', target: '0:00', cart: 'J0001' },
      { kind: 'music', target: '0:10', category: 'A' },
    ]);
    const outcome = fillHour(hourInput({ clock, library }));
    expect(outcome.slots[0]?.cart).toBe('J0001');
    expect(outcome.slots[0]?.length).toBe(100);
    expect(outcome.slots[1]?.at).toBe(100);
  });

  it('gives a fixed cart no length when the library does not have it', () => {
    const clock = clockOf([
      { kind: 'fixed', target: '0:00', cart: 'J9999' },
      { kind: 'music', target: '0:10', category: 'A' },
    ]);
    const outcome = fillHour(hourInput({ clock, library: libraryOf(EIGHT) }));
    expect(outcome.slots[0]?.length).toBe(0);
    expect(outcome.slots[1]?.at).toBe(0);
  });
});

describe('the times feed back into the rules', () => {
  it('moves every later start when an earlier record is longer', () => {
    const first = EIGHT[0];
    if (first === undefined) {
      throw new Error('fixture missing');
    }
    const shortFirst = libraryOf([{ ...first, runtime: '2:00' }, ...EIGHT.slice(1)]);
    resetFixtures();
    const longFirst = libraryOf([{ ...first, runtime: '5:00' }, ...EIGHT.slice(1)]);
    const short = fillHour(hourInput({ clock: musicClock(3), library: shortFirst }));
    const long = fillHour(hourInput({ clock: musicClock(3), library: longFirst }));
    expect((long.slots[2]?.at ?? 0) - (short.slots[2]?.at ?? 0)).toBe(1800);
  });

  it('overlaps a segue and pulls the rest of the hour earlier', () => {
    const cold = libraryOf(EIGHT.map((spec) => ({ ...spec, endType: 'cold' })));
    resetFixtures();
    const fading = libraryOf(
      EIGHT.map((spec) => ({ ...spec, endType: 'fade', tail: '0:06', intro: '0:09' })),
    );
    const hard = fillHour(hourInput({ clock: musicClock(4), library: cold }));
    const soft = fillHour(hourInput({ clock: musicClock(4), library: fading }));
    expect(soft.endsAt).toBeLessThan(hard.endsAt);
    expect(hard.endsAt - soft.endsAt).toBe(3 * 60);
  });

  it('does not overlap across a hole', () => {
    const outcome = fillHour(hourInput({ clock: musicClock(2), library: libraryOf([]) }));
    expect(outcome.slots.map((slot) => slot.at)).toEqual([0, 0]);
  });

  it('leaves an hour of segues shorter than the sum of its runtimes', () => {
    const fading = libraryOf(
      EIGHT.map((spec) => ({ ...spec, endType: 'fade', tail: '0:06', intro: '0:09' })),
    );
    const outcome = fillHour(hourInput({ clock: musicClock(5), library: fading }));
    const naive = outcome.slots.reduce((sum, slot) => sum + slot.length, 0);
    expect(outcome.endsAt).toBeLessThan(naive);
  });
});

describe('breaches', () => {
  it('counts a slot filled only after relaxing', () => {
    const outcome = fillHour(hourInput({ clock: musicClock(3), library: libraryOf(ONE_ARTIST) }));
    expect(outcome.holes).toBe(0);
    expect(outcome.breaches).toBeGreaterThan(0);
    expect(isCleanHour(outcome)).toBe(false);
  });

  it('names what was given up on each breached slot', () => {
    const outcome = fillHour(hourInput({ clock: musicClock(3), library: libraryOf(ONE_ARTIST) }));
    const breached = musicSlots(outcome).filter((slot) => (slot.placement?.relaxedBy ?? 0) > 0);
    expect(breached.length).toBeGreaterThan(0);
    expect(breached[0]?.placement?.breached).toContain('artist separation');
  });

  it('leaves holes instead when the floor forbids the relaxation', () => {
    const outcome = fillHour(
      hourInput({ clock: musicClock(3), library: libraryOf(ONE_ARTIST), floor: 2 }),
    );
    expect(outcome.holes).toBeGreaterThan(0);
  });

  it('trades holes for breaches as the floor moves', () => {
    const loose = fillHour(hourInput({ clock: musicClock(3), library: libraryOf(ONE_ARTIST) }));
    resetFixtures();
    const strict = fillHour(
      hourInput({ clock: musicClock(3), library: libraryOf(ONE_ARTIST), floor: 2 }),
    );
    expect(loose.holes).toBeLessThan(strict.holes);
    expect(loose.breaches).toBeGreaterThan(strict.breaches);
  });
});
