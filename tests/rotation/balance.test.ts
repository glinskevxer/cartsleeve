import { describe, expect, it } from 'vitest';
import {
  concentration,
  meanImbalance,
  measureBalance,
  overThreshold,
} from '../../src/rotation/balance.js';
import type { Balance } from '../../src/rotation/balance.js';
import { cellOf, hourOfCell } from '../../src/domain/daypart.js';
import type { Play } from '../../src/rotation/rest.js';
import type { CartNumber } from '../../src/util/ids.js';

const cart = (value: string): CartNumber => value as CartNumber;

let clock = 0;
function play(number: string, day: number, hour: number): Play {
  clock += 1;
  return { cart: cart(number), at: clock, cell: cellOf(day, hour) };
}

const BY_HOUR = { buckets: 24, bucketOf: hourOfCell };

describe('measureBalance', () => {
  it('counts a cart into its buckets and totals the plays', () => {
    const plays = [play('M0001', 1, 8), play('M0001', 2, 8), play('M0001', 3, 12)];
    const balance = measureBalance(plays, cart('M0001'), BY_HOUR);
    expect(balance.counts).toHaveLength(24);
    expect(balance.counts[8]).toBe(2);
    expect(balance.counts[12]).toBe(1);
    expect(balance.plays).toBe(3);
  });

  it('ignores plays by another cart', () => {
    const plays = [play('M0001', 1, 8), play('M0002', 1, 8)];
    expect(measureBalance(plays, cart('M0001'), BY_HOUR).plays).toBe(1);
  });

  it('ignores a play no bucket claims', () => {
    const plays = [play('M0001', 1, 8)];
    const balance = measureBalance(plays, cart('M0001'), {
      buckets: 2,
      bucketOf: () => -1,
    });
    expect(balance.plays).toBe(0);
  });

  it('ignores a bucket number past the end', () => {
    const plays = [play('M0001', 1, 8)];
    expect(measureBalance(plays, cart('M0001'), { buckets: 2, bucketOf: () => 9 }).plays).toBe(0);
  });

  it('finds the heaviest bucket and keeps the first on a tie', () => {
    const plays = [play('M0001', 1, 8), play('M0001', 2, 12)];
    const balance = measureBalance(plays, cart('M0001'), BY_HOUR);
    expect(balance.heaviest).toBe(8);
    expect(balance.heaviestCount).toBe(1);
  });

  it('measures the spread over the reached buckets by default', () => {
    const plays = [play('M0001', 1, 8), play('M0001', 2, 12)];
    expect(measureBalance(plays, cart('M0001'), BY_HOUR).imbalance).toBe(0);
  });

  it('measures over an explicit scope when one is given', () => {
    const plays = [play('M0001', 1, 8), play('M0001', 2, 8)];
    const scoped = measureBalance(plays, cart('M0001'), {
      ...BY_HOUR,
      reachable: [6, 7, 8, 9],
    });
    expect(scoped.imbalance).toBeCloseTo(1);
    expect(measureBalance(plays, cart('M0001'), BY_HOUR).imbalance).toBe(0);
  });

  it('reports the unheard buckets against the scope, not against what it reached', () => {
    const plays = [play('M0001', 1, 8)];
    // with no scope given, every bucket but the one it reached is unheard
    expect(measureBalance(plays, cart('M0001'), BY_HOUR).unheard).toHaveLength(23);
    expect(measureBalance(plays, cart('M0001'), BY_HOUR).unheard).not.toContain(8);
    // with a scope, only the scope is reported on
    expect(
      measureBalance(plays, cart('M0001'), { ...BY_HOUR, reachable: [6, 7, 8, 9] }).unheard,
    ).toEqual([6, 7, 9]);
  });

  it('reports a cart that never played as empty', () => {
    const balance = measureBalance([], cart('M0001'), BY_HOUR);
    expect(balance.plays).toBe(0);
    expect(balance.heaviestCount).toBe(0);
    expect(balance.imbalance).toBe(0);
  });
});

describe('concentration', () => {
  it('is the heaviest bucket over the total', () => {
    const plays = [play('M0001', 1, 8), play('M0001', 2, 8), play('M0001', 3, 12)];
    expect(concentration(measureBalance(plays, cart('M0001'), BY_HOUR))).toBeCloseTo(2 / 3);
  });

  it('is zero for a cart that never played', () => {
    expect(concentration(measureBalance([], cart('M0001'), BY_HOUR))).toBe(0);
  });
});

describe('overThreshold', () => {
  const balances = (): Balance[] => [
    measureBalance([play('M0001', 1, 8), play('M0001', 2, 8), play('M0001', 3, 8)], cart('M0001'), {
      ...BY_HOUR,
      reachable: [8, 12],
    }),
    measureBalance(
      [play('M0002', 1, 8), play('M0002', 2, 12), play('M0002', 3, 8)],
      cart('M0002'),
      { ...BY_HOUR, reachable: [8, 12] },
    ),
    measureBalance([play('M0003', 1, 8)], cart('M0003'), { ...BY_HOUR, reachable: [8, 12] }),
  ];

  it('keeps only what scores at or above the threshold', () => {
    expect(overThreshold(balances(), (b) => b.imbalance, 0.9, 1).map((b) => b.cart)).toEqual([
      'M0001',
      'M0003',
    ]);
  });

  it('drops a cart with too few plays to judge', () => {
    expect(overThreshold(balances(), (b) => b.imbalance, 0.9, 3).map((b) => b.cart)).toEqual([
      'M0001',
    ]);
  });

  it('can score on concentration instead of on spread', () => {
    expect(overThreshold(balances(), concentration, 1, 3).map((b) => b.cart)).toEqual(['M0001']);
  });

  it('keeps nothing when the threshold is above everything', () => {
    expect(overThreshold(balances(), (b) => b.imbalance, 1.5, 1)).toEqual([]);
  });
});

describe('meanImbalance', () => {
  it('averages only the carts that played', () => {
    const measured = [
      measureBalance([play('M0001', 1, 8), play('M0001', 2, 8)], cart('M0001'), {
        ...BY_HOUR,
        reachable: [8, 12],
      }),
      measureBalance([], cart('M0002'), BY_HOUR),
    ];
    expect(meanImbalance(measured)).toBeCloseTo(1);
  });

  it('is zero when nothing played', () => {
    expect(meanImbalance([measureBalance([], cart('M0001'), BY_HOUR)])).toBe(0);
    expect(meanImbalance([])).toBe(0);
  });
});
