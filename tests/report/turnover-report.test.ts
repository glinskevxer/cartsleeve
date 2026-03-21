import { describe, expect, it } from 'vitest';
import { misleading, renderTurnover, turnoverRows } from '../../src/report/turnover-report.js';
import type { TurnoverInput } from '../../src/report/turnover-report.js';
import { fitsPage } from '../../src/report/frame.js';
import { demandOf } from '../../src/rotation/turnover.js';
import { makeClock } from '../../src/domain/clock.js';
import { makeGrid } from '../../src/domain/grid.js';
import { EVERY_DAY, WEEKDAYS, makeDaypart } from '../../src/domain/daypart.js';
import { NO_RESTRICTIONS, makeRestrictionMap } from '../../src/library/restriction.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { expectOk } from '../support/result.js';

const cart = (value: string): CartNumber => value as CartNumber;
const code = (value: string): CategoryCode => value as CategoryCode;

const CLOCK = expectOk(
  makeClock('FLAT', [
    { kind: 'music', target: '0:00', category: 'A' },
    { kind: 'music', target: '3:30', category: 'G' },
  ]),
);
const GRID = expectOk(
  makeGrid('flat', [{ days: [...EVERY_DAY], fromHour: 0, toHour: 24, clock: 'FLAT' }], [CLOCK]),
);
const PROFILE = demandOf(GRID, [CLOCK]);

const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));

const carts = (count: number): CartNumber[] =>
  Array.from({ length: count }, (_, index) => cart(`M${String(index + 1).padStart(4, '0')}`));

const input = (over: Partial<TurnoverInput> = {}): TurnoverInput => ({
  profile: PROFILE,
  restrictions: NO_RESTRICTIONS,
  categories: [
    { code: code('A'), carts: carts(40) },
    { code: code('G'), carts: carts(400) },
  ],
  ...over,
});

describe('turnoverRows', () => {
  it('gives one row per category', () => {
    expect(turnoverRows(input()).map((each) => each.category)).toEqual(['A', 'G']);
  });

  it('reports the size and the weekly slots', () => {
    const rows = turnoverRows(input());
    expect(rows[0]?.size).toBe(40);
    expect(rows[0]?.slotsPerWeek).toBe(168);
  });

  it('turns a bigger category over more slowly', () => {
    const rows = turnoverRows(input());
    expect((rows[1]?.days ?? 0) > (rows[0]?.days ?? 0)).toBe(true);
  });

  it('calls an unrestricted category even', () => {
    expect(turnoverRows(input()).every((each) => each.spread < 1.05)).toBe(true);
  });

  it('opens a spread once part of the category is restricted', () => {
    const restrictions = expectOk(
      makeRestrictionMap(
        carts(20).map((number) => ({ cart: number, mode: 'deny' as const, dayparts: ['AMD'] })),
        [AMD],
      ),
    );
    const rows = turnoverRows(input({ restrictions }));
    expect(rows[0]?.spread).toBeGreaterThan(1.05);
  });

  it('names carts that can never play', () => {
    const parked = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'allow', dayparts: [] }], [AMD]),
    );
    const rows = turnoverRows(input({ restrictions: parked }));
    expect(rows[0]?.unreachable).toEqual(['M0001']);
  });

  it('handles a category with nothing in it', () => {
    const rows = turnoverRows(input({ categories: [{ code: code('A'), carts: [] }] }));
    expect(rows[0]?.size).toBe(0);
    expect(rows[0]?.playsPerWeek).toBe(0);
  });

  it('handles a category nothing asks for', () => {
    const rows = turnoverRows(input({ categories: [{ code: code('R'), carts: carts(10) }] }));
    expect(rows[0]?.slotsPerWeek).toBe(0);
    expect(Number.isFinite(rows[0]?.days ?? 0)).toBe(false);
  });

  it('reports no categories at all', () => {
    expect(turnoverRows(input({ categories: [] }))).toEqual([]);
  });
});

describe('renderTurnover', () => {
  it('opens with the title and the station', () => {
    const lines = renderTurnover(turnoverRows(input()), 'KHRT');
    expect(lines[0]?.trim()).toBe('TURNOVER');
    expect(lines.join('\n')).toContain('KHRT');
  });

  it('prints a row per category', () => {
    const lines = renderTurnover(turnoverRows(input()), 'KHRT');
    expect(lines).toContain('CATEGORIES');
    expect(lines.join('\n')).toContain('168');
  });

  it('prints never for a category nothing asks for', () => {
    const rows = turnoverRows(input({ categories: [{ code: code('R'), carts: carts(10) }] }));
    expect(renderTurnover(rows, 'KHRT').join('\n')).toContain('never');
  });

  it('drops the unreachable section when there is nothing in it', () => {
    expect(renderTurnover(turnoverRows(input()), 'KHRT')).not.toContain('UNREACHABLE');
  });

  it('prints the unreachable section when there is', () => {
    const parked = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'allow', dayparts: [] }], [AMD]),
    );
    const lines = renderTurnover(turnoverRows(input({ restrictions: parked })), 'KHRT');
    expect(lines).toContain('UNREACHABLE');
    expect(lines.join('\n')).toContain('M0001');
  });

  it('fits the page', () => {
    expect(fitsPage(renderTurnover(turnoverRows(input()), 'KHRT'))).toBe(true);
  });

  it('renders a report with no categories', () => {
    expect(renderTurnover([], 'KHRT').length).toBeGreaterThan(2);
  });
});

describe('misleading', () => {
  it('names the categories whose average hides the spread', () => {
    const restrictions = expectOk(
      makeRestrictionMap(
        carts(30).map((number) => ({ cart: number, mode: 'deny' as const, dayparts: ['AMD'] })),
        [AMD],
      ),
    );
    const rows = turnoverRows(input({ restrictions }));
    expect(misleading(rows, 1.05).map((each) => each.category)).toContain('A');
  });

  it('names nothing when every category is even', () => {
    expect(misleading(turnoverRows(input()))).toEqual([]);
  });
});
