/**
 * Title separation.
 *
 * Two carts of the same song must be a long way apart, and same song means the
 * title rather than the master. A gold library carries the original, the single
 * edit, the live version and somebody else's cover, and to a listener those are
 * four plays of one song. To the royalty report they are four different
 * recordings paying four different labels, which is why the two rules exist
 * separately and why they must not be collapsed into one.
 *
 * The minimum is much longer than the artist minimum, usually two and a half
 * hours against seventy five, because hearing the same song twice in a shift is
 * worse than hearing the same artist twice.
 */

import { codeFor } from '../util/problem.js';
import type { Tenths } from '../util/duration.js';
import { headroom, makeDistanceRule, nearestCollision } from './distance.js';
import type { Collision, DistanceSpec, Match } from './distance.js';
import type { Placed, RuleContext } from './rule.js';

export const TITLE_TOO_CLOSE = codeFor('rule', 3);

export function titleMinimum(context: RuleContext): Tenths {
  return context.categories.get(context.slot.category)?.separation.title ?? (0 as Tenths);
}

/**
 * The title a placement counts as. A cart with no recording coded has no
 * normalised title, so it falls back to the cart's own title upper cased: two
 * such carts collide only on an exact match, which is the safe failure for
 * uncoded library.
 */
export function titleOf(item: Placed): string {
  return item.entry.recording?.titleKey ?? item.entry.cart.title.trim().toUpperCase();
}

export function candidateTitle(context: RuleContext): string {
  return context.candidate.recording?.titleKey ?? context.candidate.cart.title.trim().toUpperCase();
}

/** True when the two are different masters of the same song. */
function isCover(context: RuleContext, item: Placed): boolean {
  const ours = context.candidate.recording?.isrc;
  const theirs = item.entry.recording?.isrc;
  return ours !== undefined && theirs !== undefined && ours !== theirs;
}

export const titleSpec: DistanceSpec = {
  name: 'title separation',
  tier: 2,
  code: TITLE_TOO_CLOSE,
  minimum: titleMinimum,
  match(context: RuleContext, item: Placed): Match | undefined {
    const wanted = candidateTitle(context);
    if (wanted.length === 0 || titleOf(item) !== wanted) {
      return undefined;
    }
    const cover = isCover(context, item);
    return { what: wanted, detail: { title: wanted, cover: cover ? 'yes' : 'no' } };
  },
  message: (collision, minutes, needed) => {
    const how = collision.detail['cover'] === 'yes' ? 'as a cover' : 'as the same recording';
    return `${collision.what} played ${minutes} minutes ago ${how} and needs ${needed}`;
  },
};

export const titleSeparation = makeDistanceRule(titleSpec);

export function nearestTitleCollision(context: RuleContext, window: Tenths): Collision | undefined {
  return nearestCollision(context, window, titleSpec);
}

export function titleHeadroom(context: RuleContext): number {
  return headroom(context, titleSpec);
}

/**
 * Covers of the candidate's title anywhere in the window, whether or not they
 * breach. A director planning a gold hour wants the list, because three covers
 * of one song in a library is usually one too many rather than a scheduling
 * problem.
 */
export function coversNear(context: RuleContext, window: Tenths): Collision[] {
  const wanted = candidateTitle(context);
  const out: Collision[] = [];
  for (const item of context.schedule.within(context.slot.at, window)) {
    if (item.position === context.slot.position || titleOf(item) !== wanted) {
      continue;
    }
    if (isCover(context, item)) {
      out.push({
        what: wanted,
        detail: { title: wanted, cover: 'yes' },
        cart: item.cart,
        distance: Math.abs(item.at - context.slot.at),
      });
    }
  }
  return out;
}
