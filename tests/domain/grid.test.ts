import { describe, expect, it } from 'vitest';
import {
  auditGrid,
  clockAt,
  clockAtCell,
  clockFor,
  clockUsage,
  describeCell,
  makeGrid,
  withOverride,
} from '../../src/domain/grid.js';
import type { GridSpan } from '../../src/domain/grid.js';
import { makeClock } from '../../src/domain/clock.js';
import { EVERY_DAY, WEEKDAYS, WEEKEND, cellOf } from '../../src/domain/daypart.js';
import { expectErr, expectOk } from '../support/result.js';

const CLOCKS = [
  expectOk(makeClock('AMD', [{ kind: 'music', target: '0:00', category: 'A' }])),
  expectOk(makeClock('DAY', [{ kind: 'music', target: '0:00', category: 'B' }])),
  expectOk(makeClock('OVN', [{ kind: 'music', target: '0:00', category: 'G' }])),
];

const FULL: GridSpan[] = [
  { days: [...WEEKDAYS], fromHour: 6, toHour: 10, clock: 'AMD' },
  { days: [...WEEKDAYS], fromHour: 10, toHour: 24, clock: 'DAY' },
  { days: [...WEEKDAYS], fromHour: 0, toHour: 6, clock: 'OVN' },
  { days: [...WEEKEND], fromHour: 0, toHour: 24, clock: 'DAY' },
];

const grid = () => expectOk(makeGrid('standard', FULL, CLOCKS));

describe('makeGrid', () => {
  it('covers every hour of the week', () => {
    expect(grid().cells).toHaveLength(168);
    expect(grid().cells.every((c) => c.length > 0)).toBe(true);
  });

  it('puts each clock where the span said', () => {
    const built = grid();
    expect(clockAt(built, 1, 7)).toBe('AMD');
    expect(clockAt(built, 1, 11)).toBe('DAY');
    expect(clockAt(built, 1, 3)).toBe('OVN');
    expect(clockAt(built, 0, 7)).toBe('DAY');
  });

  it('reads a cell by its number too', () => {
    expect(clockAtCell(grid(), cellOf(1, 7))).toBe('AMD');
    expect(clockAtCell(grid(), 999)).toBeUndefined();
  });

  it('rejects an unnamed grid', () => {
    expect(expectErr(makeGrid(' ', FULL, CLOCKS))[0]?.code).toBe('CLK-050');
  });

  it('rejects a span naming a clock nothing defines', () => {
    const problems = expectErr(
      makeGrid('x', [...FULL, { days: [1], fromHour: 6, toHour: 7, clock: 'NOPE' }], CLOCKS),
    );
    expect(problems[0]?.code).toBe('CLK-051');
    expect(problems[0]?.detail?.['clock']).toBe('NOPE');
  });

  it('rejects an empty or over long hour band', () => {
    expect(
      expectErr(makeGrid('x', [{ days: [1], fromHour: 6, toHour: 6, clock: 'AMD' }], CLOCKS))[0]
        ?.code,
    ).toBe('CLK-052');
    expect(
      expectErr(makeGrid('x', [{ days: [1], fromHour: 20, toHour: 25, clock: 'AMD' }], CLOCKS))[0]
        ?.code,
    ).toBe('CLK-052');
  });

  it('rejects a day outside the week', () => {
    expect(
      expectErr(makeGrid('x', [{ days: [9], fromHour: 0, toHour: 24, clock: 'AMD' }], CLOCKS))[0]
        ?.code,
    ).toBe('CLK-053');
  });

  it('rejects two different clocks assigned to the same cell', () => {
    const problems = expectErr(
      makeGrid('x', [...FULL, { days: [1], fromHour: 7, toHour: 8, clock: 'DAY' }], CLOCKS),
    );
    expect(problems.some((p) => p.code === 'CLK-054')).toBe(true);
  });

  it('accepts the same clock assigned to a cell twice', () => {
    expect(
      expectOk(
        makeGrid('x', [...FULL, { days: [1], fromHour: 7, toHour: 8, clock: 'AMD' }], CLOCKS),
      ).cells,
    ).toHaveLength(168);
  });

  it('rejects a grid that leaves hours unassigned and counts them', () => {
    const problems = expectErr(
      makeGrid('x', [{ days: [...EVERY_DAY], fromHour: 0, toHour: 12, clock: 'DAY' }], CLOCKS),
    );
    expect(problems[0]?.code).toBe('CLK-055');
    expect(problems[0]?.detail?.['count']).toBe(84);
    expect(problems[0]?.detail?.['first']).toBe('Sun 12');
  });
});

describe('overrides', () => {
  const holiday = { year: 2025, month: 12, day: 25 };

  it('reads the grid when there is no override', () => {
    expect(clockFor(grid(), holiday, 4, 7)).toBe('AMD');
  });

  it('reads the override when there is one', () => {
    const overridden = withOverride(
      grid(),
      holiday,
      Array.from({ length: 24 }, () => 'OVN'),
    );
    expect(clockFor(overridden, holiday, 4, 7)).toBe('OVN');
    expect(clockFor(overridden, { year: 2025, month: 12, day: 26 }, 5, 7)).toBe('AMD');
  });

  it('does not change the grid it was applied to', () => {
    const original = grid();
    withOverride(
      original,
      holiday,
      Array.from({ length: 24 }, () => 'OVN'),
    );
    expect(original.overrides.size).toBe(0);
  });

  it('flags an override that is not a whole day', () => {
    const broken = withOverride(grid(), holiday, ['OVN', 'OVN']);
    const problems = auditGrid(broken, CLOCKS);
    expect(problems[0]?.code).toBe('CLK-057');
    expect(problems[0]?.detail?.['hours']).toBe(2);
  });
});

describe('usage', () => {
  it('counts the cells each clock covers', () => {
    const usage = clockUsage(grid());
    expect(usage.get('AMD')).toHaveLength(20);
    expect(usage.get('OVN')).toHaveLength(30);
    expect(usage.get('DAY')).toHaveLength(118);
  });

  it('flags a clock the grid never runs', () => {
    const spare = expectOk(makeClock('SPARE', [{ kind: 'music', target: '0:00', category: 'A' }]));
    const problems = auditGrid(grid(), [...CLOCKS, spare]);
    expect(problems[0]?.code).toBe('CLK-056');
    expect(problems[0]?.detail?.['clock']).toBe('SPARE');
  });

  it('passes when every clock is used', () => {
    expect(auditGrid(grid(), CLOCKS)).toEqual([]);
  });

  it('describes a cell for a report', () => {
    expect(describeCell(cellOf(1, 7))).toBe('Mon 07 (day 1 hour 7)');
  });
});
