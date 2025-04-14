/**
 * Rest in plays.
 *
 * The other half of rest. Where `restHours` asks how long ago the listener heard
 * it, this asks how far the category has moved on since. They disagree, and the
 * disagreement is not a bug in either of them.
 *
 * A power current asked for twice an hour cycles a forty cart category in about
 * twenty hours. A gold category asked for once an hour cycles four hundred carts
 * in over a fortnight. Ordering both on hours means the gold category is always
 * the better rested and always wins a tie; ordering both on plays means a
 * current that has not aired since Tuesday still sorts behind one that aired an
 * hour ago in a slower category. Rotation orders on position and reports on
 * hours, and this module is the position half.
 */

import type { CartNumber, CategoryCode } from '../util/ids.js';
import type { Play } from './rest.js';

export interface PositionIndex {
  /** How many plays of each category have happened, in order. */
  readonly playsInCategory: ReadonlyMap<CategoryCode, number>;
  /** The category play counter at the moment each cart last played. */
  readonly lastPositionByCart: ReadonlyMap<CartNumber, number>;
  readonly categoryOfCart: ReadonlyMap<CartNumber, CategoryCode>;
}

export interface CategorisedPlay extends Play {
  readonly category: CategoryCode;
}

export function makePositionIndex(plays: readonly CategorisedPlay[]): PositionIndex {
  const playsInCategory = new Map<CategoryCode, number>();
  const lastPositionByCart = new Map<CartNumber, number>();
  const categoryOfCart = new Map<CartNumber, CategoryCode>();
  const ordered = [...plays].sort((a, b) => a.at - b.at);
  for (const play of ordered) {
    const before = playsInCategory.get(play.category) ?? 0;
    playsInCategory.set(play.category, before + 1);
    lastPositionByCart.set(play.cart, before);
    categoryOfCart.set(play.cart, play.category);
  }
  return { playsInCategory, lastPositionByCart, categoryOfCart };
}

export const NO_POSITIONS: PositionIndex = {
  playsInCategory: new Map<CategoryCode, number>(),
  lastPositionByCart: new Map<CartNumber, number>(),
  categoryOfCart: new Map<CartNumber, CategoryCode>(),
};

export function playsIn(index: PositionIndex, category: CategoryCode): number {
  return index.playsInCategory.get(category) ?? 0;
}

/**
 * How many plays of the cart's category have happened since it last played.
 * A cart that has never played rests infinitely, matching `restHours`.
 */
export function restPlays(index: PositionIndex, cart: CartNumber, category: CategoryCode): number {
  const last = index.lastPositionByCart.get(cart);
  if (last === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return playsIn(index, category) - last - 1;
}

/**
 * Rest as a fraction of a full cycle. One means the category has come exactly
 * once round since this cart played, which is the number a director reads when
 * they ask whether a category is turning over properly. Comparable across
 * categories of different sizes, which neither raw measure is.
 */
export function restCycles(
  index: PositionIndex,
  cart: CartNumber,
  category: CategoryCode,
  categorySize: number,
): number {
  if (categorySize <= 0) {
    return 0;
  }
  const plays = restPlays(index, cart, category);
  return plays === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : plays / categorySize;
}

/** A cart is due when the category has come at least once round since it aired. */
export function isDue(
  index: PositionIndex,
  cart: CartNumber,
  category: CategoryCode,
  categorySize: number,
): boolean {
  return restCycles(index, cart, category, categorySize) >= 1;
}

export function withPlay(index: PositionIndex, play: CategorisedPlay): PositionIndex {
  const playsInCategory = new Map(index.playsInCategory);
  const lastPositionByCart = new Map(index.lastPositionByCart);
  const categoryOfCart = new Map(index.categoryOfCart);
  const before = playsInCategory.get(play.category) ?? 0;
  playsInCategory.set(play.category, before + 1);
  lastPositionByCart.set(play.cart, before);
  categoryOfCart.set(play.cart, play.category);
  return { playsInCategory, lastPositionByCart, categoryOfCart };
}

/**
 * The carts of a category ordered best rested first, ties broken on the cart
 * number so the ordering is total and a rerun gives the same log.
 */
export function restOrder(
  index: PositionIndex,
  carts: readonly CartNumber[],
  category: CategoryCode,
): CartNumber[] {
  return [...carts].sort((a, b) => {
    const left = restPlays(index, a, category);
    const right = restPlays(index, b, category);
    if (left !== right) {
      return right - left;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
