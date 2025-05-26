/**
 * Turnover once the restrictions are taken off.
 *
 * The nominal figure divides the whole category by the whole week's demand. A
 * restricted cart is not in the category for the hours it is held out of, so
 * that division is over two numbers that do not describe the same thing.
 *
 * The honest computation walks the week cell by cell. In each cell the category
 * has whatever size the restrictions leave, and asks for whatever the clock in
 * that cell wants. A cart's real turnover is then the demand it is actually
 * exposed to, divided over the pool it is actually competing with, and those
 * differ per cart because two carts can be restricted differently.
 *
 * This is the composition the whole system is built around, stated as
 * arithmetic: daypart restriction decides what turnover measures.
 *
 * What it does not do is change the total. Every slot in the week goes to
 * somebody, so as long as each cell still has one eligible cart the category's
 * aggregate turnover is exactly the nominal figure however much is restricted.
 * What moves is the distribution: a cart held out of morning drive competes
 * with a smaller pool for the rest of the week and plays more often there, the
 * carts it left behind in the morning play more often too, and the two effects
 * cancel in the total while pulling the individual carts apart.
 *
 * So a category turnover report that quotes one number is not wrong so much as
 * incapable of showing the problem, and `exposureSpread` is the figure that can.
 */

import type { CartNumber, CategoryCode } from '../util/ids.js';
import { HOURS_IN_WEEK } from '../domain/daypart.js';
import { allowedInCell } from '../library/restriction.js';
import type { RestrictionMap } from '../library/restriction.js';
import { HOURS_IN_DAY, slotsInCell } from './turnover.js';
import type { DemandProfile, Turnover } from './turnover.js';

export interface EffectiveInput {
  readonly profile: DemandProfile;
  readonly restrictions: RestrictionMap;
  readonly category: CategoryCode;
  readonly carts: readonly CartNumber[];
}

export interface CartExposure {
  readonly cart: CartNumber;
  /** Slots per week this cart could possibly be chosen for. */
  readonly reachableSlots: number;
  /** Expected plays per week, given who else is competing in each cell. */
  readonly expectedPlays: number;
  /** Hours between plays at that rate. */
  readonly hours: number;
}

/**
 * Pool size per cell: how many of the category may play in each hour of the
 * week. Computed once and shared, because the per cart figures all divide by it.
 */
export function poolPerCell(input: EffectiveInput): number[] {
  const pool = Array.from({ length: HOURS_IN_WEEK }, () => 0);
  for (const cart of input.carts) {
    for (let cell = 0; cell < HOURS_IN_WEEK; cell += 1) {
      if (allowedInCell(input.restrictions, cart, cell)) {
        pool[cell] = (pool[cell] ?? 0) + 1;
      }
    }
  }
  return pool;
}

/**
 * What one cart can expect. In each cell it may play in, it competes with
 * everything else allowed there for whatever that cell asks, so its share is
 * the demand divided by the pool. Summed over the week that is its play rate,
 * and a cart with a narrow reach can still have a high rate if the cells it can
 * reach are thinly contested.
 */
export function exposureOf(
  input: EffectiveInput,
  pool: readonly number[],
  cart: CartNumber,
): CartExposure {
  let reachable = 0;
  let expected = 0;
  for (let cell = 0; cell < HOURS_IN_WEEK; cell += 1) {
    if (!allowedInCell(input.restrictions, cart, cell)) {
      continue;
    }
    const demand = slotsInCell(input.profile, input.category, cell);
    reachable += demand;
    const competing = pool[cell] ?? 0;
    if (competing > 0) {
      expected += demand / competing;
    }
  }
  return {
    cart,
    reachableSlots: reachable,
    expectedPlays: expected,
    hours: expected === 0 ? Number.POSITIVE_INFINITY : HOURS_IN_WEEK / expected,
  };
}

export function exposures(input: EffectiveInput): CartExposure[] {
  const pool = poolPerCell(input);
  return input.carts.map((cart) => exposureOf(input, pool, cart));
}

/**
 * The category's effective turnover: the average time for every cart to come
 * round once, which is the mean of the per cart intervals rather than the
 * nominal division. Where nothing is restricted the two agree exactly, and
 * where anything is they do not.
 */
export function effectiveTurnover(input: EffectiveInput): Turnover {
  const measured = exposures(input);
  const size = input.carts.length;
  let totalPlays = 0;
  let slots = 0;
  for (const exposure of measured) {
    totalPlays += exposure.expectedPlays;
    slots = Math.max(slots, exposure.reachableSlots);
  }
  const hours = totalPlays === 0 ? Number.POSITIVE_INFINITY : (size * HOURS_IN_WEEK) / totalPlays;
  return {
    category: input.category,
    size,
    slotsPerWeek: Math.round(totalPlays),
    hours,
    days: hours / HOURS_IN_DAY,
  };
}

/** The spread between the fastest and slowest cart, which nominal cannot show. */
export function exposureSpread(input: EffectiveInput): { fastest: number; slowest: number } {
  const measured = exposures(input).filter((exposure) => Number.isFinite(exposure.hours));
  if (measured.length === 0) {
    return { fastest: Number.POSITIVE_INFINITY, slowest: Number.POSITIVE_INFINITY };
  }
  let fastest = Number.POSITIVE_INFINITY;
  let slowest = 0;
  for (const exposure of measured) {
    fastest = Math.min(fastest, exposure.hours);
    slowest = Math.max(slowest, exposure.hours);
  }
  return { fastest, slowest };
}

/** Carts that can never play, because everything they reach asks for nothing. */
export function unreachable(input: EffectiveInput): CartNumber[] {
  return exposures(input)
    .filter((exposure) => exposure.expectedPlays === 0)
    .map((exposure) => exposure.cart);
}
