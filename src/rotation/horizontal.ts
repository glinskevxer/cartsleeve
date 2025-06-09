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
 * heard in this daypart lately.
 */

import type { Daypart, WeekCell } from '../domain/daypart.js';
import { coversCell } from '../domain/daypart.js';
import type { CartNumber } from '../util/ids.js';
import { concentration, measureBalance, meanImbalance, overThreshold } from './balance.js';
import type { Balance } from './balance.js';
import type { Play } from './rest.js';

export interface DaypartBalance extends Balance {
  /** Names of the dayparts the cart has never been heard in. */
  readonly unheardNames: readonly string[];
}

function bucketFor(dayparts: readonly Daypart[]): (cell: WeekCell) => number {
  return (cell) => dayparts.findIndex((daypart) => coversCell(daypart, cell));
}

export function daypartCounts(
  plays: readonly Play[],
  dayparts: readonly Daypart[],
  cart: CartNumber,
): number[] {
  return [
    ...measureBalance(plays, cart, { buckets: dayparts.length, bucketOf: bucketFor(dayparts) })
      .counts,
  ];
}

export function daypartSpread(
  plays: readonly Play[],
  dayparts: readonly Daypart[],
  cart: CartNumber,
): DaypartBalance {
  const balance = measureBalance(plays, cart, {
    buckets: dayparts.length,
    bucketOf: bucketFor(dayparts),
    reachable: dayparts.map((_, index) => index),
  });
  return {
    ...balance,
    unheardNames: balance.unheard.map((index) => dayparts[index]?.name ?? ''),
  };
}

export function spreadsFor(
  plays: readonly Play[],
  dayparts: readonly Daypart[],
  carts: readonly CartNumber[],
): DaypartBalance[] {
  return carts.map((cart) => daypartSpread(plays, dayparts, cart));
}

/** Carts stuck in one part of the week. */
export function stuck(
  spreads: readonly DaypartBalance[],
  threshold: number,
  minimumPlays = 3,
): DaypartBalance[] {
  return overThreshold(spreads, (balance) => balance.imbalance, threshold, minimumPlays).filter(
    (balance): balance is DaypartBalance => 'unheardNames' in balance,
  );
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

export function categoryImbalance(spreads: readonly DaypartBalance[]): number {
  return meanImbalance(spreads);
}

export { concentration };
