import { describe, expect, it } from 'vitest';
import {
  effectiveTurnover,
  exposureOf,
  exposureSpread,
  exposures,
  poolPerCell,
  unreachable,
} from '../../src/rotation/effective.js';
import type { EffectiveInput } from '../../src/rotation/effective.js';
import { demandOf, nominalTurnover } from '../../src/rotation/turnover.js';
import { makeClock } from '../../src/domain/clock.js';
import { makeGrid } from '../../src/domain/grid.js';
import { EVERY_DAY, WEEKDAYS, makeDaypart } from '../../src/domain/daypart.js';
import { NO_RESTRICTIONS, makeRestrictionMap } from '../../src/library/restriction.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { expectOk } from '../support/result.js';

const cart = (value: string): CartNumber => value as CartNumber;
const A = 'A' as CategoryCode;

const FLAT = expectOk(makeClock('FLAT', [{ kind: 'music', target: '0:00', category: 'A' }]));
const GRID = expectOk(
  makeGrid('flat', [{ days: [...EVERY_DAY], fromHour: 0, toHour: 24, clock: 'FLAT' }], [FLAT]),
);
const PROFILE = demandOf(GRID, [FLAT]);

const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));

const CARTS = [cart('M0001'), cart('M0002'), cart('M0003'), cart('M0004')];

const denying = (...numbers: string[]) =>
  expectOk(
    makeRestrictionMap(
      numbers.map((number) => ({ cart: cart(number), mode: 'deny' as const, dayparts: ['AMD'] })),
      [AMD],
    ),
  );

const input = (over: Partial<EffectiveInput> = {}): EffectiveInput => ({
  profile: PROFILE,
  restrictions: NO_RESTRICTIONS,
  category: A,
  carts: CARTS,
  ...over,
});

describe('poolPerCell', () => {
  it('is the whole category everywhere when nothing is restricted', () => {
    const pool = poolPerCell(input());
    expect(pool).toHaveLength(168);
    expect(new Set(pool)).toEqual(new Set([4]));
  });

  it('shrinks only in the cells the restriction covers', () => {
    const pool = poolPerCell(input({ restrictions: denying('M0001') }));
    expect(pool[7 + 24]).toBe(3);
    expect(pool[12 + 24]).toBe(4);
    expect(pool[7]).toBe(4);
  });

  it('is empty for an empty category', () => {
    expect(new Set(poolPerCell(input({ carts: [] })))).toEqual(new Set([0]));
  });
});

describe('with nothing restricted, effective agrees with nominal', () => {
  it('gives every cart the same exposure', () => {
    const measured = exposures(input());
    expect(new Set(measured.map((e) => e.expectedPlays))).toHaveLength(1);
    expect(measured[0]?.expectedPlays).toBe(168 / 4);
    expect(measured[0]?.reachableSlots).toBe(168);
  });

  it('matches the nominal turnover exactly', () => {
    const nominal = nominalTurnover(PROFILE, A, CARTS.length);
    expect(effectiveTurnover(input()).hours).toBeCloseTo(nominal.hours);
  });

  it('shows no spread between carts', () => {
    const spread = exposureSpread(input());
    expect(spread.fastest).toBeCloseTo(spread.slowest);
  });
});

describe('restriction changes what turnover measures', () => {
  const restricted = () => input({ restrictions: denying('M0001') });

  it('gives the restricted cart fewer reachable slots', () => {
    const pool = poolPerCell(restricted());
    expect(exposureOf(restricted(), pool, cart('M0001')).reachableSlots).toBe(168 - 20);
    expect(exposureOf(restricted(), pool, cart('M0002')).reachableSlots).toBe(168);
  });

  it('makes the unrestricted carts play more often, not fewer', () => {
    const pool = poolPerCell(restricted());
    const free = exposureOf(restricted(), pool, cart('M0002'));
    const held = exposureOf(restricted(), pool, cart('M0001'));
    expect(free.expectedPlays).toBeGreaterThan(168 / 4);
    expect(held.expectedPlays).toBeLessThan(free.expectedPlays);
  });

  it('opens a spread between the fastest and slowest cart', () => {
    const spread = exposureSpread(restricted());
    expect(spread.fastest).toBeLessThan(spread.slowest);
  });

  it('leaves the nominal figure unable to see any of it', () => {
    const nominal = nominalTurnover(PROFILE, A, CARTS.length);
    const free = nominalTurnover(PROFILE, A, CARTS.length);
    expect(nominal.hours).toBe(free.hours);
    expect(exposureSpread(restricted()).fastest).not.toBeCloseTo(nominal.hours);
  });

  it('leaves the aggregate turnover exactly where it was', () => {
    expect(effectiveTurnover(restricted()).hours).toBeCloseTo(effectiveTurnover(input()).hours);
    expect(effectiveTurnover(restricted()).hours).toBeCloseTo(
      nominalTurnover(PROFILE, A, CARTS.length).hours,
    );
  });

  it('conserves the total demand while redistributing it', () => {
    const before = exposures(input()).reduce((sum, e) => sum + e.expectedPlays, 0);
    const after = exposures(restricted()).reduce((sum, e) => sum + e.expectedPlays, 0);
    expect(after).toBeCloseTo(before);
    expect(after).toBeCloseTo(168);
  });

  it('is why one turnover number cannot show the problem at all', () => {
    expect(effectiveTurnover(restricted()).hours).toBeCloseTo(effectiveTurnover(input()).hours);
    expect(exposureSpread(restricted()).slowest).toBeGreaterThan(exposureSpread(input()).slowest);
  });

  it('moves further as more of the category is restricted', () => {
    const one = exposureSpread(input({ restrictions: denying('M0001') }));
    const three = exposureSpread(input({ restrictions: denying('M0001', 'M0002', 'M0003') }));
    expect(three.slowest - three.fastest).toBeGreaterThan(one.slowest - one.fastest);
  });

  it('gives the same answer whichever cart is restricted', () => {
    const first = exposureSpread(input({ restrictions: denying('M0001') }));
    const second = exposureSpread(input({ restrictions: denying('M0004') }));
    expect(second.fastest).toBeCloseTo(first.fastest);
    expect(second.slowest).toBeCloseTo(first.slowest);
  });
});

describe('the edges', () => {
  it('reports an empty category as never turning over', () => {
    const turnover = effectiveTurnover(input({ carts: [] }));
    expect(turnover.hours).toBe(Number.POSITIVE_INFINITY);
    expect(turnover.size).toBe(0);
  });

  it('reports a category nothing asks for as never turning over', () => {
    const turnover = effectiveTurnover(input({ category: 'Z' as CategoryCode }));
    expect(turnover.hours).toBe(Number.POSITIVE_INFINITY);
    expect(unreachable(input({ category: 'Z' as CategoryCode }))).toEqual(CARTS);
  });

  it('finds a cart that can never play', () => {
    const parked = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'allow', dayparts: [] }], [AMD]),
    );
    expect(unreachable(input({ restrictions: parked }))).toEqual([cart('M0001')]);
  });

  it('finds nothing unreachable when every cart can play', () => {
    expect(unreachable(input())).toEqual([]);
  });

  it('reports an infinite spread when nothing can play at all', () => {
    const spread = exposureSpread(input({ carts: [] }));
    expect(spread.fastest).toBe(Number.POSITIVE_INFINITY);
    expect(spread.slowest).toBe(Number.POSITIVE_INFINITY);
  });
});
