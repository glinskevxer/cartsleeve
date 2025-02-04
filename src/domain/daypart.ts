/**
 * Dayparts.
 *
 * A daypart is a named set of hour cells in the week. Sales sells against them,
 * the programme director restricts carts to them, and the rotation reports
 * balance across them. They are sets rather than ranges because a real one is
 * not always contiguous: a weekend overnight daypart is Saturday and Sunday
 * midnight to six, which no single day and hour range describes.
 *
 * Hours are numbered from the start of the broadcast day, not from midnight, so
 * a daypart on a station whose day starts at 05:00 means the same wall clock
 * hours as the same daypart on a station whose day starts at midnight.
 */

import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { Result } from '../util/result.js';
import { Check } from '../util/check.js';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type DayName = (typeof DAY_NAMES)[number];

export const HOURS_IN_WEEK = 168;

/** A cell is one day and one hour, numbered 0 to 167 from Sunday hour zero. */
export type WeekCell = number;

export function cellOf(day: number, hour: number): WeekCell {
  return day * 24 + hour;
}

export function dayOfCell(cell: WeekCell): number {
  return Math.floor(cell / 24);
}

export function hourOfCell(cell: WeekCell): number {
  return cell % 24;
}

export function formatCell(cell: WeekCell): string {
  return `${DAY_NAMES[dayOfCell(cell)] ?? '???'} ${String(hourOfCell(cell)).padStart(2, '0')}`;
}

export interface Daypart {
  readonly name: string;
  readonly cells: ReadonlySet<WeekCell>;
}

export interface DaypartSpan {
  /** Days by index, 0 for Sunday. */
  readonly days: readonly number[];
  /** First hour of the band, from the start of the broadcast day. */
  readonly fromHour: number;
  /** One past the last hour. A band that wraps past 24 is rejected. */
  readonly toHour: number;
}

const DAYPART = (n: number): string => codeFor('clock', n);

/**
 * Build a daypart from one or more spans. Overlapping spans inside the same
 * daypart are fine and collapse, because a Saturday span and a weekend overnight
 * span really do share cells.
 */
export function makeDaypart(
  name: string,
  spans: readonly DaypartSpan[],
): Result<Daypart, Problem[]> {
  const check = new Check();
  const trimmed = name.trim();
  check.ensure(trimmed.length > 0, DAYPART(1), name, 'has no name');
  check.ensure(spans.length > 0, DAYPART(2), trimmed, 'covers no hours');
  const cells = new Set<WeekCell>();
  for (const span of spans) {
    const bandOk = check.ensure(
      span.fromHour >= 0 && span.toHour <= 24 && span.fromHour < span.toHour,
      DAYPART(3),
      trimmed,
      'has an hour band that is empty or runs past the day',
      { from: span.fromHour, to: span.toHour },
    );
    if (!bandOk) {
      continue;
    }
    if (!check.ensure(span.days.length > 0, DAYPART(4), trimmed, 'has an hour band on no days')) {
      continue;
    }
    for (const day of span.days) {
      const dayOk = check.ensure(
        Number.isInteger(day) && day >= 0 && day <= 6,
        DAYPART(5),
        trimmed,
        'names a day outside the week',
        { day },
      );
      if (!dayOk) {
        continue;
      }
      for (let hour = span.fromHour; hour < span.toHour; hour += 1) {
        cells.add(cellOf(day, hour));
      }
    }
  }
  return check.result(() => ({ name: trimmed, cells }));
}

export function coversCell(daypart: Daypart, cell: WeekCell): boolean {
  return daypart.cells.has(cell);
}

export function covers(daypart: Daypart, day: number, hour: number): boolean {
  return daypart.cells.has(cellOf(day, hour));
}

export function cellCount(daypart: Daypart): number {
  return daypart.cells.size;
}

export function overlap(a: Daypart, b: Daypart): WeekCell[] {
  const shared: WeekCell[] = [];
  for (const cell of a.cells) {
    if (b.cells.has(cell)) {
      shared.push(cell);
    }
  }
  return shared.sort((x, y) => x - y);
}

/** Cells of the week that no daypart in the set claims. */
export function uncovered(dayparts: readonly Daypart[]): WeekCell[] {
  const claimed = new Set<WeekCell>();
  for (const daypart of dayparts) {
    for (const cell of daypart.cells) {
      claimed.add(cell);
    }
  }
  const gaps: WeekCell[] = [];
  for (let cell = 0; cell < HOURS_IN_WEEK; cell += 1) {
    if (!claimed.has(cell)) {
      gaps.push(cell);
    }
  }
  return gaps;
}

export const WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const WEEKEND = [0, 6] as const;
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;
