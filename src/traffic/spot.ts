/**
 * Spots and the orders they came from.
 *
 * A spot is one commercial airing. It belongs to an order, which is what sales
 * sold: so many spots, in these dayparts, across these dates, for this money.
 * The traffic department turns an order into individual spots and places them in
 * breaks; the music scheduler never sees the order and cares only about the
 * minutes.
 *
 * Except that it does not only care about the minutes. Where the spots land
 * decides where the breaks fall, which decides when the music plays, which
 * decides whether the separation rules pass. Nothing in this module knows that,
 * which is exactly why the coupling is so easy to miss.
 */

import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { Check, take } from '../util/check.js';
import type { Result } from '../util/result.js';
import { parseCartNumber } from '../util/ids.js';
import type { CartNumber } from '../util/ids.js';
import { parseDuration } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import type { BroadcastDay } from '../util/time.js';

const TRF = (n: number): string => codeFor('traffic', n);

/** What the advertiser paid for, and where it may run. */
export interface Order {
  readonly id: string;
  readonly advertiser: string;
  /** Dayparts the order was sold into. Empty means anywhere. */
  readonly dayparts: readonly string[];
  readonly from: BroadcastDay;
  readonly to: BroadcastDay;
  /** How many spots were sold. */
  readonly spots: number;
  /** In cents, so nothing is ever a fraction. */
  readonly rateCents: number;
}

export interface OrderInput {
  readonly id: string;
  readonly advertiser: string;
  readonly dayparts?: readonly string[];
  readonly from: BroadcastDay;
  readonly to: BroadcastDay;
  readonly spots: number;
  readonly rateCents: number;
}

function ordinal(day: BroadcastDay): number {
  return day.year * 10_000 + day.month * 100 + day.day;
}

export function makeOrder(input: OrderInput): Result<Order, Problem[]> {
  const check = new Check();
  const id = input.id.trim();
  check.ensure(id.length > 0, TRF(1), input.id, 'has no order number');
  const advertiser = input.advertiser.trim();
  check.ensure(advertiser.length > 0, TRF(2), id, 'has no advertiser');
  check.ensure(ordinal(input.from) <= ordinal(input.to), TRF(3), id, 'ends before it starts');
  check.ensure(Number.isInteger(input.spots) && input.spots > 0, TRF(4), id, 'sold no spots', {
    spots: input.spots,
  });
  check.ensure(
    Number.isInteger(input.rateCents) && input.rateCents >= 0,
    TRF(5),
    id,
    'has a rate that is not whole cents',
    { rate: input.rateCents },
  );
  return check.result(() => ({
    id,
    advertiser,
    dayparts: [...(input.dayparts ?? [])],
    from: input.from,
    to: input.to,
    spots: input.spots,
    rateCents: input.rateCents,
  }));
}

/** One airing of one commercial. */
export interface Spot {
  readonly id: string;
  readonly orderId: string;
  readonly cart: CartNumber;
  readonly length: Tenths;
  /** Lower runs first inside a break. */
  readonly priority: number;
}

export interface SpotInput {
  readonly id: string;
  readonly orderId: string;
  readonly cart: string;
  readonly length: string;
  readonly priority?: number;
}

export function makeSpot(input: SpotInput): Result<Spot, Problem[]> {
  const check = new Check();
  const id = input.id.trim();
  check.ensure(id.length > 0, TRF(10), input.id, 'has no spot number');
  check.ensure(input.orderId.trim().length > 0, TRF(11), id, 'belongs to no order');
  const cart = check.require(parseCartNumber(input.cart), TRF(12), id, (problem) => problem.reason);
  const length = check.require(
    parseDuration(input.length),
    TRF(13),
    id,
    (problem) => `length ${problem.reason}`,
  );
  return check.result(() => ({
    id,
    orderId: input.orderId.trim(),
    cart: take(cart, 'cart'),
    length: take(length, 'length'),
    priority: input.priority ?? 50,
  }));
}

export function runsOn(order: Order, day: BroadcastDay): boolean {
  return ordinal(day) >= ordinal(order.from) && ordinal(day) <= ordinal(order.to);
}

export function runsIn(order: Order, daypart: string): boolean {
  return order.dayparts.length === 0 || order.dayparts.includes(daypart);
}

/** What the order is worth if every spot runs. */
export function orderValueCents(order: Order): number {
  return order.spots * order.rateCents;
}

export function totalLength(spots: readonly Spot[]): Tenths {
  let total = 0;
  for (const spot of spots) {
    total += spot.length;
  }
  return total as Tenths;
}

/** Spots in the order they should run inside a break. */
export function inRunOrder(spots: readonly Spot[]): Spot[] {
  return [...spots].sort(
    (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
