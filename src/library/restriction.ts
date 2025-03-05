/**
 * Daypart restriction.
 *
 * A cart can be held out of dayparts. A ballad is kept out of morning drive, a
 * novelty record is kept to weekends, a song about a bad night is kept out of
 * the school run. The restriction is on the cart and it is read every time the
 * scheduler asks which carts are eligible.
 *
 * This is the first rule in the system that changes what another rule measures.
 * Turnover is nominally the category size times the hours between plays, but a
 * cart restricted out of half the week is not in the category for those hours,
 * so the real turnover depends on the restriction map and on which clocks the
 * grid happens to run. A director who restricts twenty carts out of mornings
 * has changed the morning turnover of the whole category without touching it.
 */

import { covers } from '../domain/daypart.js';
import type { Daypart, WeekCell } from '../domain/daypart.js';
import { coversCell } from '../domain/daypart.js';
import type { CartNumber } from '../util/ids.js';
import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { Check } from '../util/check.js';
import type { Result } from '../util/result.js';

/**
 * `allow` means the cart plays only in these dayparts. `deny` means it plays
 * anywhere except them. A cart with no rule plays anywhere, and a cart with an
 * empty allow list plays nowhere, which is a real state a director uses to park
 * a record without retiring it.
 */
export type RestrictionMode = 'allow' | 'deny';

export interface Restriction {
  readonly cart: CartNumber;
  readonly mode: RestrictionMode;
  readonly dayparts: readonly string[];
  readonly note: string;
}

export interface RestrictionMap {
  readonly byCart: ReadonlyMap<CartNumber, Restriction>;
  readonly dayparts: ReadonlyMap<string, Daypart>;
}

export interface RestrictionInput {
  readonly cart: CartNumber;
  readonly mode: RestrictionMode;
  readonly dayparts: readonly string[];
  readonly note?: string;
}

const RES = (n: number): string => codeFor('library', n);

export function makeRestrictionMap(
  inputs: readonly RestrictionInput[],
  dayparts: readonly Daypart[],
): Result<RestrictionMap, Problem[]> {
  const check = new Check();
  const known = new Map(dayparts.map((daypart) => [daypart.name, daypart]));
  const byCart = new Map<CartNumber, Restriction>();
  for (const input of inputs) {
    const already = byCart.has(input.cart);
    if (!check.ensure(!already, RES(80), input.cart, 'has two restrictions')) {
      continue;
    }
    let usable = true;
    for (const name of input.dayparts) {
      usable =
        check.ensure(known.has(name), RES(81), input.cart, 'names a daypart nothing defines', {
          daypart: name,
        }) && usable;
    }
    if (!usable) {
      continue;
    }
    byCart.set(input.cart, {
      cart: input.cart,
      mode: input.mode,
      dayparts: [...input.dayparts],
      note: input.note ?? '',
    });
  }
  return check.result(() => ({ byCart, dayparts: known }));
}

export const NO_RESTRICTIONS: RestrictionMap = {
  byCart: new Map<CartNumber, Restriction>(),
  dayparts: new Map<string, Daypart>(),
};

function namedDayparts(map: RestrictionMap, restriction: Restriction): Daypart[] {
  const out: Daypart[] = [];
  for (const name of restriction.dayparts) {
    const daypart = map.dayparts.get(name);
    if (daypart !== undefined) {
      out.push(daypart);
    }
  }
  return out;
}

/** Whether the cart may play in this cell of the week. */
export function allowedInCell(map: RestrictionMap, cart: CartNumber, cell: WeekCell): boolean {
  const restriction = map.byCart.get(cart);
  if (restriction === undefined) {
    return true;
  }
  const named = namedDayparts(map, restriction);
  const inAny = named.some((daypart) => coversCell(daypart, cell));
  return restriction.mode === 'allow' ? inAny : !inAny;
}

export function allowedAt(
  map: RestrictionMap,
  cart: CartNumber,
  day: number,
  hour: number,
): boolean {
  const restriction = map.byCart.get(cart);
  if (restriction === undefined) {
    return true;
  }
  const named = namedDayparts(map, restriction);
  const inAny = named.some((daypart) => covers(daypart, day, hour));
  return restriction.mode === 'allow' ? inAny : !inAny;
}

/** How many of the week's 168 cells this cart may play in. */
export function reachOf(map: RestrictionMap, cart: CartNumber): number {
  let count = 0;
  for (let cell = 0; cell < 168; cell += 1) {
    if (allowedInCell(map, cart, cell)) {
      count += 1;
    }
  }
  return count;
}

/** Carts that may play nowhere at all, which is worth a director knowing. */
export function parked(map: RestrictionMap): CartNumber[] {
  const out: CartNumber[] = [];
  for (const cart of map.byCart.keys()) {
    if (reachOf(map, cart) === 0) {
      out.push(cart);
    }
  }
  return out;
}

export function restrictionOf(map: RestrictionMap, cart: CartNumber): Restriction | undefined {
  return map.byCart.get(cart);
}
