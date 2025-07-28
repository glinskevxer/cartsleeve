/**
 * Package separation.
 *
 * A station that adds an album adds three or four tracks off it, and rest
 * ordering will happily play two of them in the same hour. To a listener that
 * is an album feature nobody scheduled, and it is invisible to every other rule
 * here: the artist rule catches it only if the tracks are billed identically,
 * the title rule never does, and the recording rule never does.
 *
 * The package is the label's release rather than the station's category, so it
 * comes off the recording. Two carts share a package when their ISRC registrant
 * and year of reference match and their designations are close, which is how a
 * label numbers one release. That is a heuristic and it is stated as one: it
 * catches an album cut against another album cut and misses a compilation,
 * which is the right way round for a rule whose false positives cost airplay.
 */

import { codeFor } from '../util/problem.js';
import { TENTHS_PER_MINUTE } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { isrcParts } from '../util/ids.js';
import type { Isrc } from '../util/ids.js';
import { PASSED, rejected } from './rule.js';
import type { Placed, Rule, RuleContext, RuleVerdict } from './rule.js';

export const PACKAGE_TOO_CLOSE = codeFor('rule', 16);

/** How far apart two designations may be and still be one release. */
export const PACKAGE_SPAN = 20;

/** Minimum between two tracks off one package. Shorter than a title minimum. */
export const PACKAGE_MINIMUM = 60 * TENTHS_PER_MINUTE;

export interface PackageKey {
  readonly registrant: string;
  readonly year: number;
  readonly designation: number;
}

export function packageKeyOf(isrc: Isrc): PackageKey {
  const parts = isrcParts(isrc);
  return {
    registrant: parts.registrant,
    year: parts.year,
    designation: Number.parseInt(parts.designation, 10),
  };
}

/**
 * Whether two recordings look like they came off one release. Same registrant,
 * same year of reference, and designations inside the span.
 */
export function samePackage(a: PackageKey, b: PackageKey): boolean {
  if (a.registrant !== b.registrant || a.year !== b.year) {
    return false;
  }
  return Math.abs(a.designation - b.designation) <= PACKAGE_SPAN;
}

export interface PackageCollision {
  readonly cart: string;
  readonly distance: number;
  readonly gap: number;
}

function keyOf(item: Placed): PackageKey | undefined {
  const isrc = item.entry.recording?.isrc;
  return isrc === undefined ? undefined : packageKeyOf(isrc);
}

export function nearestPackageCollision(
  context: RuleContext,
  window: Tenths,
): PackageCollision | undefined {
  const ours = context.candidate.recording?.isrc;
  if (ours === undefined) {
    return undefined;
  }
  const mine = packageKeyOf(ours);
  let nearest: PackageCollision | undefined;
  for (const item of context.schedule.within(context.slot.at, window)) {
    if (item.position === context.slot.position) {
      continue;
    }
    const theirs = keyOf(item);
    if (theirs === undefined || !samePackage(mine, theirs)) {
      continue;
    }
    // The same recording is the recording rule's business, not this one's.
    if (item.entry.recording?.isrc === ours) {
      continue;
    }
    const distance = Math.abs(item.at - context.slot.at);
    if (nearest === undefined || distance < nearest.distance) {
      nearest = {
        cart: item.cart,
        distance,
        gap: Math.abs(mine.designation - theirs.designation),
      };
    }
  }
  return nearest;
}

export const packageSeparation: Rule = {
  name: 'package separation',
  tier: 4,
  evaluate(context: RuleContext): RuleVerdict {
    const collision = nearestPackageCollision(context, PACKAGE_MINIMUM as Tenths);
    if (collision === undefined || collision.distance >= PACKAGE_MINIMUM) {
      return PASSED;
    }
    return rejected(
      PACKAGE_TOO_CLOSE,
      `is off the same release as ${collision.cart}, ${Math.round(collision.distance / TENTHS_PER_MINUTE)} minutes away`,
      PACKAGE_MINIMUM - collision.distance,
      {
        against: collision.cart,
        gap: collision.gap,
        minutes: Math.round(collision.distance / TENTHS_PER_MINUTE),
        needed: Math.round(PACKAGE_MINIMUM / TENTHS_PER_MINUTE),
      },
    );
  },
};
