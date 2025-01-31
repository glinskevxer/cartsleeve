/**
 * The clock grid.
 *
 * One clock per hour of the week, plus overrides for named dates. The grid is
 * the thing that turns a handful of clock templates into a week of programming,
 * and it is the reason a cart restricted out of morning drive is really
 * restricted out of whichever clocks happen to sit in those cells.
 *
 * That indirection is easy to miss. Changing which clock runs at Monday 06:00
 * changes what categories are asked for at Monday 06:00, which changes the
 * turnover of those categories, which changes rest across the whole week. The
 * grid looks like configuration and behaves like a scheduling decision.
 */

import { HOURS_IN_WEEK, cellOf, dayOfCell, formatCell, hourOfCell } from './daypart.js';
import type { WeekCell } from './daypart.js';
import type { Clock } from './clock.js';
import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';
import { formatBroadcastDay } from '../util/time.js';
import type { BroadcastDay } from '../util/time.js';

export interface GridSpan {
  readonly days: readonly number[];
  readonly fromHour: number;
  readonly toHour: number;
  readonly clock: string;
}

export interface Grid {
  readonly name: string;
  /** Clock name for each of the 168 cells. */
  readonly cells: readonly string[];
  /** Whole days that run a different assignment, keyed by broadcast day. */
  readonly overrides: ReadonlyMap<string, readonly string[]>;
}

const GRD = (n: number): string => codeFor('clock', n);

export function makeGrid(
  name: string,
  spans: readonly GridSpan[],
  clocks: readonly Clock[],
): Result<Grid, Problem[]> {
  const problems: Problem[] = [];
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    problems.push(error(GRD(50), name, 'has no name'));
  }
  const known = new Set(clocks.map((clock) => clock.name));
  const cells: (string | undefined)[] = Array.from({ length: HOURS_IN_WEEK }, () => undefined);
  for (const span of spans) {
    if (!known.has(span.clock)) {
      problems.push(
        error(GRD(51), trimmed, `names a clock nothing defines`, { clock: span.clock }),
      );
      continue;
    }
    if (span.fromHour < 0 || span.toHour > 24 || span.fromHour >= span.toHour) {
      problems.push(
        error(GRD(52), trimmed, 'has an hour band that is empty or runs past the day', {
          from: span.fromHour,
          to: span.toHour,
        }),
      );
      continue;
    }
    for (const day of span.days) {
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        problems.push(error(GRD(53), trimmed, 'names a day outside the week', { day }));
        continue;
      }
      for (let hour = span.fromHour; hour < span.toHour; hour += 1) {
        const cell = cellOf(day, hour);
        const already = cells[cell];
        if (already !== undefined && already !== span.clock) {
          problems.push(
            error(GRD(54), trimmed, `assigns ${formatCell(cell)} twice`, {
              first: already,
              second: span.clock,
            }),
          );
          continue;
        }
        cells[cell] = span.clock;
      }
    }
  }
  const missing = cells.reduce<number[]>(
    (out, value, index) => (value === undefined ? [...out, index] : out),
    [],
  );
  if (missing.length > 0) {
    problems.push(
      error(GRD(55), trimmed, 'leaves hours of the week with no clock', {
        count: missing.length,
        first: formatCell(missing[0] ?? 0),
      }),
    );
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    name: trimmed,
    cells: cells.map((value) => value ?? ''),
    overrides: new Map<string, readonly string[]>(),
  });
}

export function clockAt(grid: Grid, day: number, hour: number): string | undefined {
  return grid.cells[cellOf(day, hour)];
}

export function clockAtCell(grid: Grid, cell: WeekCell): string | undefined {
  return grid.cells[cell];
}

/**
 * The clock for a given broadcast day and hour, honouring an override. Weekday
 * is the day the broadcast day is filed under, so an overnight hour reads the
 * clock of the day that started the evening before.
 */
export function clockFor(
  grid: Grid,
  day: BroadcastDay,
  weekday: number,
  hour: number,
): string | undefined {
  const override = grid.overrides.get(formatBroadcastDay(day));
  if (override !== undefined) {
    return override[hour];
  }
  return clockAt(grid, weekday, hour);
}

export function withOverride(grid: Grid, day: BroadcastDay, clocks: readonly string[]): Grid {
  const overrides = new Map(grid.overrides);
  overrides.set(formatBroadcastDay(day), [...clocks]);
  return { ...grid, overrides };
}

/** Which cells each clock covers, so a clock edit can be costed. */
export function clockUsage(grid: Grid): Map<string, WeekCell[]> {
  const usage = new Map<string, WeekCell[]>();
  for (const [cell, clock] of grid.cells.entries()) {
    const bucket = usage.get(clock);
    if (bucket === undefined) {
      usage.set(clock, [cell]);
    } else {
      bucket.push(cell);
    }
  }
  return usage;
}

export function auditGrid(grid: Grid, clocks: readonly Clock[]): Problem[] {
  const problems: Problem[] = [];
  const used = new Set(grid.cells);
  for (const clock of clocks) {
    if (!used.has(clock.name)) {
      problems.push(
        warning(GRD(56), grid.name, 'defines a clock the grid never runs', { clock: clock.name }),
      );
    }
  }
  for (const [day, hours] of grid.overrides) {
    if (hours.length !== 24) {
      problems.push(
        error(GRD(57), grid.name, `has an override that is not a whole day`, {
          day,
          hours: hours.length,
        }),
      );
    }
  }
  return problems;
}

export function describeCell(cell: WeekCell): string {
  return `${formatCell(cell)} (day ${dayOfCell(cell)} hour ${hourOfCell(cell)})`;
}
