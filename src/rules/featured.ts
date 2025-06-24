/**
 * Separation under featured credit.
 *
 * The billed policy counts only the primary, which is what makes a library with
 * a heavy guest artist schedulable at all. It also means two records ten minutes
 * apart can both be half by the same person, which no listener hears as two
 * different artists.
 *
 * The usual answer is not to switch to strict credit, because that makes the
 * guest unschedulable and the director will turn it back off within a week. It
 * is to hold featured credits to a shorter minimum than billed ones, at a tier
 * the scheduler may relax when nothing else fits.
 *
 * So the same collision is graded three ways depending on the station:
 *
 *   billed policy, no feature rule  the collision is invisible
 *   billed policy, feature rule     a soft breach at a reduced minimum
 *   strict policy                   a hard breach at the full minimum
 *
 * and the choice between them changes the log, the breach report and, because
 * royalty always pays every credit, the relationship between the log and the
 * report.
 */

import { royaltyKeys, separationKeys } from '../domain/artist.js';
import { codeFor } from '../util/problem.js';
import { TENTHS_PER_MINUTE } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { artistMinimum } from './artist-separation.js';
import { PASSED, rejected } from './rule.js';
import type { Placed, Rule, RuleContext, RuleVerdict } from './rule.js';

export const FEATURED_TOO_CLOSE = codeFor('rule', 2);

/** What fraction of the billed minimum a featured credit is held to. */
export const FEATURED_FRACTION = 0.5;

export function featuredMinimum(context: RuleContext): Tenths {
  return Math.round(artistMinimum(context) * FEATURED_FRACTION) as Tenths;
}

/**
 * Artists the candidate is credited to that separation is not already counting.
 * Under strict credit this is always empty, because separation counts them all.
 */
export function uncountedCredits(context: RuleContext): string[] {
  const counted = new Set(
    separationKeys(context.candidate.cart.credits, context.station.creditPolicy),
  );
  return royaltyKeys(context.candidate.cart.credits).filter((key) => !counted.has(key));
}

function creditsOf(item: Placed): Set<string> {
  return new Set(royaltyKeys(item.entry.cart.credits));
}

export interface FeaturedCollision {
  readonly artist: string;
  readonly cart: string;
  readonly distance: number;
}

/**
 * The nearest placement sharing any credit with the candidate, counting
 * featured credits on both sides whatever the station's policy says.
 */
export function nearestCreditCollision(
  context: RuleContext,
  window: Tenths,
): FeaturedCollision | undefined {
  const wanted = new Set(royaltyKeys(context.candidate.cart.credits));
  if (wanted.size === 0) {
    return undefined;
  }
  let nearest: FeaturedCollision | undefined;
  for (const item of context.schedule.within(context.slot.at, window)) {
    if (item.position === context.slot.position) {
      continue;
    }
    for (const key of creditsOf(item)) {
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

export const featuredSeparation: Rule = {
  name: 'featured separation',
  tier: 4,
  evaluate(context: RuleContext): RuleVerdict {
    const minimum = featuredMinimum(context);
    if (minimum <= 0) {
      return PASSED;
    }
    const collision = nearestCreditCollision(context, minimum);
    if (collision === undefined || collision.distance >= minimum) {
      return PASSED;
    }
    return rejected(
      FEATURED_TOO_CLOSE,
      `${collision.artist} is credited ${Math.round(collision.distance / TENTHS_PER_MINUTE)} minutes away and features need ${Math.round(minimum / TENTHS_PER_MINUTE)}`,
      minimum - collision.distance,
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
 * Collisions the billed policy cannot see: pairs sharing a credit inside the
 * full artist minimum where the primaries differ. This is the diagnostic that
 * tells a director what switching the policy would cost them.
 */
export function invisibleCollisions(context: RuleContext): FeaturedCollision[] {
  const minimum = artistMinimum(context);
  if (minimum <= 0 || context.station.creditPolicy === 'strict') {
    return [];
  }
  const counted = new Set(separationKeys(context.candidate.cart.credits, 'billed'));
  const all = new Set(royaltyKeys(context.candidate.cart.credits));
  const out: FeaturedCollision[] = [];
  for (const item of context.schedule.within(context.slot.at, minimum)) {
    if (item.position === context.slot.position) {
      continue;
    }
    const theirCounted = new Set(separationKeys(item.entry.cart.credits, 'billed'));
    for (const key of creditsOf(item)) {
      if (!all.has(key)) {
        continue;
      }
      if (counted.has(key) && theirCounted.has(key)) {
        continue;
      }
      out.push({ artist: key, cart: item.cart, distance: Math.abs(item.at - context.slot.at) });
    }
  }
  return out;
}
