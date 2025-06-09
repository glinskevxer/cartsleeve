/**
 * The one walk both balance measures need.
 *
 * Horizontal balance buckets a cart's plays by daypart. Vertical balance buckets
 * them by hour of day. Everything after the bucketing was the same code written
 * twice: total the plays, measure the spread over the buckets that count, find
 * the heaviest bucket, and filter to the carts over a threshold with enough
 * plays to be worth judging.
 *
 * Writing it twice had already cost something. The two copies disagreed about
 * which buckets the spread is measured over, so a cart restricted to four hours
 * scored badly on one measure and fairly on the other for no reason anybody
 * intended. Measuring over the reachable buckets is right, and now it is right
 * in one place.
 */

import { spread } from '../util/ordering.js';
import type { WeekCell } from '../domain/daypart.js';
import type { CartNumber } from '../util/ids.js';
import type { Play } from './rest.js';

export interface Balance {
  readonly cart: CartNumber;
  /** Plays per bucket, indexed by bucket number. */
  readonly counts: readonly number[];
  readonly plays: number;
  /** 0 for evenly spread over the reachable buckets, 1 for all in one. */
  readonly imbalance: number;
  readonly heaviest: number;
  readonly heaviestCount: number;
  /** Buckets the cart could reach but has never been heard in. */
  readonly unheard: readonly number[];
}

/** Which bucket a play falls in. A negative result means no bucket claims it. */
export type BucketOf = (cell: WeekCell) => number;

export interface BalanceOptions {
  readonly buckets: number;
  readonly bucketOf: BucketOf;
  /**
   * The buckets the spread is measured over. Defaults to the buckets the cart
   * has actually reached, so a cart that can only play in four hours is not
   * scored against all twenty four.
   */
  readonly reachable?: readonly number[];
}

export function measureBalance(
  plays: readonly Play[],
  cart: CartNumber,
  options: BalanceOptions,
): Balance {
  const counts = Array.from({ length: options.buckets }, () => 0);
  for (const play of plays) {
    if (play.cart !== cart) {
      continue;
    }
    const bucket = options.bucketOf(play.cell);
    if (bucket >= 0 && bucket < options.buckets) {
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
  }
  const reachable =
    options.reachable ??
    counts.map((_, index) => index).filter((index) => (counts[index] ?? 0) > 0);
  let heaviest = 0;
  let heaviestCount = 0;
  for (const [bucket, count] of counts.entries()) {
    if (count > heaviestCount) {
      heaviestCount = count;
      heaviest = bucket;
    }
  }
  const scope = options.reachable ?? Array.from({ length: options.buckets }, (_, index) => index);
  return {
    cart,
    counts,
    plays: counts.reduce((sum, count) => sum + count, 0),
    imbalance: spread(reachable.map((bucket) => counts[bucket] ?? 0)),
    heaviest,
    heaviestCount,
    unheard: scope.filter((bucket) => (counts[bucket] ?? 0) === 0),
  };
}

/** How much of a cart's airplay sits in its heaviest bucket. */
export function concentration(balance: Balance): number {
  return balance.plays === 0 ? 0 : balance.heaviestCount / balance.plays;
}

/**
 * Carts over a threshold, ignoring those with too few plays to judge. A cart
 * with two plays is maximally concentrated by arithmetic rather than by fault,
 * and filling the report with those hides the carts that are really stuck.
 */
export function overThreshold(
  balances: readonly Balance[],
  score: (balance: Balance) => number,
  threshold: number,
  minimumPlays: number,
): Balance[] {
  return balances.filter((balance) => balance.plays >= minimumPlays && score(balance) >= threshold);
}

/** The average imbalance across the carts that have actually played. */
export function meanImbalance(balances: readonly Balance[]): number {
  const measured = balances.filter((balance) => balance.plays > 0);
  if (measured.length === 0) {
    return 0;
  }
  return measured.reduce((sum, balance) => sum + balance.imbalance, 0) / measured.length;
}
