import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_VIEW,
  countInCategory,
  makeScheduleView,
  nearestMatch,
  playsOf,
  withPlaced,
  withoutPosition,
} from '../../src/rules/schedule-view.js';
import { tenths } from '../../src/util/duration.js';
import { cartNo, placed } from '../support/placed.js';
import { resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

/** Four songs in an hour, three and a half minutes apart. */
function hour() {
  return makeScheduleView([
    placed({ position: 0, at: 0, number: 'M0001', billed: 'Dolly Parton', category: 'A' }),
    placed({ position: 1, at: 2100, number: 'M0002', billed: 'Johnny Cash', category: 'A' }),
    placed({ position: 2, at: 4200, number: 'M0003', billed: 'Dolly Parton', category: 'G' }),
    placed({ position: 3, at: 6300, number: 'M0004', billed: 'Merle Haggard', category: 'A' }),
  ]);
}

describe('makeScheduleView', () => {
  it('holds every placement and counts them', () => {
    expect(hour().count).toBe(4);
    expect(EMPTY_VIEW.count).toBe(0);
  });

  it('sorts by position however the placements arrive', () => {
    const view = makeScheduleView([
      placed({ position: 3, at: 6300, number: 'M0004' }),
      placed({ position: 0, at: 0, number: 'M0001' }),
    ]);
    expect(view.placed.map((item) => item.position)).toEqual([0, 3]);
  });

  it('indexes the plays of each cart', () => {
    const view = makeScheduleView([
      placed({ position: 0, at: 0, number: 'M0001' }),
      placed({ position: 5, at: 12000, number: 'M0001' }),
    ]);
    expect(playsOf(view, cartNo('M0001'))).toHaveLength(2);
    expect(playsOf(view, cartNo('M9999'))).toEqual([]);
  });
});

describe('walking by position', () => {
  it('gives everything before a position, nearest first', () => {
    expect(
      hour()
        .before(3)
        .map((item) => item.position),
    ).toEqual([2, 1, 0]);
    expect(hour().before(0)).toEqual([]);
  });

  it('gives everything after a position, in order', () => {
    expect(
      hour()
        .after(0)
        .map((item) => item.position),
    ).toEqual([1, 2, 3]);
    expect(hour().after(3)).toEqual([]);
  });

  it('excludes the position itself from both directions', () => {
    expect(
      hour()
        .before(2)
        .map((item) => item.position),
    ).not.toContain(2);
    expect(
      hour()
        .after(2)
        .map((item) => item.position),
    ).not.toContain(2);
  });

  it('finds the immediate neighbour', () => {
    expect(hour().previous(2)?.cart).toBe('M0002');
    expect(hour().previous(0)).toBeUndefined();
  });

  it('finds the neighbour of a position nothing occupies yet', () => {
    expect(hour().previous(9)?.cart).toBe('M0004');
    const gapped = makeScheduleView([
      placed({ position: 0, at: 0, number: 'M0001' }),
      placed({ position: 4, at: 8000, number: 'M0002' }),
    ]);
    expect(gapped.previous(2)?.cart).toBe('M0001');
  });
});

describe('walking by wall clock', () => {
  it('finds placements inside a distance either side', () => {
    expect(
      hour()
        .within(tenths(4200), tenths(2100))
        .map((item) => item.cart),
    ).toEqual(['M0002', 'M0003', 'M0004']);
  });

  it('includes a placement exactly on the distance', () => {
    expect(hour().within(tenths(0), tenths(2100))).toHaveLength(2);
    expect(hour().within(tenths(0), tenths(2099))).toHaveLength(1);
  });

  it('finds nothing at zero distance except what is exactly there', () => {
    expect(
      hour()
        .within(tenths(2100), tenths(0))
        .map((item) => item.cart),
    ).toEqual(['M0002']);
    expect(hour().within(tenths(2101), tenths(0))).toEqual([]);
  });

  it('answers a different set than the position walk once times are uneven', () => {
    const uneven = makeScheduleView([
      placed({ position: 0, at: 0, number: 'M0001' }),
      placed({ position: 1, at: 300, number: 'M0002' }),
      placed({ position: 2, at: 24000, number: 'M0003' }),
    ]);
    expect(uneven.before(2)).toHaveLength(2);
    expect(uneven.within(tenths(24000), tenths(1200))).toHaveLength(1);
  });
});

describe('nearestMatch', () => {
  it('measures the wall clock distance to the nearest match', () => {
    const view = hour();
    expect(
      nearestMatch(view, tenths(6300), (item) => item.entry.cart.billed.includes('Dolly')),
    ).toBe(2100);
  });

  it('is infinite when nothing matches', () => {
    expect(nearestMatch(hour(), tenths(0), () => false)).toBe(Number.POSITIVE_INFINITY);
    expect(nearestMatch(EMPTY_VIEW, tenths(0), () => true)).toBe(Number.POSITIVE_INFINITY);
  });

  it('measures in both directions', () => {
    const view = hour();
    expect(nearestMatch(view, tenths(3000), (item) => item.cart === 'M0002')).toBe(900);
    expect(nearestMatch(view, tenths(1000), (item) => item.cart === 'M0002')).toBe(1100);
  });
});

describe('changing the view', () => {
  it('adds a placement without touching the original', () => {
    const before = hour();
    const after = withPlaced(before, placed({ position: 4, at: 8400, number: 'M0005' }));
    expect(after.count).toBe(5);
    expect(before.count).toBe(4);
  });

  it('removes a position', () => {
    const after = withoutPosition(hour(), 2);
    expect(after.count).toBe(3);
    expect(after.placed.map((item) => item.position)).toEqual([0, 1, 3]);
  });

  it('removing a position nothing occupies changes nothing', () => {
    expect(withoutPosition(hour(), 9).count).toBe(4);
  });

  it('changes what a later query sees, which is the point', () => {
    const before = hour();
    const distance = (view: ReturnType<typeof hour>): number =>
      nearestMatch(view, tenths(8400), (item) => item.category === 'A');
    expect(distance(before)).toBe(2100);
    expect(distance(withoutPosition(before, 3))).toBe(6300);
  });
});

describe('countInCategory', () => {
  it('counts what has been placed in a category so far', () => {
    expect(countInCategory(hour(), 'A')).toBe(3);
    expect(countInCategory(hour(), 'G')).toBe(1);
    expect(countInCategory(hour(), 'B')).toBe(0);
  });
});
