/**
 * Airings nobody scheduled.
 *
 * A jock takes a request, an operator drops in a filler because the network feed
 * is late, or somebody fires the wrong cart. Whatever the reason, something went
 * out that the log did not plan, and it is a spin exactly like any other: it was
 * broadcast, so it is owed.
 *
 * This is the failure mode that costs money in the direction nobody checks. A
 * dropped song makes the report too big and somebody notices, because the label
 * is chasing plays it did not get. An unscheduled play makes it too small, and
 * the only party who would notice is the one nobody asked.
 *
 * So an unscheduled airing is never quietly discarded, and a play of a cart that
 * is not even in the library still produces a spin with the cart number on it,
 * because a report that is short by one is worse than one carrying an unknown.
 */

import { codeFor, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { groupBy } from '../util/ordering.js';
import type { CartNumber } from '../util/ids.js';
import { isMusicCart } from '../util/ids.js';
import type { Library } from '../library/library.js';
import { lookup } from '../library/library.js';
import type { Airing, Rebuild } from './rebuild.js';

const UNS = (n: number): string => codeFor('aired', n);

export const UNSCHEDULED = UNS(30);
export const NOT_IN_LIBRARY = UNS(31);

export type UnscheduledKind = 'manual fire' | 'unknown cart' | 'not music';

export interface Unscheduled {
  readonly airing: Airing;
  readonly kind: UnscheduledKind;
  /** True when royalty still owes on it, which it does for any music. */
  readonly payable: boolean;
}

export interface UnscheduledInput {
  readonly scheduled: readonly { position: number; cart: CartNumber }[];
  readonly rebuild: Rebuild;
  readonly library: Library;
}

/**
 * Find what aired that nobody planned.
 *
 * Matching is by cart rather than by position, because a manual fire has no
 * position at all. A cart scheduled once and aired twice produces one
 * unscheduled airing, which is right: the second one was not planned.
 */
export function findUnscheduled(input: UnscheduledInput): Unscheduled[] {
  const budget = new Map<CartNumber, number>();
  for (const item of input.scheduled) {
    budget.set(item.cart, (budget.get(item.cart) ?? 0) + 1);
  }
  const out: Unscheduled[] = [];
  for (const airing of input.rebuild.airings) {
    const left = budget.get(airing.cart) ?? 0;
    if (left > 0) {
      budget.set(airing.cart, left - 1);
      continue;
    }
    const known = lookup(input.library, airing.cart);
    if (known === undefined) {
      out.push({ airing, kind: 'unknown cart', payable: isMusicCart(airing.cart) });
      continue;
    }
    if (!known.cart.music) {
      out.push({ airing, kind: 'not music', payable: false });
      continue;
    }
    out.push({ airing, kind: 'manual fire', payable: true });
  }
  return out;
}

export function toProblem(item: Unscheduled): Problem {
  const detail = {
    cart: item.airing.cart,
    kind: item.kind,
    payable: item.payable ? 'yes' : 'no',
    at: item.airing.startedAt,
  };
  if (item.kind === 'unknown cart') {
    return warning(
      NOT_IN_LIBRARY,
      item.airing.cart,
      'aired but is not in the library, so nothing is known about it',
      detail,
    );
  }
  if (item.kind === 'not music') {
    return info(UNSCHEDULED, item.airing.cart, 'aired unscheduled and owes nothing', detail);
  }
  return warning(
    UNSCHEDULED,
    item.airing.cart,
    'aired without being scheduled and is owed for',
    detail,
  );
}

/** Everything royalty has to pay on, which is the point of the module. */
export function payable(items: readonly Unscheduled[]): Unscheduled[] {
  return items.filter((item) => item.payable);
}

export function byKind(items: readonly Unscheduled[]): Map<UnscheduledKind, Unscheduled[]> {
  return groupBy(items, (item) => item.kind);
}
