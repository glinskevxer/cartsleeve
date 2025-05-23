import { describe, expect, it } from 'vitest';
import {
  HOURS_IN_DAY,
  activeCells,
  demandOf,
  describeCellDemand,
  describeTurnover,
  nominalTurnover,
  playsPerWeek,
  slotsInCell,
  slotsInDaypart,
  slotsPerWeek,
} from '../../src/rotation/turnover.js';
import { makeClock } from '../../src/domain/clock.js';
import { makeGrid } from '../../src/domain/grid.js';
import { EVERY_DAY, WEEKDAYS, WEEKEND, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import type { CategoryCode } from '../../src/util/ids.js';
import { expectOk } from '../support/result.js';

const code = (value: string): CategoryCode => value as CategoryCode;

const HOT = expectOk(
  makeClock('HOT', [
    { kind: 'music', target: '0:00', category: 'A' },
    { kind: 'music', target: '3:30', category: 'A' },
    { kind: 'music', target: '7:00', category: 'B' },
    { kind: 'music', target: '10:30', category: 'G' },
  ]),
);

const GOLD = expectOk(
  makeClock('GOLD', [
    { kind: 'music', target: '0:00', category: 'G' },
    { kind: 'music', target: '3:30', category: 'G' },
    { kind: 'music', target: '7:00', category: 'A' },
  ]),
);

const CLOCKS = [HOT, GOLD];

const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));

/** Weekdays 6 to 10 run HOT, everything else runs GOLD. */
const GRID = expectOk(
  makeGrid(
    'standard',
    [
      { days: [...WEEKDAYS], fromHour: 6, toHour: 10, clock: 'HOT' },
      { days: [...WEEKDAYS], fromHour: 10, toHour: 24, clock: 'GOLD' },
      { days: [...WEEKDAYS], fromHour: 0, toHour: 6, clock: 'GOLD' },
      { days: [...WEEKEND], fromHour: 0, toHour: 24, clock: 'GOLD' },
    ],
    CLOCKS,
  ),
);

const PROFILE = demandOf(GRID, CLOCKS);

describe('demandOf', () => {
  it('totals what each category is asked for across the week', () => {
    // 20 HOT hours give A two each, 148 GOLD hours give A one each.
    expect(slotsPerWeek(PROFILE, code('A'))).toBe(20 * 2 + 148);
    expect(slotsPerWeek(PROFILE, code('B'))).toBe(20);
    expect(slotsPerWeek(PROFILE, code('G'))).toBe(20 + 148 * 2);
  });

  it('reports nothing for a category no clock asks for', () => {
    expect(slotsPerWeek(PROFILE, code('R'))).toBe(0);
  });

  it('reports what each cell asks for', () => {
    expect(slotsInCell(PROFILE, code('A'), cellOf(1, 7))).toBe(2);
    expect(slotsInCell(PROFILE, code('A'), cellOf(1, 12))).toBe(1);
    expect(slotsInCell(PROFILE, code('B'), cellOf(1, 12))).toBe(0);
    expect(slotsInCell(PROFILE, code('B'), cellOf(0, 7))).toBe(0);
  });

  it('sums a daypart from its own cells', () => {
    expect(slotsInDaypart(PROFILE, code('A'), AMD)).toBe(40);
    expect(slotsInDaypart(PROFILE, code('B'), AMD)).toBe(20);
    expect(slotsInDaypart(PROFILE, code('G'), AMD)).toBe(20);
  });

  it('lists only the cells a category is asked for in', () => {
    expect(activeCells(PROFILE, code('B'))).toHaveLength(20);
    expect(activeCells(PROFILE, code('A'))).toHaveLength(168);
    expect(activeCells(PROFILE, code('R'))).toEqual([]);
  });

  it('reads a grid whose clocks are all the same', () => {
    const flat = expectOk(
      makeGrid('flat', [{ days: [...EVERY_DAY], fromHour: 0, toHour: 24, clock: 'HOT' }], CLOCKS),
    );
    expect(slotsPerWeek(demandOf(flat, CLOCKS), code('A'))).toBe(168 * 2);
  });

  it('reports nothing when the grid names a clock nothing supplies', () => {
    const orphan = { ...GRID, cells: GRID.cells.map(() => 'MISSING') };
    expect(slotsPerWeek(demandOf(orphan, CLOCKS), code('A'))).toBe(0);
  });
});

describe('nominalTurnover', () => {
  it('is size over demand, scaled to the week', () => {
    const turnover = nominalTurnover(PROFILE, code('B'), 40);
    expect(turnover.slotsPerWeek).toBe(20);
    expect(turnover.hours).toBe((40 * 168) / 20);
    expect(turnover.days).toBe(turnover.hours / HOURS_IN_DAY);
  });

  it('turns over faster as the category shrinks', () => {
    expect(nominalTurnover(PROFILE, code('B'), 20).hours).toBeLessThan(
      nominalTurnover(PROFILE, code('B'), 40).hours,
    );
  });

  it('turns over faster as the demand grows', () => {
    expect(nominalTurnover(PROFILE, code('A'), 100).hours).toBeLessThan(
      nominalTurnover(PROFILE, code('B'), 100).hours,
    );
  });

  it('never turns over when nothing asks for the category', () => {
    const turnover = nominalTurnover(PROFILE, code('R'), 40);
    expect(turnover.hours).toBe(Number.POSITIVE_INFINITY);
    expect(describeTurnover(turnover)).toBe('R never turns over');
  });

  it('turns over instantly when the category is empty', () => {
    expect(nominalTurnover(PROFILE, code('B'), 0).hours).toBe(0);
  });

  it('describes the figure in days', () => {
    expect(describeTurnover(nominalTurnover(PROFILE, code('B'), 20))).toBe(
      'B turns over in 7.0 days',
    );
  });
});

describe('playsPerWeek', () => {
  it('is the demand shared out over the category', () => {
    expect(playsPerWeek(PROFILE, code('B'), 20)).toBe(1);
    expect(playsPerWeek(PROFILE, code('B'), 10)).toBe(2);
  });

  it('is nothing for an empty category', () => {
    expect(playsPerWeek(PROFILE, code('B'), 0)).toBe(0);
  });

  it('is nothing for a category nothing asks for', () => {
    expect(playsPerWeek(PROFILE, code('R'), 40)).toBe(0);
  });

  it('reads back consistently with the turnover figure', () => {
    const size = 40;
    const turnover = nominalTurnover(PROFILE, code('A'), size);
    expect(playsPerWeek(PROFILE, code('A'), size) * turnover.hours).toBeCloseTo(168);
  });
});

describe('describeCellDemand', () => {
  it('names the day and hour', () => {
    expect(describeCellDemand(cellOf(1, 7), 2)).toBe('day 1 hour 7: 2');
  });
});
