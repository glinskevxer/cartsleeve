/**
 * Horizontal balance.
 *
 * A cart that plays four times a week and always in the same daypart has been
 * heard by one audience four times and by three audiences never. Rotation on
 * rest alone produces exactly this, because a category asked for at a fixed
 * hour every day cycles in step with the day and every cart lands in the same
 * slot each time it comes round.
 *
 * The fix is not to force a spread, which fights the rest ordering and produces
 * a worse log. It is to measure the spread, report the carts that are stuck, and
 * let the tie break in the candidate search prefer a cart that has not been
 * heard in this daypart lately. Measuring is this module's job.
 */

import { spread } from '../util/ordering.js';
import type { Daypart, WeekCell } from '../domain/daypart.js';
import { coversCell } from '../domain/daypart.js';
import type { CartNumber } from '../util/ids.js';
import type { Play } from './rest.js';

export interface DaypartSpread {
  readonly cart: CartNumber;
  /** Plays per daypart, in the order the dayparts were given. */
  readonly counts: readonly number[];
  readonly plays: number;
  /** 0 for perfectly even, 1 for every play in one daypart. */
  readonly imbalance: number;
  /** Dayparts the cart has never been heard in. */
  readonly unheard: readonly string[];
}

function daypartOf(dayparts: readonly Daypart[], cell: WeekCell): number {
  return dayparts.findIndex((daypart) => coversCell(daypart, cell));
}

/**
 * Count a cart's plays into the dayparts they landed in. A play in a cell no
 * daypart claims is not counted anywhere, which is deliberate: an unclaimed
 * hour is not an audience anyone is buying or measuring.
 */
export function daypartCounts(
  plays: readonly Play[],
  dayparts: readonly Daypart[],
  cart: CartNumber,
): number[] {
  const counts = Array.from({ length: dayparts.length }, () => 0);
  for (const play of plays) {
    if (play.cart !== cart) {
      continue;
    }
    const index = daypartOf(dayparts, play.cell);
    if (index >= 0) {
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  return counts;
}

export function daypartSpread(
  plays: readonly Play[],
  dayparts: readonly Daypart[],
  cart: CartNumber,
): DaypartSpread {
  const counts = daypartCounts(plays, dayparts, cart);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const unheard: string[] = [];
  for (const [index, daypart] of dayparts.entries()) {
    if ((counts[index] ?? 0) === 0) {
      unheard.push(daypart.name);
    }
  }
  return {
    cart,
    counts,
    plays: total,
    imbalance: spread(counts),
    unheard,
  };
}

export function spreadsFor(
  plays: readonly Play[],
  dayparts: readonly Daypart[],
  carts: readonly CartNumber[],
): DaypartSpread[] {
  return carts.map((cart) => daypartSpread(plays, dayparts, cart));
}

/**
 * Carts stuck in one part of the week. A cart with too few plays to have
 * spread anywhere is not stuck, it is just new, so a floor keeps those out of
 * the report rather than filling it with noise.
 */
export function stuck(
  spreads: readonly DaypartSpread[],
  threshold: number,
  minimumPlays = 3,
): DaypartSpread[] {
  return spreads.filter((each) => each.plays >= minimumPlays && each.imbalance >= threshold);
}

/**
 * How stale a cart is in one daypart: plays elsewhere since it last played
 * here. The candidate search uses this as a tie break, so between two equally
 * rested carts the one this audience has not heard goes first.
 */
export function staleness(
  plays: readonly Play[],
  dayparts: readonly Daypart[],
  cart: CartNumber,
  daypart: number,
): number {
  const target = dayparts[daypart];
  if (target === undefined) {
    return 0;
  }
  let since = 0;
  for (let index = plays.length - 1; index >= 0; index -= 1) {
    const play = plays[index];
    if (play === undefined || play.cart !== cart) {
      continue;
    }
    if (coversCell(target, play.cell)) {
      return since;
    }
    since += 1;
  }
  return Number.POSITIVE_INFINITY;
}

/** The whole category's imbalance, as one number for an hour summary. */
export function categoryImbalance(spreads: readonly DaypartSpread[]): number {
  const measured = spreads.filter((each) => each.plays > 0);
  if (measured.length === 0) {
    return 0;
  }
  return measured.reduce((sum, each) => sum + each.imbalance, 0) / measured.length;
}
