/**
 * Filling a broadcast day.
 *
 * Twenty four hours, or twenty three or twenty five on the two days a year the
 * clocks move. Each hour takes its clock from the grid, and each is filled
 * against everything already scheduled that day.
 *
 * The carry between hours is what makes this more than a loop. Rest keeps
 * accumulating, so a cart played at 07:15 is not available again until its
 * separation minimum has passed, which may be four hours later in a different
 * clock in a different daypart. The rotation position advances too, so the
 * packets keep moving rather than restarting each hour. A day pass that reset
 * either between hours would play the same opening record every hour.
 *
 * The rules see across the boundary as well. Artist separation at 07:55 looks
 * back into the 07:00 hour and forward into nothing, because the day is built in
 * order and the 08:00 hour does not exist yet. That asymmetry is real and
 * deliberate: a scheduler that could see forward would need to backtrack, and a
 * log a director cannot predict is worse than one that is occasionally tight at
 * an hour boundary.
 */

import { tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { HOUR_TENTHS } from '../domain/clock.js';
import type { Clock } from '../domain/clock.js';
import { cellOf } from '../domain/daypart.js';
import type { BroadcastDay } from '../util/time.js';
import type { Placed } from '../rules/rule.js';
import type { LibraryEntry } from '../library/library.js';
import { POSITIONS_PER_HOUR, fillHour } from './hour.js';
import type { HourInput, HourOutcome } from './hour.js';
import type { Breach } from './breach.js';
import type { HoleRecord } from './hole.js';
import { collectFrom } from './collect.js';

export interface DayInput {
  readonly day: BroadcastDay;
  /** Which day of the week the broadcast day is filed under, 0 for Sunday. */
  readonly weekday: number;
  readonly dayStartHour: number;
  /** How many hours this day holds. Twenty three or twenty five at a transition. */
  readonly hours: number;
  readonly clockFor: (hourIndex: number) => Clock | undefined;
  /**
   * Build the hour input. Given everything placed so far, so the caller can put
   * it behind the schedule reader and advance the rotation state.
   */
  readonly hourInputFor: (
    hourIndex: number,
    clock: Clock,
    startsAt: Tenths,
    cell: number,
    placedSoFar: readonly Placed[],
  ) => HourInput;
}

export interface FilledHour {
  readonly hourIndex: number;
  readonly clock: string;
  readonly cell: number;
  readonly outcome: HourOutcome;
}

export interface DayOutcome {
  readonly day: BroadcastDay;
  readonly hours: readonly FilledHour[];
  readonly placed: readonly Placed[];
  readonly breaches: readonly Breach[];
  readonly holes: readonly HoleRecord[];
  readonly endsAt: Tenths;
  /** Hours the grid had no clock for, which are skipped rather than guessed. */
  readonly missingClocks: readonly number[];
}

/**
 * Which cell of the week an hour of the broadcast day falls in.
 *
 * An overnight hour is filed under the day it started with, so hour 21 of a day
 * that starts at 05:00 is 02:00 the following morning and belongs to this
 * broadcast day's weekday even though the calendar has moved on.
 */
export function cellForHour(weekday: number, dayStartHour: number, hourIndex: number): number {
  return cellOf(weekday, (dayStartHour + hourIndex) % 24);
}

export function fillDay(input: DayInput): DayOutcome {
  const hours: FilledHour[] = [];
  const placed: Placed[] = [];
  const breaches: Breach[] = [];
  const holes: HoleRecord[] = [];
  const missingClocks: number[] = [];
  let cursor = tenths(0);

  for (let hourIndex = 0; hourIndex < input.hours; hourIndex += 1) {
    const clock = input.clockFor(hourIndex);
    if (clock === undefined) {
      missingClocks.push(hourIndex);
      cursor = tenths(cursor + HOUR_TENTHS);
      continue;
    }
    const cell = cellForHour(input.weekday, input.dayStartHour, hourIndex);
    const outcome = fillHour({
      ...input.hourInputFor(hourIndex, clock, cursor, cell, placed),
      carried: [...placed],
      positionOffset: hourIndex * POSITIONS_PER_HOUR,
    });
    hours.push({ hourIndex, clock: clock.name, cell, outcome });
    placed.push(...outcome.placed);

    const collected = collectFrom(outcome.slots);
    breaches.push(...collected.breaches);
    holes.push(...collected.holes);
    cursor = outcome.endsAt;
  }

  return { day: input.day, hours, placed, breaches, holes, endsAt: cursor, missingClocks };
}

export function isCleanDay(outcome: DayOutcome): boolean {
  return outcome.breaches.length === 0 && outcome.holes.length === 0;
}

/** Slots the day filled, over slots it tried to, as a completion figure. */
export function completeness(outcome: DayOutcome): number {
  const filled = outcome.placed.length;
  const attempted = filled + outcome.holes.length;
  return attempted === 0 ? 1 : filled / attempted;
}

/** Carts that were never placed anywhere in the day. */
export function unplayed(outcome: DayOutcome, library: readonly LibraryEntry[]): string[] {
  const played = new Set(outcome.placed.map((item) => item.cart));
  return library
    .filter((entry) => entry.cart.music && !played.has(entry.cart.number))
    .map((entry) => entry.cart.number)
    .sort();
}

/** How many times each cart played across the day. */
export function playCounts(outcome: DayOutcome): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of outcome.placed) {
    counts.set(item.cart, (counts.get(item.cart) ?? 0) + 1);
  }
  return counts;
}
