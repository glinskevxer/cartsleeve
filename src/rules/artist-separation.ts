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
 * Which artists count is the station's credit policy.
 */

import { separationKeys } from '../domain/artist.js';
import { codeFor } from '../util/problem.js';
import type { Tenths } from '../util/duration.js';
import { HEADROOM_WINDOW, headroom, makeDistanceRule, nearestCollision } from './distance.js';
import type { Collision, DistanceSpec, Match } from './distance.js';
import type { Placed, RuleContext } from './rule.js';

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

export const artistSpec: DistanceSpec = {
  name: 'artist separation',
  tier: 2,
  code: ARTIST_TOO_CLOSE,
  minimum: artistMinimum,
  match(context: RuleContext, item: Placed): Match | undefined {
    const wanted = new Set(candidateKeys(context));
    if (wanted.size === 0) {
      return undefined;
    }
    for (const key of keysOf(context, item)) {
      if (wanted.has(key)) {
        return { what: key, detail: { artist: key } };
      }
    }
    return undefined;
  },
  message: (collision, minutes, needed) =>
    `${collision.what} is ${minutes} minutes away and needs ${needed}`,
};

export const artistSeparation = makeDistanceRule(artistSpec);

export function nearestArtistCollision(
  context: RuleContext,
  window: Tenths,
): Collision | undefined {
  return nearestCollision(context, window, artistSpec);
}

export function artistHeadroom(context: RuleContext): number {
  return headroom(context, artistSpec);
}

export { HEADROOM_WINDOW };
