import { describe, expect, it } from 'vitest';
import {
  ascending,
  by,
  byText,
  compareText,
  countBy,
  descending,
  distinctBy,
  groupBy,
  indexBy,
  maxBy,
  mean,
  minBy,
  sorted,
  spread,
  sum,
  thenBy,
} from '../../src/util/ordering.js';

interface Cart {
  readonly cart: string;
  readonly artist: string;
  readonly rest: number;
}

const CARTS: Cart[] = [
  { cart: 'M0003', artist: 'Waits', rest: 12 },
  { cart: 'M0001', artist: 'Cash', rest: 40 },
  { cart: 'M0004', artist: 'cash', rest: 12 },
  { cart: 'M0002', artist: 'Nelson', rest: 40 },
];

describe('primitive comparators', () => {
  it('orders numbers both ways', () => {
    expect(ascending(1, 2)).toBe(-1);
    expect(ascending(2, 1)).toBe(1);
    expect(ascending(2, 2)).toBe(0);
    expect(descending(1, 2)).toBe(1);
  });

  it('compares text case insensitively but stays total', () => {
    expect(compareText('cash', 'Nelson')).toBe(-1);
    expect(compareText('Nelson', 'cash')).toBe(1);
    expect(compareText('Cash', 'Cash')).toBe(0);
    expect(compareText('Cash', 'cash')).toBe(-1);
    expect(compareText('cash', 'Cash')).toBe(1);
  });
});

describe('sorted', () => {
  it('does not reorder the input', () => {
    const before = [...CARTS];
    sorted(
      CARTS,
      by((cart) => cart.rest),
    );
    expect(CARTS).toEqual(before);
  });

  it('orders by a numeric key in both directions', () => {
    expect(
      sorted(
        CARTS,
        by((c) => c.rest),
      ).map((c) => c.cart),
    ).toEqual(['M0003', 'M0004', 'M0001', 'M0002']);
    expect(
      sorted(
        CARTS,
        by((c) => c.rest, 'desc'),
      ).map((c) => c.cart),
    ).toEqual(['M0001', 'M0002', 'M0003', 'M0004']);
  });

  it('is stable, so a tie keeps the input order', () => {
    const ties = sorted(
      CARTS,
      by((c) => c.rest),
    );
    expect(ties.slice(0, 2).map((c) => c.cart)).toEqual(['M0003', 'M0004']);
  });

  it('orders by text', () => {
    expect(
      sorted(
        CARTS,
        byText((c) => c.artist),
      ).map((c) => c.artist),
    ).toEqual(['Cash', 'cash', 'Nelson', 'Waits']);
  });
});

describe('thenBy', () => {
  it('breaks a tie with the next comparator', () => {
    const order = thenBy<Cart>(
      by((c) => c.rest),
      byText((c) => c.cart),
    );
    expect(sorted(CARTS, order).map((c) => c.cart)).toEqual(['M0003', 'M0004', 'M0001', 'M0002']);
  });

  it('makes the ordering total when the first key ties', () => {
    const order = thenBy<Cart>(
      by((c) => c.rest),
      byText((c) => c.artist),
      byText((c) => c.cart),
    );
    const once = sorted(CARTS, order).map((c) => c.cart);
    const again = sorted([...CARTS].reverse(), order).map((c) => c.cart);
    expect(again).toEqual(once);
  });

  it('returns zero when nothing separates the two', () => {
    expect(thenBy<Cart>(by((c) => c.rest))(CARTS[0] as Cart, CARTS[2] as Cart)).toBe(0);
  });
});

describe('grouping', () => {
  it('groups keeping input order inside each bucket', () => {
    const groups = groupBy(CARTS, (c) => c.rest);
    expect([...groups.keys()]).toEqual([12, 40]);
    expect(groups.get(12)?.map((c) => c.cart)).toEqual(['M0003', 'M0004']);
  });

  it('counts by a key', () => {
    expect([...countBy(CARTS, (c) => c.rest)]).toEqual([
      [12, 2],
      [40, 2],
    ]);
  });

  it('indexes by a key, last write winning', () => {
    const index = indexBy(CARTS, (c) => c.rest);
    expect(index.get(12)?.cart).toBe('M0004');
    expect(index.size).toBe(2);
  });

  it('keeps the first of each key when made distinct', () => {
    expect(distinctBy(CARTS, (c) => c.rest).map((c) => c.cart)).toEqual(['M0003', 'M0001']);
  });

  it('handles an empty list everywhere', () => {
    expect(groupBy([], (x: Cart) => x.rest).size).toBe(0);
    expect(countBy([], (x: Cart) => x.rest).size).toBe(0);
    expect(distinctBy([], (x: Cart) => x.rest)).toEqual([]);
  });
});

describe('extremes', () => {
  it('finds the smallest and largest', () => {
    expect(minBy(CARTS, (c) => c.rest)?.cart).toBe('M0003');
    expect(maxBy(CARTS, (c) => c.rest)?.cart).toBe('M0001');
  });

  it('keeps the first on a tie', () => {
    expect(minBy(CARTS, (c) => c.rest)?.cart).toBe('M0003');
    expect(maxBy(CARTS, (c) => c.rest)?.cart).toBe('M0001');
  });

  it('returns undefined for an empty list', () => {
    expect(minBy([], (x: Cart) => x.rest)).toBeUndefined();
    expect(maxBy([], (x: Cart) => x.rest)).toBeUndefined();
  });
});

describe('arithmetic', () => {
  it('sums and averages', () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([])).toBe(0);
    expect(mean([2, 4])).toBe(3);
    expect(mean([])).toBe(0);
  });
});

describe('spread', () => {
  it('is zero when the counts are perfectly even', () => {
    expect(spread([5, 5, 5, 5])).toBe(0);
    expect(spread([3, 3])).toBe(0);
  });

  it('is one when everything lands in one bucket', () => {
    expect(spread([12, 0, 0, 0])).toBeCloseTo(1);
    expect(spread([0, 8])).toBeCloseTo(1);
  });

  it('sits between the two for a partial imbalance', () => {
    const value = spread([6, 4, 5, 5]);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(0.5);
  });

  it('is zero for a single bucket, an empty list and all zeroes', () => {
    expect(spread([9])).toBe(0);
    expect(spread([])).toBe(0);
    expect(spread([0, 0, 0])).toBe(0);
  });

  it('does not change when every count is scaled', () => {
    expect(spread([6, 4, 5, 5])).toBeCloseTo(spread([12, 8, 10, 10]));
  });
});
