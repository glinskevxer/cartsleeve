/**
 * Category membership over time.
 *
 * The library says where a cart is now. Rotation analysis needs to know where
 * it was, because a cart carded down from A to G last Tuesday has plays in the
 * log from both categories, and counting all of them against G makes G look
 * like it is turning over twice as fast as it is.
 *
 * The history is the list of cardings, and everything here is derived from it
 * rather than stored alongside it, so the two can never disagree.
 */

import type { CartNumber, CategoryCode } from '../util/ids.js';
import { ascending, groupBy } from '../util/ordering.js';
import type { Carding } from './carding.js';

export interface MembershipSpan {
  readonly cart: CartNumber;
  readonly category: CategoryCode;
  readonly from: number;
  /** Absent while the cart is still in this category. */
  readonly to?: number;
}

export interface History {
  readonly cardings: readonly Carding[];
  readonly byCart: ReadonlyMap<CartNumber, readonly Carding[]>;
}

export function makeHistory(cardings: readonly Carding[]): History {
  const ordered = [...cardings].sort((a, b) => ascending(a.at, b.at));
  return { cardings: ordered, byCart: groupBy(ordered, (carding) => carding.cart) };
}

export const EMPTY_HISTORY: History = {
  cardings: [],
  byCart: new Map<CartNumber, readonly Carding[]>(),
};

/** The spans a cart has spent in each category, in order, most recent last. */
export function spansFor(history: History, cart: CartNumber): MembershipSpan[] {
  const cardings = history.byCart.get(cart) ?? [];
  const spans: MembershipSpan[] = [];
  for (const [index, carding] of cardings.entries()) {
    const next = cardings[index + 1];
    spans.push({
      cart,
      category: carding.to,
      from: carding.at,
      ...(next === undefined ? {} : { to: next.at }),
    });
  }
  return spans;
}

/**
 * Which category the cart was in at a given moment. Undefined before its first
 * carding, which is the honest answer rather than guessing the current one.
 */
export function categoryAt(
  history: History,
  cart: CartNumber,
  at: number,
): CategoryCode | undefined {
  const cardings = history.byCart.get(cart) ?? [];
  let found: CategoryCode | undefined;
  for (const carding of cardings) {
    if (carding.at > at) {
      break;
    }
    found = carding.to;
  }
  return found;
}

/** Every cart that was in this category at that moment. */
export function membersAt(history: History, category: CategoryCode, at: number): CartNumber[] {
  const out: CartNumber[] = [];
  for (const cart of history.byCart.keys()) {
    if (categoryAt(history, cart, at) === category) {
      out.push(cart);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** How long the cart has been where it is, from the moment given. */
export function tenureAt(history: History, cart: CartNumber, at: number): number | undefined {
  const cardings = history.byCart.get(cart) ?? [];
  let since: number | undefined;
  for (const carding of cardings) {
    if (carding.at > at) {
      break;
    }
    since = carding.at;
  }
  return since === undefined ? undefined : at - since;
}

/** How many times the cart has moved, which is one less than its span count. */
export function moveCount(history: History, cart: CartNumber): number {
  return Math.max(0, (history.byCart.get(cart) ?? []).length - 1);
}

/**
 * Carts that have moved more than a director would expect. A record bouncing
 * between categories every fortnight is usually a sign that nobody agrees about
 * it, and it never settles into a rotation position.
 */
export function churn(history: History, moves: number): CartNumber[] {
  const out: CartNumber[] = [];
  for (const cart of history.byCart.keys()) {
    if (moveCount(history, cart) >= moves) {
      out.push(cart);
    }
  }
  return out;
}

export function withCarding(history: History, carding: Carding): History {
  return makeHistory([...history.cardings, carding]);
}

export function withCardings(history: History, cardings: readonly Carding[]): History {
  return makeHistory([...history.cardings, ...cardings]);
}
