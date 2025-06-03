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
 * again exactly one cycle later. When the cycle is a multiple of twenty four
 * hours it lands there every day, forever, and nothing in the rest ordering can
 * see it happening.
 *
 * So this measures two things: which hours of the day a cart lands in, and how
 * strongly its play times cluster on a single hour.
 */

import { spread } from '../util/ordering.js';
import { hourOfCell } from '../domain/daypart.js';
import type { CartNumber } from '../util/ids.js';
import type { Play } from './rest.js';

export const HOURS = 24;

export interface HourSpread {
  readonly cart: CartNumber;
  /** Plays in each hour of the day, index 0 to 23. */
  readonly byHour: readonly number[];
  readonly plays: number;
  /** 0 for evenly spread across the hours it uses, 1 for all in one hour. */
  readonly imbalance: number;
  /** The hour it lands in most, and how many of its plays were there. */
  readonly heaviestHour: number;
  readonly heaviestCount: number;
}

export function hourCounts(plays: readonly Play[], cart: CartNumber): number[] {
  const counts = Array.from({ length: HOURS }, () => 0);
  for (const play of plays) {
    if (play.cart !== cart) {
      continue;
    }
    const hour = hourOfCell(play.cell);
    counts[hour] = (counts[hour] ?? 0) + 1;
  }
  return counts;
}

/**
 * The spread is measured over the hours the cart actually reached, not over all
 * twenty four. A cart restricted to morning drive can only ever play in four
 * hours, and scoring it against twenty four would call every such cart badly
 * balanced when it is as balanced as it is allowed to be.
 */
export function hourSpread(
  plays: readonly Play[],
  cart: CartNumber,
  reachableHours?: readonly number[],
): HourSpread {
  const byHour = hourCounts(plays, cart);
  const reachable =
    reachableHours ?? byHour.map((_, hour) => hour).filter((hour) => (byHour[hour] ?? 0) > 0);
  const measured = reachable.map((hour) => byHour[hour] ?? 0);
  let heaviestHour = 0;
  let heaviestCount = 0;
  for (const [hour, count] of byHour.entries()) {
    if (count > heaviestCount) {
      heaviestCount = count;
      heaviestHour = hour;
    }
  }
  return {
    cart,
    byHour,
    plays: byHour.reduce((sum, count) => sum + count, 0),
    imbalance: spread(measured),
    heaviestHour,
    heaviestCount,
  };
}

/**
 * How much of a cart's airplay sits in its heaviest hour. This is the number a
 * listener notices, and unlike the spread it is meaningful for a cart with only
 * two or three plays.
 */
export function concentration(measured: HourSpread): number {
  return measured.plays === 0 ? 0 : measured.heaviestCount / measured.plays;
}

/** Carts landing in the same hour more often than a threshold allows. */
export function clumped(
  spreads: readonly HourSpread[],
  threshold: number,
  minimumPlays = 3,
): HourSpread[] {
  return spreads.filter((each) => each.plays >= minimumPlays && concentration(each) >= threshold);
}

export function spreadsFor(plays: readonly Play[], carts: readonly CartNumber[]): HourSpread[] {
  return carts.map((cart) => hourSpread(plays, cart));
}

/**
 * Whether a rotation cycle will lock carts to a fixed hour. A cycle that is a
 * whole number of hours and divides evenly into a day repeats at the same time
 * every day, which is the failure this module exists to detect. Reported as the
 * number of days before a cart returns to the same hour, so 1 is the bad case
 * and a fractional cycle never returns at all.
 */
export function repeatDays(cycleHours: number): number {
  if (!Number.isFinite(cycleHours) || cycleHours <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isInteger(cycleHours)) {
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

/** Whether the cycle locks a cart to one hour of the day. */
export function locksToHour(cycleHours: number): boolean {
  return repeatDays(cycleHours) === 1;
}
