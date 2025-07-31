/**
 * The one walk every separation rule needs.
 *
 * Artist, title, recording, sound and package separation are the same thirty
 * lines five times over: read the minimum off the category, walk the placements
 * inside that window, skip the slot being filled, keep the nearest that matches,
 * and reject with the shortfall if it is inside the minimum.
 *
 * Writing it five times had already cost something. Four of the five remembered
 * to skip the slot being filled and one did not until it was caught by a test;
 * two of them looked only forward before that was fixed; and the package rule
 * has an extra exclusion that reads as arbitrary until you see it beside the
 * others. A rule now says what it matches on and nothing else.
 *
 * What does not fold in is anything measuring something other than a distance:
 * flow measures a step to the neighbour, era spread measures a property of a
 * window, and eligibility measures the candidate alone. Those stay as they are,
 * and the shape of this module is what makes that difference visible.
 */

import { TENTHS_PER_MINUTE } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { PASSED, rejected } from './rule.js';
import type { Placed, Rule, RuleContext, RuleVerdict } from './rule.js';

/** What a rule found when it matched a placement. */
export interface Match {
  /** A phrase naming what collided, used in the message. */
  readonly what: string;
  /** Rule specific detail for the breach report. */
  readonly detail: Readonly<Record<string, string | number>>;
}

export interface Collision extends Match {
  readonly cart: string;
  readonly distance: number;
}

export interface DistanceSpec {
  readonly name: string;
  readonly tier: number;
  readonly code: string;
  /** The minimum for this slot. Zero or less turns the rule off. */
  minimum(context: RuleContext): Tenths;
  /**
   * Whether this placement collides with the candidate, and what to say if it
   * does. Returning undefined means no collision.
   */
  match(context: RuleContext, item: Placed): Match | undefined;
  /** How the rejection reads. Given minutes rather than tenths. */
  message(collision: Collision, minutes: number, needed: number): string;
}

/**
 * The nearest placement matching the spec inside the window.
 *
 * Nearest rather than first, because a candidate can collide on both sides of
 * the slot and the breach report should name the one that actually breaks the
 * minimum. Bounded by the window rather than walking the whole log, because the
 * search runs this once per rule per candidate per slot.
 */
export function nearestCollision(
  context: RuleContext,
  window: Tenths,
  spec: Pick<DistanceSpec, 'match'>,
): Collision | undefined {
  let nearest: Collision | undefined;
  for (const item of context.schedule.within(context.slot.at, window)) {
    if (item.position === context.slot.position) {
      continue;
    }
    const distance = Math.abs(item.at - context.slot.at);
    if (nearest !== undefined && distance >= nearest.distance) {
      continue;
    }
    const found = spec.match(context, item);
    if (found !== undefined) {
      nearest = { ...found, cart: item.cart, distance };
    }
  }
  return nearest;
}

const minutesOf = (tenths: number): number => Math.round(tenths / TENTHS_PER_MINUTE);

export function makeDistanceRule(spec: DistanceSpec): Rule {
  return {
    name: spec.name,
    tier: spec.tier,
    evaluate(context: RuleContext): RuleVerdict {
      const minimum = spec.minimum(context);
      if (minimum <= 0) {
        return PASSED;
      }
      const collision = nearestCollision(context, minimum, spec);
      if (collision === undefined || collision.distance >= minimum) {
        return PASSED;
      }
      const minutes = minutesOf(collision.distance);
      const needed = minutesOf(minimum);
      return rejected(
        spec.code,
        spec.message(collision, minutes, needed),
        minimum - collision.distance,
        {
          ...collision.detail,
          against: collision.cart,
          minutes,
          needed,
        },
      );
    },
  };
}

/**
 * How much room the candidate has, as a multiple of the minimum. One or more
 * passes; below one is the shortfall. The candidate search prefers the cart with
 * the most room among several that all pass, so it looks further than the
 * minimum and caps rather than returning infinity for everything.
 */
export const HEADROOM_WINDOW = 3;

export function headroom(context: RuleContext, spec: DistanceSpec): number {
  const minimum = spec.minimum(context);
  if (minimum <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const collision = nearestCollision(context, (minimum * HEADROOM_WINDOW) as Tenths, spec);
  if (collision === undefined) {
    return HEADROOM_WINDOW;
  }
  return collision.distance / minimum;
}
