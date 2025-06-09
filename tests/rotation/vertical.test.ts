import { describe, expect, it } from 'vitest';
import {
  HOURS,
  clumped,
  concentration,
  hourCounts,
  hourSpread,
  locksToHour,
  repeatDays,
  spreadsFor,
} from '../../src/rotation/vertical.js';
import { cellOf } from '../../src/domain/daypart.js';
import type { Play } from '../../src/rotation/rest.js';
import type { CartNumber } from '../../src/util/ids.js';

const cart = (value: string): CartNumber => value as CartNumber;

let clock = 0;
function play(number: string, day: number, hour: number): Play {
  clock += 1;
  return { cart: cart(number), at: clock, cell: cellOf(day, hour) };
}

/** M0001 lands at 08 every day; M0002 moves around. */
const PLAYS: Play[] = [
  play('M0001', 1, 8),
  play('M0001', 2, 8),
  play('M0001', 3, 8),
  play('M0001', 4, 8),
  play('M0002', 1, 8),
  play('M0002', 2, 13),
  play('M0002', 3, 19),
  play('M0002', 4, 22),
];

describe('hourCounts', () => {
  it('counts a cart into the hour of day it landed in', () => {
    const counts = hourCounts(PLAYS, cart('M0001'));
    expect(counts).toHaveLength(HOURS);
    expect(counts[8]).toBe(4);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(4);
  });

  it('spreads a cart that moves around', () => {
    const counts = hourCounts(PLAYS, cart('M0002'));
    expect(counts[8]).toBe(1);
    expect(counts[13]).toBe(1);
    expect(counts[22]).toBe(1);
  });

  it('counts nothing for a cart that never played', () => {
    expect(hourCounts(PLAYS, cart('M9999')).every((count) => count === 0)).toBe(true);
  });

  it('counts the same hour on different days together', () => {
    const twice = [play('M0003', 1, 6), play('M0003', 5, 6)];
    expect(hourCounts(twice, cart('M0003'))[6]).toBe(2);
  });
});

describe('hourSpread', () => {
  it('finds the hour a cart lands in most', () => {
    const measured = hourSpread(PLAYS, cart('M0001'));
    expect(measured.heaviest).toBe(8);
    expect(measured.heaviestCount).toBe(4);
    expect(measured.plays).toBe(4);
  });

  it('calls a cart that only uses one hour perfectly balanced within it', () => {
    expect(hourSpread(PLAYS, cart('M0001')).imbalance).toBe(0);
  });

  it('calls a cart spread across four hours balanced too', () => {
    expect(hourSpread(PLAYS, cart('M0002')).imbalance).toBe(0);
  });

  it('measures imbalance across the hours it actually reached', () => {
    const skewed = [
      play('M0004', 1, 8),
      play('M0004', 2, 8),
      play('M0004', 3, 8),
      play('M0004', 4, 15),
    ];
    const measured = hourSpread(skewed, cart('M0004'));
    expect(measured.imbalance).toBeGreaterThan(0);
    expect(measured.imbalance).toBeLessThan(1);
  });

  it('scores a restricted cart against only the hours it can reach', () => {
    const morning = [play('M0005', 1, 7), play('M0005', 2, 8), play('M0005', 3, 9)];
    const unrestricted = hourSpread(morning, cart('M0005'));
    const restricted = hourSpread(morning, cart('M0005'), [6, 7, 8, 9]);
    expect(unrestricted.imbalance).toBe(0);
    expect(restricted.imbalance).toBeGreaterThan(0);
    expect(restricted.imbalance).toBeLessThan(1);
  });

  it('reports a cart that never played as empty', () => {
    const measured = hourSpread(PLAYS, cart('M9999'));
    expect(measured.plays).toBe(0);
    expect(measured.heaviestCount).toBe(0);
    expect(measured.imbalance).toBe(0);
  });

  it('measures every cart asked for', () => {
    expect(spreadsFor(PLAYS, [cart('M0001'), cart('M0002')]).map((s) => s.cart)).toEqual([
      'M0001',
      'M0002',
    ]);
  });
});

describe('concentration', () => {
  it('is one when every play is in the same hour', () => {
    expect(concentration(hourSpread(PLAYS, cart('M0001')))).toBe(1);
  });

  it('falls as the plays spread out', () => {
    expect(concentration(hourSpread(PLAYS, cart('M0002')))).toBe(0.25);
  });

  it('is zero for a cart that never played', () => {
    expect(concentration(hourSpread(PLAYS, cart('M9999')))).toBe(0);
  });
});

describe('clumped', () => {
  const spreads = () => spreadsFor(PLAYS, [cart('M0001'), cart('M0002'), cart('M9999')]);

  it('finds the cart stuck on one hour', () => {
    expect(clumped(spreads(), 0.9).map((each) => each.cart)).toEqual(['M0001']);
  });

  it('finds nothing when nothing meets the threshold', () => {
    expect(clumped(spreads(), 1.1)).toEqual([]);
  });

  it('leaves out a cart with too few plays to judge', () => {
    const fresh = [play('M0006', 1, 8), play('M0006', 2, 8)];
    const measured = spreadsFor(fresh, [cart('M0006')]);
    expect(clumped(measured, 0.9)).toEqual([]);
    expect(clumped(measured, 0.9, 2)).toHaveLength(1);
  });
});

describe('repeatDays', () => {
  it('locks a cart to one hour when the cycle divides a day', () => {
    expect(repeatDays(24)).toBe(1);
    expect(repeatDays(12)).toBe(1);
    expect(repeatDays(8)).toBe(1);
    expect(locksToHour(24)).toBe(true);
    expect(locksToHour(12)).toBe(true);
  });

  it('takes several days to come round on a cycle that does not divide a day', () => {
    expect(repeatDays(5)).toBe(5);
    expect(repeatDays(7)).toBe(7);
    expect(repeatDays(9)).toBe(3);
    expect(locksToHour(5)).toBe(false);
  });

  it('never comes round on a fractional cycle', () => {
    expect(repeatDays(4.5)).toBe(Number.POSITIVE_INFINITY);
    expect(locksToHour(4.5)).toBe(false);
  });

  it('never comes round on an impossible cycle', () => {
    expect(repeatDays(0)).toBe(Number.POSITIVE_INFINITY);
    expect(repeatDays(-3)).toBe(Number.POSITIVE_INFINITY);
    expect(repeatDays(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it('shows why a 48 hour cycle is still a fixed hour', () => {
    expect(repeatDays(48)).toBe(2);
    expect(locksToHour(48)).toBe(false);
  });
});
