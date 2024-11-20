import { describe, expect, it } from 'vitest';
import {
  ARIZONA,
  DAY_MS,
  HOUR_MS,
  MOUNTAIN,
  broadcastDayLength,
  broadcastDayOf,
  broadcastHourOf,
  civilFromDays,
  daysFromCivil,
  daysInMonth,
  daylightWindow,
  formatBroadcastDay,
  formatCivil,
  isDaylight,
  isLeapYear,
  nthWeekdayOfMonth,
  offsetAt,
  resolveCivil,
  startOfBroadcastDay,
  toCivil,
  toInstant,
  weekdayOf,
} from '../../src/util/time.js';

describe('calendar arithmetic', () => {
  it('knows the leap years', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('gives February the right length', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2025, 1)).toBe(31);
    expect(daysInMonth(2025, 4)).toBe(30);
  });

  it('round trips days and civil dates', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(2025, 3, 9)).toBe(20_156);
    expect(civilFromDays(0)).toEqual({ year: 1970, month: 1, day: 1 });
    expect(civilFromDays(20_156)).toEqual({ year: 2025, month: 3, day: 9 });
    for (const days of [-1, 1, 999, 19_000, 25_000]) {
      const civil = civilFromDays(days);
      expect(daysFromCivil(civil.year, civil.month, civil.day)).toBe(days);
    }
  });

  it('numbers weekdays from Sunday', () => {
    expect(weekdayOf(1970, 1, 1)).toBe(4);
    expect(weekdayOf(2025, 3, 9)).toBe(0);
    expect(weekdayOf(2025, 3, 10)).toBe(1);
  });
});

describe('nthWeekdayOfMonth', () => {
  it('finds the second Sunday in March 2025', () => {
    expect(nthWeekdayOfMonth(2025, 3, 0, 2)).toBe(9);
  });

  it('finds the first Sunday in November 2025', () => {
    expect(nthWeekdayOfMonth(2025, 11, 0, 1)).toBe(2);
  });

  it('counts back from the end for a negative n', () => {
    expect(nthWeekdayOfMonth(2025, 3, 0, -1)).toBe(30);
    expect(nthWeekdayOfMonth(2025, 3, 1, -1)).toBe(31);
  });
});

describe('daylight window', () => {
  it('opens at 02:00 standard and closes at 02:00 daylight', () => {
    const window = daylightWindow(MOUNTAIN, 2025);
    expect(toCivil({ ...MOUNTAIN, observesDaylight: false }, window.start)).toMatchObject({
      month: 3,
      day: 9,
      hour: 2,
    });
    expect(toCivil({ ...MOUNTAIN, observesDaylight: false }, window.end)).toMatchObject({
      month: 11,
      day: 2,
      hour: 1,
    });
  });

  it('reports the offset on each side', () => {
    const window = daylightWindow(MOUNTAIN, 2025);
    expect(offsetAt(MOUNTAIN, window.start - 1)).toBe(-420);
    expect(offsetAt(MOUNTAIN, window.start)).toBe(-360);
    expect(offsetAt(MOUNTAIN, window.end - 1)).toBe(-360);
    expect(offsetAt(MOUNTAIN, window.end)).toBe(-420);
    expect(isDaylight(MOUNTAIN, window.start)).toBe(true);
    expect(isDaylight(MOUNTAIN, window.end)).toBe(false);
  });

  it('leaves a zone that does not observe it alone all year', () => {
    const summer = toInstant(ARIZONA, {
      year: 2025,
      month: 7,
      day: 4,
      hour: 12,
      minute: 0,
      second: 0,
    });
    expect(offsetAt(ARIZONA, summer)).toBe(-420);
    expect(isDaylight(ARIZONA, summer)).toBe(false);
  });
});

describe('resolveCivil', () => {
  it('resolves an ordinary reading exactly', () => {
    const resolved = resolveCivil(MOUNTAIN, {
      year: 2025,
      month: 6,
      day: 12,
      hour: 9,
      minute: 30,
      second: 0,
    });
    expect(resolved.kind).toBe('exact');
    expect(toCivil(MOUNTAIN, resolved.instant)).toMatchObject({ hour: 9, minute: 30 });
  });

  it('reports the spring forward hour as a gap', () => {
    const resolved = resolveCivil(MOUNTAIN, {
      year: 2025,
      month: 3,
      day: 9,
      hour: 2,
      minute: 30,
      second: 0,
    });
    expect(resolved.kind).toBe('gap');
  });

  it('reports the fall back hour as ambiguous and offers both instants', () => {
    const resolved = resolveCivil(MOUNTAIN, {
      year: 2025,
      month: 11,
      day: 2,
      hour: 1,
      minute: 30,
      second: 0,
    });
    expect(resolved.kind).toBe('ambiguous');
    if (resolved.kind === 'ambiguous') {
      expect(resolved.later - resolved.instant).toBe(HOUR_MS);
      expect(toCivil(MOUNTAIN, resolved.instant)).toMatchObject({ hour: 1, minute: 30 });
      expect(toCivil(MOUNTAIN, resolved.later)).toMatchObject({ hour: 1, minute: 30 });
    }
  });

  it('never reports a gap or an ambiguity in a zone without daylight saving', () => {
    for (const hour of [1, 2, 3]) {
      expect(
        resolveCivil(ARIZONA, { year: 2025, month: 3, day: 9, hour, minute: 30, second: 0 }).kind,
      ).toBe('exact');
      expect(
        resolveCivil(ARIZONA, { year: 2025, month: 11, day: 2, hour, minute: 30, second: 0 }).kind,
      ).toBe('exact');
    }
  });

  it('round trips every hour of an ordinary day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const civil = { year: 2025, month: 5, day: 20, hour, minute: 15, second: 0 };
      expect(toCivil(MOUNTAIN, toInstant(MOUNTAIN, civil))).toEqual(civil);
    }
  });
});

describe('the broadcast day', () => {
  const start = 5;

  it('files an overnight hour against the day before', () => {
    const instant = toInstant(MOUNTAIN, {
      year: 2025,
      month: 6,
      day: 10,
      hour: 2,
      minute: 0,
      second: 0,
    });
    expect(broadcastDayOf(MOUNTAIN, instant, start)).toEqual({ year: 2025, month: 6, day: 9 });
  });

  it('files the hour the day starts on against itself', () => {
    const instant = toInstant(MOUNTAIN, {
      year: 2025,
      month: 6,
      day: 10,
      hour: 5,
      minute: 0,
      second: 0,
    });
    expect(broadcastDayOf(MOUNTAIN, instant, start)).toEqual({ year: 2025, month: 6, day: 10 });
  });

  it('rolls back across a month boundary', () => {
    const instant = toInstant(MOUNTAIN, {
      year: 2025,
      month: 7,
      day: 1,
      hour: 3,
      minute: 0,
      second: 0,
    });
    expect(broadcastDayOf(MOUNTAIN, instant, start)).toEqual({ year: 2025, month: 6, day: 30 });
  });

  it('numbers hours from the start of the day', () => {
    const at = (hour: number): number =>
      toInstant(MOUNTAIN, { year: 2025, month: 6, day: 10, hour, minute: 0, second: 0 });
    expect(broadcastHourOf(MOUNTAIN, at(5), start)).toBe(0);
    expect(broadcastHourOf(MOUNTAIN, at(12), start)).toBe(7);
    expect(broadcastHourOf(MOUNTAIN, at(2), start)).toBe(21);
  });

  it('starts the day at the configured hour', () => {
    const begins = startOfBroadcastDay(MOUNTAIN, { year: 2025, month: 6, day: 10 }, start);
    expect(toCivil(MOUNTAIN, begins)).toMatchObject({ hour: 5, minute: 0 });
  });

  it('is 23 hours long on the day that carried the spring forward', () => {
    expect(broadcastDayLength(MOUNTAIN, { year: 2025, month: 3, day: 8 }, start)).toBe(23);
    expect(broadcastDayLength(MOUNTAIN, { year: 2025, month: 3, day: 9 }, start)).toBe(24);
  });

  it('is 25 hours long on the day that carried the fall back', () => {
    expect(broadcastDayLength(MOUNTAIN, { year: 2025, month: 11, day: 1 }, start)).toBe(25);
    expect(broadcastDayLength(MOUNTAIN, { year: 2025, month: 11, day: 2 }, start)).toBe(24);
  });

  it('leaves an ordinary day and a zone without daylight saving at 24', () => {
    expect(broadcastDayLength(MOUNTAIN, { year: 2025, month: 6, day: 10 }, start)).toBe(24);
    expect(broadcastDayLength(ARIZONA, { year: 2025, month: 3, day: 8 }, start)).toBe(24);
  });

  it('moves which calendar day is short when the day start hour moves', () => {
    expect(broadcastDayLength(MOUNTAIN, { year: 2025, month: 3, day: 9 }, 0)).toBe(23);
    expect(broadcastDayLength(MOUNTAIN, { year: 2025, month: 3, day: 8 }, 0)).toBe(24);
    expect(broadcastDayLength(MOUNTAIN, { year: 2025, month: 11, day: 2 }, 0)).toBe(25);
  });
});

describe('formatting', () => {
  it('pads every field', () => {
    expect(formatCivil({ year: 2025, month: 3, day: 9, hour: 6, minute: 5, second: 4 })).toBe(
      '2025-03-09 06:05:04',
    );
    expect(formatBroadcastDay({ year: 2025, month: 11, day: 2 })).toBe('2025-11-02');
  });

  it('formats an instant a whole day later', () => {
    const base = toInstant(MOUNTAIN, {
      year: 2025,
      month: 6,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
    expect(formatCivil(toCivil(MOUNTAIN, base + DAY_MS))).toBe('2025-06-02 00:00:00');
  });
});
