/**
 * The schedule under construction.
 *
 * Rules measure against this, not against the library, and that is the whole
 * reason a music log is a search rather than a sort. Every placement changes
 * what the next rule sees, so the log is built by asking questions of a thing
 * that is still being built.
 *
 * Two properties matter more than speed. The reader must be consistent, so two
 * rules asked in the same state get the same answer; and it must be cheap to
 * ask, because the search asks it once per rule per candidate per slot, which
 * on a week of programming is millions of times.
 *
 * The wall clock query is the interesting one. Separation is stated in minutes,
 * so `within` has to walk by time rather than by position, and the two orders
 * are not the same once a stopset lands between them.
 */

import { ascending } from '../util/ordering.js';
import type { Tenths } from '../util/duration.js';
import type { CartNumber } from '../util/ids.js';
import type { Placed, ScheduleReader } from './rule.js';

export interface ScheduleView extends ScheduleReader {
  readonly placed: readonly Placed[];
  readonly byCart: ReadonlyMap<CartNumber, readonly Placed[]>;
}

/**
 * Build a reader over a set of placements. The list is sorted once by time so
 * the wall clock queries can walk it, and by position so the neighbour queries
 * can index it.
 */
export function makeScheduleView(placed: readonly Placed[]): ScheduleView {
  const byPosition = [...placed].sort((a, b) => ascending(a.position, b.position));
  const byTime = [...placed].sort(
    (a, b) => ascending(a.at, b.at) || ascending(a.position, b.position),
  );
  const byCart = new Map<CartNumber, Placed[]>();
  for (const item of byPosition) {
    const bucket = byCart.get(item.cart);
    if (bucket === undefined) {
      byCart.set(item.cart, [item]);
    } else {
      bucket.push(item);
    }
  }
  const positions = new Map(byPosition.map((item, index) => [item.position, index]));

  return {
    placed: byPosition,
    byCart,
    count: byPosition.length,

    before(position: number): readonly Placed[] {
      const out: Placed[] = [];
      for (let index = byPosition.length - 1; index >= 0; index -= 1) {
        const item = byPosition[index];
        if (item !== undefined && item.position < position) {
          out.push(item);
        }
      }
      return out;
    },

    after(position: number): readonly Placed[] {
      const out: Placed[] = [];
      for (const item of byPosition) {
        if (item.position > position) {
          out.push(item);
        }
      }
      return out;
    },

    within(at: Tenths, distance: Tenths): readonly Placed[] {
      const out: Placed[] = [];
      for (const item of byTime) {
        if (Math.abs(item.at - at) <= distance) {
          out.push(item);
        }
      }
      return out;
    },

    previous(position: number): Placed | undefined {
      const index = positions.get(position);
      if (index !== undefined) {
        return byPosition[index - 1];
      }
      let best: Placed | undefined;
      for (const item of byPosition) {
        if (item.position < position && (best === undefined || item.position > best.position)) {
          best = item;
        }
      }
      return best;
    },
  };
}

export const EMPTY_VIEW: ScheduleView = makeScheduleView([]);

export function withPlaced(view: ScheduleView, item: Placed): ScheduleView {
  return makeScheduleView([...view.placed, item]);
}

export function withoutPosition(view: ScheduleView, position: number): ScheduleView {
  return makeScheduleView(view.placed.filter((item) => item.position !== position));
}

/** Every placement of this cart so far, nearest in time to `at` first. */
export function playsOf(view: ScheduleView, cart: CartNumber): readonly Placed[] {
  return view.byCart.get(cart) ?? [];
}

/**
 * Wall clock distance from `at` to the nearest placement matching a predicate,
 * or infinity if there is none. This is the primitive every separation rule is
 * written in terms of.
 */
export function nearestMatch(
  view: ScheduleView,
  at: Tenths,
  matches: (item: Placed) => boolean,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const item of view.placed) {
    if (!matches(item)) {
      continue;
    }
    nearest = Math.min(nearest, Math.abs(item.at - at));
  }
  return nearest;
}

/** How much of the log so far sits in a category, for the hour summary. */
export function countInCategory(view: ScheduleView, category: string): number {
  return view.placed.filter((item) => item.category === category).length;
}
