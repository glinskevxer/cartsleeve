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
 * hours against seventy five minutes, because hearing the same song twice in a
 * shift is worse than hearing the same artist twice.
 */

import { codeFor } from '../util/problem.js';
import { TENTHS_PER_MINUTE } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { PASSED, rejected } from './rule.js';
import type { Placed, Rule, RuleContext, RuleVerdict } from './rule.js';

export const TITLE_TOO_CLOSE = codeFor('rule', 3);

export function titleMinimum(context: RuleContext): Tenths {
  return context.categories.get(context.slot.category)?.separation.title ?? (0 as Tenths);
}

/**
 * The title a placement counts as. A cart with no recording coded has no
 * normalised title, so it falls back to the cart's own title run through
 * nothing: two such carts only collide on an exact match, which is the safe
 * failure for uncoded library.
 */
export function titleOf(item: Placed): string {
  return item.entry.recording?.titleKey ?? item.entry.cart.title.trim().toUpperCase();
}

export function candidateTitle(context: RuleContext): string {
  return context.candidate.recording?.titleKey ?? context.candidate.cart.title.trim().toUpperCase();
}

export interface TitleCollision {
  readonly title: string;
  readonly cart: string;
  readonly distance: number;
  /** True when the two are different masters of the same song. */
  readonly cover: boolean;
}

export function nearestTitleCollision(
  context: RuleContext,
  window: Tenths,
): TitleCollision | undefined {
  const wanted = candidateTitle(context);
  if (wanted.length === 0) {
    return undefined;
  }
  const ours = context.candidate.recording?.isrc;
  let nearest: TitleCollision | undefined;
  for (const item of context.schedule.within(context.slot.at, window)) {
    if (item.position === context.slot.position || titleOf(item) !== wanted) {
      continue;
    }
    const distance = Math.abs(item.at - context.slot.at);
    if (nearest !== undefined && distance >= nearest.distance) {
      continue;
    }
    const theirs = item.entry.recording?.isrc;
    nearest = {
      title: wanted,
      cart: item.cart,
      distance,
      cover: ours !== undefined && theirs !== undefined && ours !== theirs,
    };
  }
  return nearest;
}

export const titleSeparation: Rule = {
  name: 'title separation',
  tier: 2,
  evaluate(context: RuleContext): RuleVerdict {
    const minimum = titleMinimum(context);
    if (minimum <= 0) {
      return PASSED;
    }
    const collision = nearestTitleCollision(context, minimum);
    if (collision === undefined || collision.distance >= minimum) {
      return PASSED;
    }
    const how = collision.cover ? 'as a cover' : 'as the same recording';
    return rejected(
      TITLE_TOO_CLOSE,
      `${collision.title} played ${Math.round(collision.distance / TENTHS_PER_MINUTE)} minutes ago ${how} and needs ${Math.round(minimum / TENTHS_PER_MINUTE)}`,
      minimum - collision.distance,
      {
        title: collision.title,
        against: collision.cart,
        cover: collision.cover ? 'yes' : 'no',
        minutes: Math.round(collision.distance / TENTHS_PER_MINUTE),
        needed: Math.round(minimum / TENTHS_PER_MINUTE),
      },
    );
  },
};

/**
 * Covers of the candidate's title anywhere in the window, whether or not they
 * breach. A director planning a gold hour wants the list, because three covers
 * of one song in a library is usually one too many rather than a scheduling
 * problem.
 */
export function coversNear(context: RuleContext, window: Tenths): TitleCollision[] {
  const wanted = candidateTitle(context);
  const ours = context.candidate.recording?.isrc;
  const out: TitleCollision[] = [];
  for (const item of context.schedule.within(context.slot.at, window)) {
    if (item.position === context.slot.position || titleOf(item) !== wanted) {
      continue;
    }
    const theirs = item.entry.recording?.isrc;
    if (ours !== undefined && theirs !== undefined && ours !== theirs) {
      out.push({
        title: wanted,
        cart: item.cart,
        distance: Math.abs(item.at - context.slot.at),
        cover: true,
      });
    }
  }
  return out;
}
