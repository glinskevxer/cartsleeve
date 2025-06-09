import { describe, expect, it } from 'vitest';
import {
  categoryImbalance,
  daypartCounts,
  daypartSpread,
  spreadsFor,
  staleness,
  stuck,
} from '../../src/rotation/horizontal.js';
import { WEEKDAYS, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import type { Play } from '../../src/rotation/rest.js';
import type { CartNumber } from '../../src/util/ids.js';
import { expectOk } from '../support/result.js';

const cart = (value: string): CartNumber => value as CartNumber;

const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));
const MID = expectOk(makeDaypart('MID', [{ days: [...WEEKDAYS], fromHour: 10, toHour: 15 }]));
const PMD = expectOk(makeDaypart('PMD', [{ days: [...WEEKDAYS], fromHour: 15, toHour: 19 }]));
const DAYPARTS = [AMD, MID, PMD];

let clock = 0;
function play(number: string, day: number, hour: number): Play {
  clock += 1;
  return { cart: cart(number), at: clock, cell: cellOf(day, hour) };
}

/** M0001 only ever airs in morning drive; M0002 is spread evenly. */
const PLAYS: Play[] = [
  play('M0001', 1, 7),
  play('M0002', 1, 7),
  play('M0001', 2, 8),
  play('M0002', 2, 12),
  play('M0001', 3, 7),
  play('M0002', 3, 16),
  play('M0001', 4, 9),
  play('M0003', 0, 3),
];

describe('daypartCounts', () => {
  it('counts a cart into the daypart each play landed in', () => {
    expect(daypartCounts(PLAYS, DAYPARTS, cart('M0001'))).toEqual([4, 0, 0]);
    expect(daypartCounts(PLAYS, DAYPARTS, cart('M0002'))).toEqual([1, 1, 1]);
  });

  it('counts nothing for a cart that never played', () => {
    expect(daypartCounts(PLAYS, DAYPARTS, cart('M9999'))).toEqual([0, 0, 0]);
  });

  it('counts a play in an unclaimed hour nowhere', () => {
    expect(daypartCounts(PLAYS, DAYPARTS, cart('M0003'))).toEqual([0, 0, 0]);
  });

  it('counts nothing when there are no dayparts', () => {
    expect(daypartCounts(PLAYS, [], cart('M0001'))).toEqual([]);
  });
});

describe('daypartSpread', () => {
  it('calls a cart stuck in one daypart maximally imbalanced', () => {
    const measured = daypartSpread(PLAYS, DAYPARTS, cart('M0001'));
    expect(measured.plays).toBe(4);
    expect(measured.imbalance).toBeCloseTo(1);
    expect(measured.unheardNames).toEqual(['MID', 'PMD']);
  });

  it('calls an evenly spread cart balanced', () => {
    const measured = daypartSpread(PLAYS, DAYPARTS, cart('M0002'));
    expect(measured.plays).toBe(3);
    expect(measured.imbalance).toBe(0);
    expect(measured.unheardNames).toEqual([]);
  });

  it('reports a cart that never played as unheard everywhere', () => {
    const measured = daypartSpread(PLAYS, DAYPARTS, cart('M9999'));
    expect(measured.plays).toBe(0);
    expect(measured.imbalance).toBe(0);
    expect(measured.unheardNames).toEqual(['AMD', 'MID', 'PMD']);
  });

  it('measures a partial imbalance between the two ends', () => {
    const skewed = [
      play('M0004', 1, 7),
      play('M0004', 2, 7),
      play('M0004', 3, 7),
      play('M0004', 1, 12),
    ];
    const measured = daypartSpread(skewed, DAYPARTS, cart('M0004'));
    expect(measured.imbalance).toBeGreaterThan(0);
    expect(measured.imbalance).toBeLessThan(1);
  });

  it('measures every cart asked for', () => {
    const measured = spreadsFor(PLAYS, DAYPARTS, [cart('M0001'), cart('M0002')]);
    expect(measured.map((each) => each.cart)).toEqual(['M0001', 'M0002']);
  });
});

describe('stuck', () => {
  const spreads = () => spreadsFor(PLAYS, DAYPARTS, [cart('M0001'), cart('M0002'), cart('M9999')]);

  it('reports a cart above the threshold', () => {
    expect(stuck(spreads(), 0.9).map((each) => each.cart)).toEqual(['M0001']);
  });

  it('reports nothing when the threshold is above everything', () => {
    expect(stuck(spreads(), 1.1)).toEqual([]);
  });

  it('leaves out a cart with too few plays to have spread', () => {
    const fresh = [play('M0005', 1, 7), play('M0005', 2, 7)];
    const measured = spreadsFor(fresh, DAYPARTS, [cart('M0005')]);
    expect(measured[0]?.imbalance).toBeCloseTo(1);
    expect(stuck(measured, 0.5)).toEqual([]);
    expect(stuck(measured, 0.5, 2)).toHaveLength(1);
  });

  it('leaves out a cart that never played at all', () => {
    expect(stuck(spreads(), 0).map((each) => each.cart)).not.toContain('M9999');
  });
});

describe('staleness', () => {
  it('counts the plays elsewhere since it last aired in that daypart', () => {
    const ordered = [play('M0006', 1, 7), play('M0006', 1, 12), play('M0006', 1, 16)];
    expect(staleness(ordered, DAYPARTS, cart('M0006'), 0)).toBe(2);
    expect(staleness(ordered, DAYPARTS, cart('M0006'), 2)).toBe(0);
  });

  it('is infinite when the cart has never aired in that daypart', () => {
    expect(staleness(PLAYS, DAYPARTS, cart('M0001'), 1)).toBe(Number.POSITIVE_INFINITY);
    expect(staleness(PLAYS, DAYPARTS, cart('M9999'), 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is zero for a daypart it just aired in', () => {
    expect(staleness(PLAYS, DAYPARTS, cart('M0001'), 0)).toBe(0);
  });

  it('is nothing for a daypart index that does not exist', () => {
    expect(staleness(PLAYS, DAYPARTS, cart('M0001'), 9)).toBe(0);
  });

  it('would break the tie between two equally rested carts', () => {
    const stale = staleness(PLAYS, DAYPARTS, cart('M0002'), 0);
    const fresh = staleness(PLAYS, DAYPARTS, cart('M0001'), 0);
    expect(stale).toBeGreaterThan(fresh);
  });
});

describe('categoryImbalance', () => {
  it('averages the carts that have played', () => {
    const measured = spreadsFor(PLAYS, DAYPARTS, [cart('M0001'), cart('M0002')]);
    expect(categoryImbalance(measured)).toBeCloseTo(0.5);
  });

  it('ignores carts that have never played', () => {
    const measured = spreadsFor(PLAYS, DAYPARTS, [cart('M0002'), cart('M9999')]);
    expect(categoryImbalance(measured)).toBe(0);
  });

  it('is zero when nothing has played at all', () => {
    expect(categoryImbalance(spreadsFor([], DAYPARTS, [cart('M0001')]))).toBe(0);
    expect(categoryImbalance([])).toBe(0);
  });
});
