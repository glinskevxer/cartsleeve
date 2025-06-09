/**
 * Vertical balance.
 *
 * Horizontal balance asks whether a cart reaches different audiences across the
 * week. Vertical balance asks whether it lands in the same place inside the day,
 * and it is the one listeners complain about by name: the same record at
 * quarter past eight every single morning.
 *
 * It happens for an arithmetic reason. If a category is asked for the same
 * number of times every hour and rotates on rest alone, the cycle length is a
 * whole number of hours, and a cart that lands at 08:15 today lands at 08:15
 * again exactly one cycle later. When the cycle divides a day it lands there
 * every day, forever, and nothing in the rest ordering can see it happening.
 */

import { hourOfCell } from '../domain/daypart.js';
import type { CartNumber } from '../util/ids.js';
import { concentration, measureBalance, overThreshold } from './balance.js';
import type { Balance } from './balance.js';
import type { Play } from './rest.js';

export const HOURS = 24;

export function hourCounts(plays: readonly Play[], cart: CartNumber): number[] {
  return [...measureBalance(plays, cart, { buckets: HOURS, bucketOf: hourOfCell }).counts];
}

/**
 * The spread is measured over the hours the cart actually reached unless the
 * caller says otherwise. A cart restricted to morning drive can only ever play
 * in four hours, and scoring it against twenty four would call every such cart
 * badly balanced when it is as balanced as it is allowed to be.
 */
export function hourSpread(
  plays: readonly Play[],
  cart: CartNumber,
  reachableHours?: readonly number[],
): Balance {
  return measureBalance(plays, cart, {
    buckets: HOURS,
    bucketOf: hourOfCell,
    ...(reachableHours === undefined ? {} : { reachable: reachableHours }),
  });
}

export function spreadsFor(plays: readonly Play[], carts: readonly CartNumber[]): Balance[] {
  return carts.map((cart) => hourSpread(plays, cart));
}

/** Carts landing in the same hour more often than a threshold allows. */
export function clumped(
  spreads: readonly Balance[],
  threshold: number,
  minimumPlays = 3,
): Balance[] {
  return overThreshold(spreads, concentration, threshold, minimumPlays);
}

/**
 * Whether a rotation cycle will lock carts to a fixed hour. Reported as the
 * number of days before a cart returns to the same hour, so 1 is the bad case
 * and a fractional cycle never returns at all.
 */
export function repeatDays(cycleHours: number): number {
  if (!Number.isFinite(cycleHours) || cycleHours <= 0 || !Number.isInteger(cycleHours)) {
    return Number.POSITIVE_INFINITY;
  }
  let days = 1;
  while (days <= HOURS) {
    if ((cycleHours * days) % HOURS === 0) {
      return (cycleHours * days) / HOURS;
    }
    days += 1;
  }
  return Number.POSITIVE_INFINITY;
}

export function locksToHour(cycleHours: number): boolean {
  return repeatDays(cycleHours) === 1;
}

export { concentration };
