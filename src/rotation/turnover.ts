/**
 * Turnover.
 *
 * How long a category takes to come once round. Every argument about a music
 * log is really an argument about this number, and almost every published
 * version of it is wrong in the same way: it is quoted as `size / plays per
 * hour` using the size on paper, when the plays per hour come from the clock
 * grid and the size is whatever the restrictions leave.
 *
 * The demand side is knowable exactly. The grid says which clock runs in each
 * of the week's 168 cells, and each clock says how many slots it gives each
 * category, so the plays per week are a sum and not an estimate. This module
 * does that sum; the next one takes the restrictions off the size.
 */

import type { CategoryCode } from '../util/ids.js';
import type { Clock } from '../domain/clock.js';
import { categoryDemand } from '../domain/clock.js';
import type { Grid } from '../domain/grid.js';
import { HOURS_IN_WEEK, dayOfCell, hourOfCell } from '../domain/daypart.js';
import type { Daypart, WeekCell } from '../domain/daypart.js';
import { coversCell } from '../domain/daypart.js';

export const HOURS_IN_DAY = 24;

export interface DemandProfile {
  /** Slots per week, per category. */
  readonly perWeek: ReadonlyMap<CategoryCode, number>;
  /** Slots per week per category, per cell, for the restricted computation. */
  readonly perCell: ReadonlyMap<CategoryCode, readonly number[]>;
}

/**
 * Walk the grid once and total what each category is asked for. Every figure
 * downstream is derived from this, so it is worth being exact rather than
 * assuming every hour runs the same clock.
 */
export function demandOf(grid: Grid, clocks: readonly Clock[]): DemandProfile {
  const byName = new Map(clocks.map((clock) => [clock.name, clock]));
  const cached = new Map<string, ReadonlyMap<CategoryCode, number>>();
  const perWeek = new Map<CategoryCode, number>();
  const perCell = new Map<CategoryCode, number[]>();
  for (let cell = 0; cell < HOURS_IN_WEEK; cell += 1) {
    const name = grid.cells[cell] ?? '';
    let demand = cached.get(name);
    if (demand === undefined) {
      const clock = byName.get(name);
      demand = clock === undefined ? new Map<CategoryCode, number>() : categoryDemand(clock);
      cached.set(name, demand);
    }
    for (const [category, count] of demand) {
      perWeek.set(category, (perWeek.get(category) ?? 0) + count);
      let cells = perCell.get(category);
      if (cells === undefined) {
        cells = Array.from({ length: HOURS_IN_WEEK }, () => 0);
        perCell.set(category, cells);
      }
      cells[cell] = (cells[cell] ?? 0) + count;
    }
  }
  return { perWeek, perCell };
}

export function slotsPerWeek(profile: DemandProfile, category: CategoryCode): number {
  return profile.perWeek.get(category) ?? 0;
}

export function slotsInCell(
  profile: DemandProfile,
  category: CategoryCode,
  cell: WeekCell,
): number {
  return (profile.perCell.get(category) ?? [])[cell] ?? 0;
}

/** Slots in the cells a daypart covers, which is what sales sells against. */
export function slotsInDaypart(
  profile: DemandProfile,
  category: CategoryCode,
  daypart: Daypart,
): number {
  const cells = profile.perCell.get(category) ?? [];
  let total = 0;
  for (const [cell, count] of cells.entries()) {
    if (coversCell(daypart, cell)) {
      total += count;
    }
  }
  return total;
}

export interface Turnover {
  readonly category: CategoryCode;
  readonly size: number;
  readonly slotsPerWeek: number;
  /** Hours for the category to come once round. */
  readonly hours: number;
  /** The same figure in days, which is how a director actually says it. */
  readonly days: number;
}

/**
 * The nominal turnover: the whole category against the whole week's demand.
 * True only where nothing is restricted and every cart is live, which is to say
 * almost nowhere, but it is the number every other one is compared against.
 */
export function nominalTurnover(
  profile: DemandProfile,
  category: CategoryCode,
  size: number,
): Turnover {
  const slots = slotsPerWeek(profile, category);
  const hours = slots === 0 ? Number.POSITIVE_INFINITY : (size * HOURS_IN_WEEK) / slots;
  return {
    category,
    size,
    slotsPerWeek: slots,
    hours,
    days: hours / HOURS_IN_DAY,
  };
}

/** How often one cart plays, which is the figure a listener would notice. */
export function playsPerWeek(profile: DemandProfile, category: CategoryCode, size: number): number {
  if (size === 0) {
    return 0;
  }
  return slotsPerWeek(profile, category) / size;
}

export function describeTurnover(turnover: Turnover): string {
  if (!Number.isFinite(turnover.hours)) {
    return `${turnover.category} never turns over`;
  }
  return `${turnover.category} turns over in ${turnover.days.toFixed(1)} days`;
}

/** Which cells the category is actually asked for in, for a coverage report. */
export function activeCells(profile: DemandProfile, category: CategoryCode): WeekCell[] {
  const cells = profile.perCell.get(category) ?? [];
  const out: WeekCell[] = [];
  for (const [cell, count] of cells.entries()) {
    if (count > 0) {
      out.push(cell);
    }
  }
  return out;
}

export function describeCellDemand(cell: WeekCell, count: number): string {
  return `day ${dayOfCell(cell)} hour ${hourOfCell(cell)}: ${count}`;
}
