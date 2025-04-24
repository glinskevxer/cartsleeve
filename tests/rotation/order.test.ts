import { beforeEach, describe, expect, it } from 'vitest';
import {
  effectiveSize,
  eligibleIn,
  excludedFor,
  paperSize,
  rotationOrder,
  shrinkage,
} from '../../src/rotation/order.js';
import type { EligibilityContext } from '../../src/rotation/order.js';
import { NO_POSITIONS, makePositionIndex } from '../../src/rotation/position.js';
import type { CategorisedPlay } from '../../src/rotation/position.js';
import { WEEKDAYS, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import { NO_RESTRICTIONS, makeRestrictionMap } from '../../src/library/restriction.js';
import { CHRISTMAS, NO_WINDOWS, makeWindow, makeWindowMap } from '../../src/library/window.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { HOUR_MS } from '../../src/util/time.js';
import { library, resetFixtures } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

const cart = (value: string): CartNumber => value as CartNumber;
const code = (value: string): CategoryCode => value as CategoryCode;
const NOW = 1_000 * HOUR_MS;
const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));

function play(number: string, hoursAgo: number): CategorisedPlay {
  return { cart: cart(number), category: code('A'), at: NOW - hoursAgo * HOUR_MS, cell: 0 };
}

const SPECS = [
  { number: 'M0001', category: 'A' },
  { number: 'M0002', category: 'A' },
  { number: 'M0003', category: 'A' },
  { number: 'M0004', category: 'G' },
];

function context(over: Partial<EligibilityContext> = {}): EligibilityContext {
  return {
    library: library(SPECS),
    positions: NO_POSITIONS,
    restrictions: NO_RESTRICTIONS,
    windows: NO_WINDOWS,
    day: { year: 2025, month: 6, day: 10 },
    cell: cellOf(2, 7),
    ...over,
  };
}

const denying = (...carts: string[]) =>
  expectOk(
    makeRestrictionMap(
      carts.map((number) => ({ cart: cart(number), mode: 'deny' as const, dayparts: ['AMD'] })),
      [AMD],
    ),
  );

const seasonal = (number: string) =>
  makeWindowMap([expectOk(makeWindow(cart(number), undefined, CHRISTMAS))]);

beforeEach(() => {
  resetFixtures();
});

describe('eligibleIn', () => {
  it('takes the whole category when nothing constrains it', () => {
    const { eligible, excluded } = eligibleIn(context(), code('A'));
    expect(eligible.map((e) => e.cart.number)).toEqual(['M0001', 'M0002', 'M0003']);
    expect(excluded).toEqual([]);
  });

  it('takes nothing from a category that is empty', () => {
    expect(eligibleIn(context(), code('B')).eligible).toEqual([]);
  });

  it('excludes a cart outside its season and says why', () => {
    const { eligible, excluded } = eligibleIn(context({ windows: seasonal('M0002') }), code('A'));
    expect(eligible.map((e) => e.cart.number)).toEqual(['M0001', 'M0003']);
    expect(excluded).toEqual([{ cart: 'M0002', reason: 'retired' }]);
  });

  it('excludes a cart restricted out of this cell and says why', () => {
    const { eligible, excluded } = eligibleIn(
      context({ restrictions: denying('M0003') }),
      code('A'),
    );
    expect(eligible.map((e) => e.cart.number)).toEqual(['M0001', 'M0002']);
    expect(excluded).toEqual([{ cart: 'M0003', reason: 'restricted' }]);
  });

  it('lets the same restricted cart back in at another hour', () => {
    const midday = eligibleIn(
      context({ restrictions: denying('M0003'), cell: cellOf(2, 12) }),
      code('A'),
    );
    expect(midday.eligible).toHaveLength(3);
    expect(midday.excluded).toEqual([]);
  });

  it('reports the season before the restriction when both would fire', () => {
    const built = context({ windows: seasonal('M0002'), restrictions: denying('M0002') });
    expect(eligibleIn(built, code('A')).excluded).toEqual([{ cart: 'M0002', reason: 'retired' }]);
  });

  it('filters by reason', () => {
    const built = context({ windows: seasonal('M0001'), restrictions: denying('M0003') });
    expect(excludedFor(built, code('A'), 'retired')).toEqual(['M0001']);
    expect(excludedFor(built, code('A'), 'restricted')).toEqual(['M0003']);
  });
});

describe('rotationOrder', () => {
  it('puts the best rested first', () => {
    const positions = makePositionIndex([play('M0002', 10), play('M0001', 6), play('M0003', 2)]);
    expect(rotationOrder(context({ positions }), code('A')).map((e) => e.cart.number)).toEqual([
      'M0002',
      'M0001',
      'M0003',
    ]);
  });

  it('puts a cart that has never played at the front', () => {
    const positions = makePositionIndex([play('M0001', 6), play('M0002', 2)]);
    expect(rotationOrder(context({ positions }), code('A'))[0]?.cart.number).toBe('M0003');
  });

  it('leaves an excluded cart out of the order entirely', () => {
    const positions = makePositionIndex([play('M0002', 10), play('M0001', 6), play('M0003', 2)]);
    const ordered = rotationOrder(context({ positions, windows: seasonal('M0002') }), code('A'));
    expect(ordered.map((e) => e.cart.number)).toEqual(['M0001', 'M0003']);
  });

  it('gives the same order on a rerun', () => {
    const positions = makePositionIndex([play('M0002', 10)]);
    const once = rotationOrder(context({ positions }), code('A')).map((e) => e.cart.number);
    const again = rotationOrder(context({ positions }), code('A')).map((e) => e.cart.number);
    expect(again).toEqual(once);
  });

  it('changes which cart is tried first when the rest changes', () => {
    const early = makePositionIndex([play('M0001', 10), play('M0002', 6)]);
    const late = makePositionIndex([play('M0002', 10), play('M0001', 6)]);
    expect(rotationOrder(context({ positions: early }), code('A'))[1]?.cart.number).toBe('M0001');
    expect(rotationOrder(context({ positions: late }), code('A'))[1]?.cart.number).toBe('M0002');
  });

  it('orders an empty category to nothing', () => {
    expect(rotationOrder(context(), code('B'))).toEqual([]);
  });
});

describe('the size the category really is here', () => {
  it('matches the paper size when nothing constrains it', () => {
    expect(effectiveSize(context(), code('A'))).toBe(3);
    expect(paperSize(context(), code('A'))).toBe(3);
    expect(shrinkage(context(), code('A'))).toBe(0);
  });

  it('shrinks in a cell that restricts part of the category', () => {
    const built = context({ restrictions: denying('M0002', 'M0003') });
    expect(paperSize(built, code('A'))).toBe(3);
    expect(effectiveSize(built, code('A'))).toBe(1);
    expect(shrinkage(built, code('A'))).toBeCloseTo(2 / 3);
  });

  it('is a different size in a different cell, which is the whole point', () => {
    const restrictions = denying('M0002');
    expect(effectiveSize(context({ restrictions, cell: cellOf(2, 7) }), code('A'))).toBe(2);
    expect(effectiveSize(context({ restrictions, cell: cellOf(2, 12) }), code('A'))).toBe(3);
  });

  it('shrinks for a season as readily as for a restriction', () => {
    const built = context({ windows: seasonal('M0001') });
    expect(effectiveSize(built, code('A'))).toBe(2);
    expect(
      effectiveSize(
        context({ windows: seasonal('M0001'), day: { year: 2025, month: 12, day: 15 } }),
        code('A'),
      ),
    ).toBe(3);
  });

  it('reports no shrinkage on a category that does not exist', () => {
    expect(shrinkage(context(), code('Z'))).toBe(0);
    expect(paperSize(context(), code('Z'))).toBe(0);
  });
});
