/**
 * Scheduling a week.
 *
 * Seven days, or however many a station schedules at once, filled in order with
 * everything carried forward. Directors schedule a week at a time because the
 * traffic log arrives weekly, and because a category cannot be judged on one
 * day: a gold category turning over in twelve days looks identical on Monday
 * whether it is healthy or badly restricted.
 *
 * The carry is the same as between hours and it matters more. A cart played on
 * Monday at 07:00 must not come back on Tuesday at 07:00, and nothing inside a
 * day pass can see that. The separation minimums are shorter than a day, so the
 * rules alone would allow it; what stops it is the rotation position, which
 * keeps advancing across the boundary and does not bring the cart back round for
 * a full cycle.
 *
 * A week is also where the history stops being free. Every rule query walks the
 * placements inside its window, and by Sunday there are several thousand. The
 * pass prunes what is older than the longest window any rule can ask for, which
 * is the title minimum, because nothing can see past it.
 */

import { civilFromDays, daysFromCivil } from '../util/time.js';
import type { BroadcastDay } from '../util/time.js';
import type { Placed } from '../rules/rule.js';
import { POSITIONS_PER_DAY, fillDay } from './day.js';
import type { DayInput, DayOutcome } from './day.js';
import type { Breach } from './breach.js';
import type { HoleRecord } from './hole.js';

export interface WeekInput {
  readonly from: BroadcastDay;
  readonly days: number;
  /**
   * Build the day input. Given everything placed on earlier days, so the caller
   * can put it behind the schedule reader and carry the rotation forward.
   */
  readonly dayInputFor: (
    day: BroadcastDay,
    weekday: number,
    placedSoFar: readonly Placed[],
  ) => DayInput;
  /**
   * How many placements to carry into the next day. Past this the rules cannot
   * reach anyway, and an unpruned week grows every rule query without bound.
   */
  readonly keep?: number;
}

export interface WeekOutcome {
  readonly days: readonly DayOutcome[];
  readonly breaches: readonly Breach[];
  readonly holes: readonly HoleRecord[];
  readonly placed: readonly Placed[];
}

export function weekdayOfDay(day: BroadcastDay): number {
  const days = daysFromCivil(day.year, day.month, day.day);
  return (((days + 4) % 7) + 7) % 7;
}

export function nextDay(day: BroadcastDay): BroadcastDay {
  return civilFromDays(daysFromCivil(day.year, day.month, day.day) + 1);
}

/**
 * Drop placements the rules can no longer reach.
 *
 * Times inside a day pass restart at zero, so the pruning is by day rather than
 * by the raw offset: keeping the last day of placements is past every rule's
 * window and is the only thing a day pass can compare against anyway.
 */
export function pruneHistory(placed: readonly Placed[], keep: number): Placed[] {
  if (placed.length <= keep) {
    return [...placed];
  }
  return placed.slice(placed.length - keep);
}

export const DEFAULT_KEEP = 400;

export function fillWeek(input: WeekInput): WeekOutcome {
  const days: DayOutcome[] = [];
  const breaches: Breach[] = [];
  const holes: HoleRecord[] = [];
  let carried: Placed[] = [];
  let day = input.from;

  for (let index = 0; index < input.days; index += 1) {
    const forDay = input.dayInputFor(day, weekdayOfDay(day), carried);
    const outcome = fillDay({
      ...forDay,
      positionOffset: (forDay.positionOffset ?? 0) + index * POSITIONS_PER_DAY,
    });
    days.push(outcome);
    breaches.push(...outcome.breaches);
    holes.push(...outcome.holes);
    carried = pruneHistory([...carried, ...outcome.placed], input.keep ?? DEFAULT_KEEP);
    day = nextDay(day);
  }

  return {
    days,
    breaches,
    holes,
    placed: days.flatMap((each) => each.placed),
  };
}

/** How many slots the week filled, over how many it tried to. */
export function weekCompleteness(outcome: WeekOutcome): number {
  const filled = outcome.placed.length;
  const attempted = filled + outcome.holes.length;
  return attempted === 0 ? 1 : filled / attempted;
}

export function isCleanWeek(outcome: WeekOutcome): boolean {
  return outcome.breaches.length === 0 && outcome.holes.length === 0;
}

/** Plays per cart across the week, which is what a rotation report reads. */
export function weekPlayCounts(outcome: WeekOutcome): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of outcome.placed) {
    counts.set(item.cart, (counts.get(item.cart) ?? 0) + 1);
  }
  return counts;
}

/** Carts that played far more or far less than the average, worst first. */
export function outliers(
  outcome: WeekOutcome,
  tolerance = 0.5,
): { cart: string; plays: number; expected: number }[] {
  const counts = weekPlayCounts(outcome);
  if (counts.size === 0) {
    return [];
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const expected = total / counts.size;
  const out: { cart: string; plays: number; expected: number }[] = [];
  for (const [cart, plays] of counts) {
    if (Math.abs(plays - expected) / expected > tolerance) {
      out.push({ cart, plays, expected });
    }
  }
  return out.sort((a, b) => {
    const byDistance = Math.abs(b.plays - expected) - Math.abs(a.plays - expected);
    if (byDistance !== 0) {
      return byDistance;
    }
    return a.cart < b.cart ? -1 : a.cart > b.cart ? 1 : 0;
  });
}
