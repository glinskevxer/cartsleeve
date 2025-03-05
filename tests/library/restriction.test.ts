import { describe, expect, it } from 'vitest';
import {
  NO_RESTRICTIONS,
  allowedAt,
  allowedInCell,
  makeRestrictionMap,
  parked,
  reachOf,
  restrictionOf,
} from '../../src/library/restriction.js';
import { WEEKDAYS, WEEKEND, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import type { CartNumber } from '../../src/util/ids.js';
import { expectErr, expectOk } from '../support/result.js';

const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));
const PMD = expectOk(makeDaypart('PMD', [{ days: [...WEEKDAYS], fromHour: 15, toHour: 19 }]));
const WKD = expectOk(makeDaypart('WKND', [{ days: [...WEEKEND], fromHour: 0, toHour: 24 }]));
const DAYPARTS = [AMD, PMD, WKD];

const cart = (value: string): CartNumber => value as CartNumber;

describe('makeRestrictionMap', () => {
  it('builds a map keyed by cart', () => {
    const map = expectOk(
      makeRestrictionMap(
        [{ cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'], note: 'ballad' }],
        DAYPARTS,
      ),
    );
    expect(map.byCart.size).toBe(1);
    expect(restrictionOf(map, cart('M0001'))?.note).toBe('ballad');
    expect(restrictionOf(map, cart('M0002'))).toBeUndefined();
  });

  it('rejects two restrictions on one cart', () => {
    const problems = expectErr(
      makeRestrictionMap(
        [
          { cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'] },
          { cart: cart('M0001'), mode: 'allow', dayparts: ['PMD'] },
        ],
        DAYPARTS,
      ),
    );
    expect(problems[0]?.code).toBe('LIB-080');
  });

  it('rejects a daypart nothing defines and names it', () => {
    const problems = expectErr(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'deny', dayparts: ['NOPE'] }], DAYPARTS),
    );
    expect(problems[0]?.code).toBe('LIB-081');
    expect(problems[0]?.detail?.['daypart']).toBe('NOPE');
  });

  it('accepts an empty map and an empty daypart list on a cart', () => {
    expect(expectOk(makeRestrictionMap([], DAYPARTS)).byCart.size).toBe(0);
    expect(
      expectOk(makeRestrictionMap([{ cart: cart('M0001'), mode: 'allow', dayparts: [] }], DAYPARTS))
        .byCart.size,
    ).toBe(1);
  });
});

describe('deny', () => {
  const map = () =>
    expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'] }], DAYPARTS),
    );

  it('blocks the named daypart and allows everything else', () => {
    expect(allowedAt(map(), cart('M0001'), 1, 7)).toBe(false);
    expect(allowedAt(map(), cart('M0001'), 1, 11)).toBe(true);
    expect(allowedAt(map(), cart('M0001'), 0, 7)).toBe(true);
  });

  it('answers by cell as well as by day and hour', () => {
    expect(allowedInCell(map(), cart('M0001'), cellOf(1, 7))).toBe(false);
    expect(allowedInCell(map(), cart('M0001'), cellOf(1, 11))).toBe(true);
  });

  it('leaves a cart with no restriction alone everywhere', () => {
    expect(allowedAt(map(), cart('M0002'), 1, 7)).toBe(true);
    expect(reachOf(map(), cart('M0002'))).toBe(168);
  });

  it('shrinks the reach by exactly the daypart it denies', () => {
    expect(reachOf(map(), cart('M0001'))).toBe(168 - 20);
  });
});

describe('allow', () => {
  const map = () =>
    expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'allow', dayparts: ['WKND'] }], DAYPARTS),
    );

  it('permits only the named daypart', () => {
    expect(allowedAt(map(), cart('M0001'), 0, 7)).toBe(true);
    expect(allowedAt(map(), cart('M0001'), 6, 23)).toBe(true);
    expect(allowedAt(map(), cart('M0001'), 1, 7)).toBe(false);
    expect(allowedAt(map(), cart('M0001'), 3, 12)).toBe(false);
  });

  it('reaches exactly the cells of the dayparts it allows', () => {
    expect(reachOf(map(), cart('M0001'))).toBe(48);
  });

  it('unions two allowed dayparts rather than intersecting them', () => {
    const both = expectOk(
      makeRestrictionMap(
        [{ cart: cart('M0001'), mode: 'allow', dayparts: ['AMD', 'PMD'] }],
        DAYPARTS,
      ),
    );
    expect(allowedAt(both, cart('M0001'), 1, 7)).toBe(true);
    expect(allowedAt(both, cart('M0001'), 1, 16)).toBe(true);
    expect(allowedAt(both, cart('M0001'), 1, 12)).toBe(false);
    expect(reachOf(both, cart('M0001'))).toBe(40);
  });

  it('parks a cart entirely when the allow list is empty', () => {
    const map = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'allow', dayparts: [] }], DAYPARTS),
    );
    expect(reachOf(map, cart('M0001'))).toBe(0);
    expect(allowedAt(map, cart('M0001'), 1, 7)).toBe(false);
    expect(parked(map)).toEqual(['M0001']);
  });

  it('reports nothing parked when every cart can play somewhere', () => {
    expect(parked(map())).toEqual([]);
    expect(parked(NO_RESTRICTIONS)).toEqual([]);
  });
});

describe('the effect on what turnover measures', () => {
  it('leaves a cart in the category for fewer hours than the category runs', () => {
    const map = expectOk(
      makeRestrictionMap(
        [
          { cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'] },
          { cart: cart('M0002'), mode: 'deny', dayparts: ['AMD'] },
        ],
        DAYPARTS,
      ),
    );
    const morning = cellOf(1, 7);
    const eligible = [cart('M0001'), cart('M0002'), cart('M0003')].filter((each) =>
      allowedInCell(map, each, morning),
    );
    expect(eligible).toEqual(['M0003']);
  });

  it('makes the same category a different size in two different cells', () => {
    const map = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'] }], DAYPARTS),
    );
    const carts = [cart('M0001'), cart('M0002')];
    const inMorning = carts.filter((each) => allowedInCell(map, each, cellOf(1, 7)));
    const atMidday = carts.filter((each) => allowedInCell(map, each, cellOf(1, 12)));
    expect(inMorning).toHaveLength(1);
    expect(atMidday).toHaveLength(2);
  });

  it('treats an unrestricted map as no constraint at all', () => {
    expect(allowedInCell(NO_RESTRICTIONS, cart('M0001'), cellOf(1, 7))).toBe(true);
    expect(reachOf(NO_RESTRICTIONS, cart('M0001'))).toBe(168);
  });
});
