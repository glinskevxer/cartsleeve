import { describe, expect, it } from 'vitest';
import {
  DAY_NAMES,
  EVERY_DAY,
  HOURS_IN_WEEK,
  WEEKDAYS,
  WEEKEND,
  cellCount,
  cellOf,
  covers,
  coversCell,
  dayOfCell,
  formatCell,
  hourOfCell,
  makeDaypart,
  overlap,
  uncovered,
} from '../../src/domain/daypart.js';
import { expectErr, expectOk } from '../support/result.js';

const morning = () =>
  expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));

describe('week cells', () => {
  it('numbers from Sunday hour zero', () => {
    expect(cellOf(0, 0)).toBe(0);
    expect(cellOf(1, 6)).toBe(30);
    expect(cellOf(6, 23)).toBe(HOURS_IN_WEEK - 1);
  });

  it('reads the day and hour back out', () => {
    for (const cell of [0, 30, 99, 167]) {
      expect(cellOf(dayOfCell(cell), hourOfCell(cell))).toBe(cell);
    }
  });

  it('formats a cell for a report', () => {
    expect(formatCell(cellOf(1, 6))).toBe('Mon 06');
    expect(formatCell(cellOf(0, 0))).toBe('Sun 00');
    expect(DAY_NAMES).toHaveLength(7);
  });
});

describe('makeDaypart', () => {
  it('expands a weekday band into its cells', () => {
    const daypart = morning();
    expect(cellCount(daypart)).toBe(20);
    expect(covers(daypart, 1, 6)).toBe(true);
    expect(covers(daypart, 1, 9)).toBe(true);
    expect(covers(daypart, 1, 10)).toBe(false);
    expect(covers(daypart, 0, 6)).toBe(false);
  });

  it('collapses two spans that share cells', () => {
    const daypart = expectOk(
      makeDaypart('OVN', [
        { days: [...WEEKEND], fromHour: 0, toHour: 6 },
        { days: [6], fromHour: 0, toHour: 4 },
      ]),
    );
    expect(cellCount(daypart)).toBe(12);
  });

  it('builds a daypart that is not contiguous', () => {
    const daypart = expectOk(
      makeDaypart('SPLIT', [
        { days: [1], fromHour: 6, toHour: 8 },
        { days: [5], fromHour: 20, toHour: 22 },
      ]),
    );
    expect(cellCount(daypart)).toBe(4);
    expect(covers(daypart, 1, 7)).toBe(true);
    expect(covers(daypart, 5, 21)).toBe(true);
    expect(covers(daypart, 3, 7)).toBe(false);
  });

  it('trims the name', () => {
    expect(expectOk(makeDaypart('  AMD  ', [{ days: [1], fromHour: 0, toHour: 1 }])).name).toBe(
      'AMD',
    );
  });

  it('rejects an unnamed daypart and one with no spans', () => {
    expect(expectErr(makeDaypart(' ', [{ days: [1], fromHour: 0, toHour: 1 }]))[0]?.code).toBe(
      'CLK-001',
    );
    expect(expectErr(makeDaypart('AMD', []))[0]?.code).toBe('CLK-002');
  });

  it('rejects an empty or reversed hour band', () => {
    expect(expectErr(makeDaypart('X', [{ days: [1], fromHour: 6, toHour: 6 }]))[0]?.code).toBe(
      'CLK-003',
    );
    expect(expectErr(makeDaypart('X', [{ days: [1], fromHour: 10, toHour: 6 }]))[0]?.code).toBe(
      'CLK-003',
    );
  });

  it('rejects a band that runs past the end of the day rather than wrapping', () => {
    const problems = expectErr(makeDaypart('X', [{ days: [1], fromHour: 22, toHour: 26 }]));
    expect(problems[0]?.code).toBe('CLK-003');
    expect(problems[0]?.detail?.['to']).toBe(26);
  });

  it('rejects a band on no days and a day outside the week', () => {
    expect(expectErr(makeDaypart('X', [{ days: [], fromHour: 6, toHour: 8 }]))[0]?.code).toBe(
      'CLK-004',
    );
    expect(expectErr(makeDaypart('X', [{ days: [7], fromHour: 6, toHour: 8 }]))[0]?.code).toBe(
      'CLK-005',
    );
  });
});

describe('relating dayparts', () => {
  it('finds the cells two dayparts share, in order', () => {
    const a = expectOk(makeDaypart('A', [{ days: [1], fromHour: 6, toHour: 10 }]));
    const b = expectOk(makeDaypart('B', [{ days: [1], fromHour: 9, toHour: 12 }]));
    expect(overlap(a, b).map(formatCell)).toEqual(['Mon 09']);
    expect(overlap(b, a)).toEqual(overlap(a, b));
  });

  it('reports no overlap when there is none', () => {
    const a = expectOk(makeDaypart('A', [{ days: [1], fromHour: 6, toHour: 10 }]));
    const b = expectOk(makeDaypart('B', [{ days: [2], fromHour: 6, toHour: 10 }]));
    expect(overlap(a, b)).toEqual([]);
  });

  it('finds the hours no daypart claims', () => {
    const weekdaysOnly = expectOk(
      makeDaypart('ALLWK', [{ days: [...WEEKDAYS], fromHour: 0, toHour: 24 }]),
    );
    const gaps = uncovered([weekdaysOnly]);
    expect(gaps).toHaveLength(48);
    expect(gaps.every((cell) => dayOfCell(cell) === 0 || dayOfCell(cell) === 6)).toBe(true);
  });

  it('reports the whole week uncovered when nothing is defined', () => {
    expect(uncovered([])).toHaveLength(HOURS_IN_WEEK);
  });

  it('reports nothing uncovered once every day is claimed', () => {
    const all = expectOk(makeDaypart('ALL', [{ days: [...EVERY_DAY], fromHour: 0, toHour: 24 }]));
    expect(uncovered([all])).toEqual([]);
    expect(cellCount(all)).toBe(HOURS_IN_WEEK);
  });

  it('answers membership by cell as well as by day and hour', () => {
    expect(coversCell(morning(), cellOf(1, 6))).toBe(true);
    expect(coversCell(morning(), cellOf(1, 22))).toBe(false);
  });
});
