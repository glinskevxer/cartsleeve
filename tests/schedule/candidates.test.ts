import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEPTH, candidatesFor, depthOf, isThin } from '../../src/schedule/candidates.js';
import type { EligibilityContext } from '../../src/rotation/order.js';
import { NO_POSITIONS, makePositionIndex } from '../../src/rotation/position.js';
import type { CategorisedPlay } from '../../src/rotation/position.js';
import { dealPackets } from '../../src/rotation/packet.js';
import { WEEKDAYS, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import { NO_RESTRICTIONS, makeRestrictionMap } from '../../src/library/restriction.js';
import { NO_WINDOWS } from '../../src/library/window.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { HOUR_MS } from '../../src/util/time.js';
import { library, resetFixtures } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const A = 'A' as CategoryCode;
const NOW = 1_000 * HOUR_MS;
const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));

function play(number: string, hoursAgo: number): CategorisedPlay {
  return { cart: cart(number), category: A, at: NOW - hoursAgo * HOUR_MS, cell: 0 };
}

const SPECS = Array.from({ length: 6 }, (_, index) => ({
  number: `M000${index + 1}`,
  category: 'A',
}));

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

/** Rest order: M0001 best rested, M0006 worst. */
const RESTED = makePositionIndex(
  Array.from({ length: 6 }, (_, index) => play(`M000${index + 1}`, 60 - index * 10)),
);

describe('candidatesFor without packets', () => {
  it('returns the rest order', () => {
    const found = candidatesFor(context({ positions: RESTED }), A, { depth: 10 });
    expect(found.map((each) => each.cart.number)).toEqual([
      'M0001',
      'M0002',
      'M0003',
      'M0004',
      'M0005',
      'M0006',
    ]);
  });

  it('truncates to the depth', () => {
    const found = candidatesFor(context({ positions: RESTED }), A, { depth: 3 });
    expect(found.map((each) => each.cart.number)).toEqual(['M0001', 'M0002', 'M0003']);
  });

  it('returns nothing at depth zero or below', () => {
    expect(candidatesFor(context(), A, { depth: 0 })).toEqual([]);
    expect(candidatesFor(context(), A, { depth: -4 })).toEqual([]);
  });

  it('returns nothing for a category with nothing in it', () => {
    expect(candidatesFor(context(), 'G' as CategoryCode, { depth: 10 })).toEqual([]);
  });

  it('leaves out a cart restricted from this hour', () => {
    const restrictions = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'] }], [AMD]),
    );
    const found = candidatesFor(context({ positions: RESTED, restrictions }), A, { depth: 10 });
    expect(found.map((each) => each.cart.number)).not.toContain('M0001');
    expect(found).toHaveLength(5);
  });

  it('lets the same cart back in at another hour', () => {
    const restrictions = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'] }], [AMD]),
    );
    const midday = context({ positions: RESTED, restrictions, cell: cellOf(2, 12) });
    expect(candidatesFor(midday, A, { depth: 10 })).toHaveLength(6);
  });

  it('has a sensible default depth', () => {
    expect(DEFAULT_DEPTH).toBeGreaterThan(10);
  });
});

describe('candidatesFor with packets', () => {
  const packets = () =>
    dealPackets(
      A,
      Array.from({ length: 6 }, (_, index) => cart(`M000${index + 1}`)),
      3,
    );

  it('draws in packet order rather than straight down the rest order', () => {
    const found = candidatesFor(context({ positions: RESTED }), A, {
      depth: 10,
      packets: packets(),
    });
    expect(found.map((each) => each.cart.number)).toEqual([
      'M0001',
      'M0002',
      'M0003',
      'M0004',
      'M0005',
      'M0006',
    ]);
  });

  it('differs from the rest order once the packets are dealt differently', () => {
    const reversed = dealPackets(
      A,
      Array.from({ length: 6 }, (_, index) => cart(`M000${6 - index}`)),
      3,
    );
    const found = candidatesFor(context({ positions: RESTED }), A, {
      depth: 10,
      packets: reversed,
    });
    expect(found[0]?.cart.number).toBe('M0006');
  });

  it('filters the draw down to what is eligible here', () => {
    const restrictions = expectOk(
      makeRestrictionMap([{ cart: cart('M0002'), mode: 'deny', dayparts: ['AMD'] }], [AMD]),
    );
    const found = candidatesFor(context({ positions: RESTED, restrictions }), A, {
      depth: 10,
      packets: packets(),
    });
    expect(found.map((each) => each.cart.number)).not.toContain('M0002');
    expect(found).toHaveLength(5);
  });

  it('truncates to the depth', () => {
    const found = candidatesFor(context(), A, { depth: 2, packets: packets() });
    expect(found).toHaveLength(2);
  });

  it('falls back to the rest order when the draw reaches nothing eligible', () => {
    const otherCategory = dealPackets('G' as CategoryCode, [cart('M9999')], 1);
    const found = candidatesFor(context({ positions: RESTED }), A, {
      depth: 10,
      packets: otherCategory,
    });
    expect(found.map((each) => each.cart.number)).toEqual([
      'M0001',
      'M0002',
      'M0003',
      'M0004',
      'M0005',
      'M0006',
    ]);
  });

  it('returns nothing when the category is empty, packets or not', () => {
    expect(
      candidatesFor(context(), 'G' as CategoryCode, { depth: 10, packets: packets() }),
    ).toEqual([]);
  });
});

describe('search depth', () => {
  it('records what was considered against what was there', () => {
    expect(depthOf(3, 40)).toEqual({ considered: 3, available: 40 });
  });

  it('calls a thin set thin', () => {
    expect(isThin(depthOf(2, 3))).toBe(true);
    expect(isThin(depthOf(2, 40))).toBe(false);
  });

  it('honours a floor that is given', () => {
    expect(isThin(depthOf(2, 10), 20)).toBe(true);
    expect(isThin(depthOf(2, 10), 5)).toBe(false);
  });

  it('calls an empty set thin', () => {
    expect(isThin(depthOf(0, 0))).toBe(true);
  });
});
