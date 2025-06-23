/**
 * Artist separation.
 *
 * No two carts by the same artist inside the category's artist minimum. This is
 * the rule everybody in the building knows by name and the one that fails most
 * often, because it is stated in minutes of wall clock rather than in songs.
 *
 * Stating it in minutes is what couples it to everything else. Sell one more
 * spot into the hour and the music moves later; put a longer record in slot two
 * and everything after it slides; change a segue overlap by two seconds and the
 * whole rest of the hour shifts. None of those are music decisions and all of
 * them can turn a legal pair into a breach, which is why the rule reads the
 * schedule under construction and not the running order.
 *
 * Which artists count is the station's credit policy, and that is the next
 * module's problem. This one takes whatever keys it is given.
 */

import { separationKeys } from '../domain/artist.js';
import { codeFor } from '../util/problem.js';
import { TENTHS_PER_MINUTE } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { PASSED, rejected } from './rule.js';
import type { Placed, Rule, RuleContext, RuleVerdict } from './rule.js';

export const ARTIST_TOO_CLOSE = codeFor('rule', 1);

/** The minimum the slot's category asks for, falling back to nothing. */
export function artistMinimum(context: RuleContext): Tenths {
  return context.categories.get(context.slot.category)?.separation.artist ?? (0 as Tenths);
}

/** The artists a placed item counts as, under the station's policy. */
export function keysOf(context: RuleContext, item: Placed): string[] {
  return separationKeys(item.entry.cart.credits, context.station.creditPolicy);
}

export function candidateKeys(context: RuleContext): string[] {
  return separationKeys(context.candidate.cart.credits, context.station.creditPolicy);
}

export interface Collision {
  readonly artist: string;
  readonly cart: string;
  /** Wall clock distance in tenths. */
  readonly distance: number;
}

/**
 * The nearest placement sharing an artist with the candidate, inside a window.
 *
 * Nearest rather than first, because a candidate can collide on both sides of
 * the slot and the breach report should name the one that actually breaks the
 * minimum. Bounded by a window rather than walking the whole log, because the
 * search runs this once per candidate per slot and the log is a week long.
 */
export function nearestArtistCollision(
  context: RuleContext,
  window: Tenths,
): Collision | undefined {
  const wanted = new Set(candidateKeys(context));
  if (wanted.size === 0) {
    return undefined;
  }
  let nearest: Collision | undefined;
  for (const item of context.schedule.within(context.slot.at, window)) {
    if (item.position === context.slot.position) {
      continue;
    }
    for (const key of keysOf(context, item)) {
      if (!wanted.has(key)) {
        continue;
      }
      const distance = Math.abs(item.at - context.slot.at);
      if (nearest === undefined || distance < nearest.distance) {
        nearest = { artist: key, cart: item.cart, distance };
      }
    }
  }
  return nearest;
}

export const artistSeparation: Rule = {
  name: 'artist separation',
  tier: 2,
  evaluate(context: RuleContext): RuleVerdict {
    const minimum = artistMinimum(context);
    if (minimum <= 0) {
      return PASSED;
    }
    const collision = nearestArtistCollision(context, minimum);
    if (collision === undefined || collision.distance >= minimum) {
      return PASSED;
    }
    const short = minimum - collision.distance;
    return rejected(
      ARTIST_TOO_CLOSE,
      `${collision.artist} is ${Math.round(collision.distance / TENTHS_PER_MINUTE)} minutes away and needs ${Math.round(minimum / TENTHS_PER_MINUTE)}`,
      short,
      {
        artist: collision.artist,
        against: collision.cart,
        minutes: Math.round(collision.distance / TENTHS_PER_MINUTE),
        needed: Math.round(minimum / TENTHS_PER_MINUTE),
      },
    );
  },
};

/**
 * How much room the candidate has, as a multiple of the minimum. One or more
 * passes; below one is the shortfall. The candidate search uses this to prefer
 * the cart with the most room among several that all pass, so it looks further
 * than the minimum and caps rather than returning infinity for everything.
 */
export const HEADROOM_WINDOW = 3;

export function artistHeadroom(context: RuleContext): number {
  const minimum = artistMinimum(context);
  if (minimum <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const window = (minimum * HEADROOM_WINDOW) as Tenths;
  const collision = nearestArtistCollision(context, window);
  if (collision === undefined) {
    return HEADROOM_WINDOW;
  }
  return collision.distance / minimum;
}
