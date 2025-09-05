import { beforeEach, describe, expect, it } from 'vitest';
import {
  cellForHour,
  completeness,
  fillDay,
  isCleanDay,
  playCounts,
  unplayed,
} from '../../src/schedule/day.js';
import { HOUR_TENTHS } from '../../src/domain/clock.js';
import { cellOf, dayOfCell, hourOfCell } from '../../src/domain/daypart.js';
import type { EntrySpec } from '../support/fixtures.js';
import { resetFixtures } from '../support/fixtures.js';
import { dayInput, libraryOf, musicClock } from '../support/hour.js';

beforeEach(() => {
  resetFixtures();
});

/** Twenty distinct three minute records, all in A. */
const ERA_YEARS = [1965, 1980, 1995, 2010];

const TWENTY: EntrySpec[] = Array.from({ length: 20 }, (_, index) => ({
  number: `M${String(index + 1).padStart(4, '0')}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
}));

const ONE_ARTIST: EntrySpec[] = Array.from({ length: 4 }, (_, index) => ({
  number: `M000${index + 1}`,
  category: 'A',
  billed: 'Dolly Parton',
  title: `Song ${index + 1}`,
  runtime: '3:00',
}));

describe('cellForHour', () => {
  it('maps the first hour to the day start hour', () => {
    const cell = cellForHour(2, 5, 0);
    expect(dayOfCell(cell)).toBe(2);
    expect(hourOfCell(cell)).toBe(5);
  });

  it('walks forward through the day', () => {
    expect(hourOfCell(cellForHour(2, 5, 7))).toBe(12);
  });

  it('wraps an overnight hour past midnight but keeps the weekday', () => {
    const cell = cellForHour(2, 5, 21);
    expect(hourOfCell(cell)).toBe(2);
    expect(dayOfCell(cell)).toBe(2);
  });

  it('handles a day that starts at midnight', () => {
    expect(cellForHour(3, 0, 9)).toBe(cellOf(3, 9));
  });
});

describe('fillDay', () => {
  it('fills every hour it was asked for', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(TWENTY), hours: 4 }),
    );
    expect(outcome.hours).toHaveLength(4);
    expect(outcome.placed).toHaveLength(12);
    expect(outcome.holes).toEqual([]);
    expect(isCleanDay(outcome)).toBe(true);
  });

  it('numbers the hours and gives each one its cell', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(2), library: libraryOf(TWENTY), hours: 3 }),
    );
    expect(outcome.hours.map((hour) => hour.hourIndex)).toEqual([0, 1, 2]);
    expect(outcome.hours.map((hour) => hourOfCell(hour.cell))).toEqual([5, 6, 7]);
  });

  it('runs the hours end to end in time', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(2), library: libraryOf(TWENTY), hours: 3 }),
    );
    // Two slots of three minutes each, so every hour advances by six minutes.
    expect(outcome.hours.map((hour) => hour.outcome.slots[0]?.at)).toEqual([0, 3600, 7200]);
    expect(outcome.endsAt).toBe(10_800);
  });

  it('handles a twenty three hour day and a twenty five hour one', () => {
    for (const hours of [23, 24, 25]) {
      resetFixtures();
      const outcome = fillDay(
        dayInput({ clock: musicClock(1), library: libraryOf(TWENTY), hours }),
      );
      expect(outcome.hours).toHaveLength(hours);
    }
  });

  it('fills nothing when asked for no hours', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(TWENTY), hours: 0 }),
    );
    expect(outcome.hours).toEqual([]);
    expect(outcome.placed).toEqual([]);
    expect(isCleanDay(outcome)).toBe(true);
  });

  it('skips an hour the grid has no clock for and says which', () => {
    const base = dayInput({ clock: musicClock(2), library: libraryOf(TWENTY), hours: 3 });
    const outcome = fillDay({
      ...base,
      clockFor: (hourIndex) => (hourIndex === 1 ? undefined : base.clockFor(hourIndex)),
    });
    expect(outcome.hours).toHaveLength(2);
    expect(outcome.missingClocks).toEqual([1]);
  });

  it('advances the clock over a skipped hour rather than closing the gap', () => {
    const base = dayInput({ clock: musicClock(2), library: libraryOf(TWENTY), hours: 3 });
    const outcome = fillDay({
      ...base,
      clockFor: (hourIndex) => (hourIndex === 1 ? undefined : base.clockFor(hourIndex)),
    });
    expect(outcome.hours[1]?.outcome.slots[0]?.at).toBe(3600 + HOUR_TENTHS);
  });
});

describe('the carry between hours', () => {
  it('does not open every hour on the same record', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(TWENTY), hours: 4 }),
    );
    const openers = outcome.hours.map((hour) => hour.outcome.slots[0]?.cart);
    expect(new Set(openers).size).toBe(openers.length);
  });

  it('separates a cart across an hour boundary', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(TWENTY), hours: 3 }),
    );
    const carts = outcome.placed.map((each) => each.cart);
    expect(new Set(carts).size).toBe(carts.length);
  });

  it('counts a cart that had to come round again', () => {
    const four = TWENTY.slice(0, 4);
    const outcome = fillDay(dayInput({ clock: musicClock(3), library: libraryOf(four), hours: 3 }));
    expect([...playCounts(outcome).values()].some((count) => count > 1)).toBe(true);
  });

  it('reports carts the day never reached', () => {
    const library = libraryOf(TWENTY);
    const outcome = fillDay(dayInput({ clock: musicClock(2), library, hours: 2 }));
    expect(unplayed(outcome, library.entries)).toHaveLength(16);
  });

  it('reports nothing unplayed once everything has aired', () => {
    const library = libraryOf(TWENTY.slice(0, 4));
    const outcome = fillDay(dayInput({ clock: musicClock(2), library, hours: 2 }));
    expect(unplayed(outcome, library.entries)).toEqual([]);
  });
});

describe('breaches and holes across a day', () => {
  it('collects the breaches of every hour', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(ONE_ARTIST), hours: 2 }),
    );
    expect(outcome.breaches.length).toBeGreaterThan(0);
    expect(isCleanDay(outcome)).toBe(false);
  });

  it('names the rule on each breach', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(ONE_ARTIST), hours: 2 }),
    );
    expect(outcome.breaches.map((each) => each.rule)).toContain('artist separation');
  });

  it('collects the holes of every hour with a diagnosis', () => {
    const outcome = fillDay(dayInput({ clock: musicClock(3), library: libraryOf([]), hours: 2 }));
    expect(outcome.holes).toHaveLength(6);
    expect(outcome.holes[0]?.diagnosis.cause).toBe('category empty');
    expect(outcome.holes[0]?.category).toBe('A');
  });

  it('trades breaches for holes as the floor rises', () => {
    const loose = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(ONE_ARTIST), hours: 2 }),
    );
    resetFixtures();
    const strict = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(ONE_ARTIST), hours: 2, floor: 2 }),
    );
    expect(loose.holes.length).toBeLessThan(strict.holes.length);
    expect(loose.breaches.length).toBeGreaterThan(strict.breaches.length);
  });

  it('reports completeness as filled over attempted', () => {
    const full = fillDay(dayInput({ clock: musicClock(3), library: libraryOf(TWENTY), hours: 2 }));
    resetFixtures();
    const empty = fillDay(dayInput({ clock: musicClock(3), library: libraryOf([]), hours: 2 }));
    expect(completeness(full)).toBe(1);
    expect(completeness(empty)).toBe(0);
  });

  it('reports a day that filled nothing at all as complete', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(TWENTY), hours: 0 }),
    );
    expect(completeness(outcome)).toBe(1);
  });
});

describe('the slot a rule is filling is only itself', () => {
  it('gives every placement of the day a distinct position', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(TWENTY), hours: 4 }),
    );
    const positions = outcome.placed.map((each) => each.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('keeps hour two out of hour one position space', () => {
    const outcome = fillDay(
      dayInput({ clock: musicClock(3), library: libraryOf(TWENTY), hours: 2 }),
    );
    const first = outcome.hours[0]?.outcome.placed.map((each) => each.position) ?? [];
    const second = outcome.hours[1]?.outcome.placed.map((each) => each.position) ?? [];
    expect(first.some((position) => second.includes(position))).toBe(false);
  });
});
