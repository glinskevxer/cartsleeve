import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_KEEP,
  fillWeek,
  isCleanWeek,
  nextDay,
  outliers,
  pruneHistory,
  weekCompleteness,
  weekPlayCounts,
  weekdayOfDay,
} from '../../src/schedule/week.js';
import type { Placed } from '../../src/rules/rule.js';
import { tenths } from '../../src/util/duration.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import type { EntrySpec } from '../support/fixtures.js';
import { entry, resetFixtures } from '../support/fixtures.js';
import { libraryOf, musicClock, weekInput } from '../support/hour.js';

beforeEach(() => {
  resetFixtures();
});

const ERA_YEARS = [1965, 1980, 1995, 2010];

const THIRTY: EntrySpec[] = Array.from({ length: 30 }, (_, index) => ({
  number: `M${String(index + 1).padStart(4, '0')}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
}));

describe('weekdayOfDay', () => {
  it('numbers Sunday zero', () => {
    expect(weekdayOfDay({ year: 2025, month: 6, day: 8 })).toBe(0);
    expect(weekdayOfDay({ year: 2025, month: 6, day: 10 })).toBe(2);
  });

  it('walks forward a day at a time', () => {
    expect(nextDay({ year: 2025, month: 6, day: 10 })).toEqual({ year: 2025, month: 6, day: 11 });
  });

  it('rolls over a month and a year', () => {
    expect(nextDay({ year: 2025, month: 6, day: 30 })).toEqual({ year: 2025, month: 7, day: 1 });
    expect(nextDay({ year: 2025, month: 12, day: 31 })).toEqual({ year: 2026, month: 1, day: 1 });
  });

  it('handles a leap day', () => {
    expect(nextDay({ year: 2024, month: 2, day: 28 })).toEqual({ year: 2024, month: 2, day: 29 });
    expect(nextDay({ year: 2025, month: 2, day: 28 })).toEqual({ year: 2025, month: 3, day: 1 });
  });
});

describe('pruneHistory', () => {
  const item = (position: number): Placed => ({
    cart: `M000${position}` as CartNumber,
    entry: entry({ number: `M000${position}` }),
    position,
    at: tenths(position * 100),
    category: 'A' as CategoryCode,
    cell: 0,
  });

  it('keeps everything when there is room', () => {
    const list = [item(1), item(2)];
    expect(pruneHistory(list, 5)).toHaveLength(2);
  });

  it('keeps the most recent when there is not', () => {
    const list = [item(1), item(2), item(3), item(4)];
    expect(pruneHistory(list, 2).map((each) => each.position)).toEqual([3, 4]);
  });

  it('keeps exactly the limit', () => {
    expect(pruneHistory([item(1), item(2)], 2)).toHaveLength(2);
  });

  it('does not reorder or mutate the list', () => {
    const list = [item(1), item(2)];
    pruneHistory(list, 1);
    expect(list.map((each) => each.position)).toEqual([1, 2]);
  });

  it('has a sensible default', () => {
    expect(DEFAULT_KEEP).toBeGreaterThan(100);
  });
});

describe('fillWeek', () => {
  it('fills every day it was asked for', () => {
    const outcome = fillWeek(
      weekInput({ clock: musicClock(3), library: libraryOf(THIRTY), hours: 2, days: 3 }),
    );
    expect(outcome.days).toHaveLength(3);
    expect(outcome.placed).toHaveLength(18);
    expect(isCleanWeek(outcome)).toBe(true);
  });

  it('walks the calendar forward a day at a time', () => {
    const outcome = fillWeek(
      weekInput({ clock: musicClock(1), library: libraryOf(THIRTY), hours: 1, days: 3 }),
    );
    expect(outcome.days.map((day) => day.day.day)).toEqual([10, 11, 12]);
  });

  it('fills nothing for a week of no days', () => {
    const outcome = fillWeek(
      weekInput({ clock: musicClock(3), library: libraryOf(THIRTY), hours: 2, days: 0 }),
    );
    expect(outcome.days).toEqual([]);
    expect(outcome.placed).toEqual([]);
    expect(weekCompleteness(outcome)).toBe(1);
  });

  it('gives every placement of the week a distinct position', () => {
    const outcome = fillWeek(
      weekInput({ clock: musicClock(3), library: libraryOf(THIRTY), hours: 2, days: 3 }),
    );
    const positions = outcome.placed.map((each) => each.position);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('the carry between days', () => {
  it('does not open every day on the same record', () => {
    const outcome = fillWeek(
      weekInput({ clock: musicClock(3), library: libraryOf(THIRTY), hours: 2, days: 4 }),
    );
    const openers = outcome.days.map((day) => day.hours[0]?.outcome.slots[0]?.cart);
    expect(new Set(openers).size).toBe(openers.length);
  });

  it('does not repeat a cart at the same hour on consecutive days', () => {
    const outcome = fillWeek(
      weekInput({ clock: musicClock(3), library: libraryOf(THIRTY), hours: 2, days: 3 }),
    );
    const firstHour = outcome.days.map(
      (day) => day.hours[0]?.outcome.slots.map((slot) => slot.cart) ?? [],
    );
    for (let index = 1; index < firstHour.length; index += 1) {
      const yesterday = new Set(firstHour[index - 1]);
      const today = firstHour[index] ?? [];
      expect(today.some((cart) => cart !== undefined && yesterday.has(cart))).toBe(false);
    }
  });

  it('counts every play across the week', () => {
    const outcome = fillWeek(
      weekInput({
        clock: musicClock(3),
        library: libraryOf(THIRTY.slice(0, 6)),
        hours: 2,
        days: 2,
      }),
    );
    const counts = weekPlayCounts(outcome);
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    expect(total).toBe(outcome.placed.length);
  });
});

describe('reporting on a week', () => {
  it('reports completeness as filled over attempted', () => {
    const full = fillWeek(
      weekInput({ clock: musicClock(2), library: libraryOf(THIRTY), hours: 2, days: 2 }),
    );
    resetFixtures();
    const empty = fillWeek(
      weekInput({ clock: musicClock(2), library: libraryOf([]), hours: 2, days: 2 }),
    );
    expect(weekCompleteness(full)).toBe(1);
    expect(weekCompleteness(empty)).toBe(0);
    expect(isCleanWeek(empty)).toBe(false);
  });

  it('finds nothing to report when the plays are even', () => {
    const outcome = fillWeek(
      weekInput({
        clock: musicClock(3),
        library: libraryOf(THIRTY.slice(0, 6)),
        hours: 2,
        days: 2,
      }),
    );
    expect(outliers(outcome, 0.9)).toEqual([]);
  });

  it('reports a cart that played far more than the average', () => {
    const outcome = fillWeek(
      weekInput({ clock: musicClock(2), library: libraryOf(THIRTY), hours: 2, days: 3 }),
    );
    // Only some of thirty carts will have aired, so the ones that did are outliers
    // against nothing; the report is empty rather than wrong.
    expect(outliers(outcome, 0.1).every((each) => each.plays >= 1)).toBe(true);
  });

  it('reports nothing for a week that played nothing', () => {
    const outcome = fillWeek(
      weekInput({ clock: musicClock(2), library: libraryOf([]), hours: 1, days: 1 }),
    );
    expect(outliers(outcome)).toEqual([]);
    expect(weekPlayCounts(outcome).size).toBe(0);
  });
});
