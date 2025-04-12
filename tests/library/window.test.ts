import { describe, expect, it } from 'vitest';
import {
  CHRISTMAS,
  HOLIDAYS,
  NO_WINDOWS,
  isLive,
  liveCarts,
  liveOn,
  makeWindow,
  makeWindowMap,
  withinDates,
  withinSeason,
} from '../../src/library/window.js';
import type { CartNumber } from '../../src/util/ids.js';
import type { BroadcastDay } from '../../src/util/time.js';
import { expectErr, expectOk } from '../support/result.js';

const cart = (value: string): CartNumber => value as CartNumber;
const day = (year: number, month: number, dayOfMonth: number): BroadcastDay => ({
  year,
  month,
  day: dayOfMonth,
});

describe('makeWindow', () => {
  it('builds with no constraint at all', () => {
    const window = expectOk(makeWindow(cart('M0001'), undefined, undefined));
    expect(window.cart).toBe('M0001');
    expect(isLive(window, day(2025, 6, 1))).toBe(true);
  });

  it('rejects a window retired before it is activated', () => {
    const problems = expectErr(
      makeWindow(cart('M0001'), { from: day(2025, 6, 1), to: day(2025, 5, 1) }, undefined),
    );
    expect(problems[0]?.code).toBe('LIB-110');
  });

  it('accepts a window that opens and closes on the same day', () => {
    expect(
      expectOk(makeWindow(cart('M0001'), { from: day(2025, 6, 1), to: day(2025, 6, 1) }, undefined))
        .dates,
    ).toBeDefined();
  });

  it('rejects a season month outside the year', () => {
    const problems = expectErr(
      makeWindow(cart('M0001'), undefined, { fromMonth: 13, fromDay: 1, toMonth: 12, toDay: 26 }),
    );
    expect(problems[0]?.code).toBe('LIB-111');
    expect(problems[0]?.detail?.['month']).toBe(13);
  });

  it('rejects a season day the month does not have', () => {
    const problems = expectErr(
      makeWindow(cart('M0001'), undefined, { fromMonth: 11, fromDay: 31, toMonth: 12, toDay: 26 }),
    );
    expect(problems[0]?.code).toBe('LIB-112');
    expect(problems[0]?.detail?.['day']).toBe(31);
  });

  it('accepts the 29th of February, since a season repeats every year', () => {
    expect(
      expectOk(
        makeWindow(cart('M0001'), undefined, { fromMonth: 2, fromDay: 29, toMonth: 3, toDay: 1 }),
      ),
    ).toBeDefined();
  });

  it('accepts both standard seasons', () => {
    expect(expectOk(makeWindow(cart('M0001'), undefined, CHRISTMAS))).toBeDefined();
    expect(expectOk(makeWindow(cart('M0001'), undefined, HOLIDAYS))).toBeDefined();
  });
});

describe('withinDates', () => {
  it('is open on both bounds', () => {
    const window = { from: day(2025, 6, 1), to: day(2025, 6, 30) };
    expect(withinDates(window, day(2025, 6, 1))).toBe(true);
    expect(withinDates(window, day(2025, 6, 30))).toBe(true);
    expect(withinDates(window, day(2025, 5, 31))).toBe(false);
    expect(withinDates(window, day(2025, 7, 1))).toBe(false);
  });

  it('runs forever in whichever direction is unset', () => {
    expect(withinDates({ from: day(2025, 6, 1) }, day(2030, 1, 1))).toBe(true);
    expect(withinDates({ from: day(2025, 6, 1) }, day(2020, 1, 1))).toBe(false);
    expect(withinDates({ to: day(2025, 6, 1) }, day(2020, 1, 1))).toBe(true);
    expect(withinDates({}, day(1999, 1, 1))).toBe(true);
  });
});

describe('withinSeason', () => {
  it('opens and closes on its own bounds', () => {
    expect(withinSeason(CHRISTMAS, day(2025, 12, 1))).toBe(true);
    expect(withinSeason(CHRISTMAS, day(2025, 12, 26))).toBe(true);
    expect(withinSeason(CHRISTMAS, day(2025, 11, 30))).toBe(false);
    expect(withinSeason(CHRISTMAS, day(2025, 12, 27))).toBe(false);
  });

  it('comes back every year', () => {
    for (const year of [2024, 2025, 2026]) {
      expect(withinSeason(CHRISTMAS, day(year, 12, 15))).toBe(true);
      expect(withinSeason(CHRISTMAS, day(year, 6, 15))).toBe(false);
    }
  });

  it('wraps the new year as one window rather than two', () => {
    expect(withinSeason(HOLIDAYS, day(2025, 12, 25))).toBe(true);
    expect(withinSeason(HOLIDAYS, day(2026, 1, 1))).toBe(true);
    expect(withinSeason(HOLIDAYS, day(2026, 1, 2))).toBe(true);
    expect(withinSeason(HOLIDAYS, day(2026, 1, 3))).toBe(false);
    expect(withinSeason(HOLIDAYS, day(2025, 12, 19))).toBe(false);
  });

  it('handles a season of a single day', () => {
    const oneDay = { fromMonth: 7, fromDay: 4, toMonth: 7, toDay: 4 };
    expect(withinSeason(oneDay, day(2025, 7, 4))).toBe(true);
    expect(withinSeason(oneDay, day(2025, 7, 5))).toBe(false);
  });
});

describe('isLive', () => {
  it('needs both the dates and the season to agree', () => {
    const window = expectOk(
      makeWindow(cart('M0001'), { from: day(2025, 1, 1), to: day(2025, 12, 31) }, CHRISTMAS),
    );
    expect(isLive(window, day(2025, 12, 15))).toBe(true);
    expect(isLive(window, day(2025, 6, 15))).toBe(false);
    expect(isLive(window, day(2026, 12, 15))).toBe(false);
  });

  it('is live whenever neither is set', () => {
    expect(isLive(expectOk(makeWindow(cart('M0001'), undefined, undefined)), day(2025, 6, 1))).toBe(
      true,
    );
  });
});

describe('the window map', () => {
  const map = () =>
    makeWindowMap([
      expectOk(makeWindow(cart('M0001'), undefined, CHRISTMAS)),
      expectOk(makeWindow(cart('M0002'), { to: day(2025, 3, 1) }, undefined)),
    ]);

  it('treats a cart with no window as always live', () => {
    expect(liveOn(map(), cart('M0003'), day(2025, 6, 1))).toBe(true);
    expect(liveOn(NO_WINDOWS, cart('M0001'), day(2025, 6, 1))).toBe(true);
  });

  it('applies the window a cart does have', () => {
    expect(liveOn(map(), cart('M0001'), day(2025, 12, 15))).toBe(true);
    expect(liveOn(map(), cart('M0001'), day(2025, 6, 15))).toBe(false);
    expect(liveOn(map(), cart('M0002'), day(2025, 2, 1))).toBe(true);
    expect(liveOn(map(), cart('M0002'), day(2025, 4, 1))).toBe(false);
  });

  it('filters a list of carts down to the live ones', () => {
    const carts = [cart('M0001'), cart('M0002'), cart('M0003')];
    expect(liveCarts(map(), carts, day(2025, 2, 1))).toEqual(['M0002', 'M0003']);
    expect(liveCarts(map(), carts, day(2025, 12, 15))).toEqual(['M0001', 'M0003']);
    expect(liveCarts(map(), carts, day(2025, 6, 15))).toEqual(['M0003']);
  });

  it('changes the size of the eligible pool from one day to the next', () => {
    const carts = [cart('M0001'), cart('M0002'), cart('M0003')];
    expect(liveCarts(map(), carts, day(2025, 11, 30))).toHaveLength(1);
    expect(liveCarts(map(), carts, day(2025, 12, 1))).toHaveLength(2);
  });
});
