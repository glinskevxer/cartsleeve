/**
 * Opening and closing the hour.
 *
 * The first record after the top of hour identity and the last before the news
 * are heard by more people than anything else in the hour, because that is when
 * listeners tune in and when they are about to leave. A station will not open on
 * a ballad and will not close on something that fades into a hard news join.
 *
 * Two sources say so and they are different in kind. The clock marks an element
 * as no open or no close, which is about the position; and the cart's own timing
 * makes it a bad opener or closer, which is about the record. Both are checked
 * here because they answer the same question, and a breach report naming only
 * one of them sends a director to the wrong place.
 */

import { codeFor } from '../util/problem.js';
import { PASSED, rejected } from './rule.js';
import type { Rule, RuleContext, RuleVerdict } from './rule.js';

export const BAD_OPENER = codeFor('rule', 10);
export const BAD_CLOSER = codeFor('rule', 11);

/** An intro longer than this leaves dead air over the top of hour identity. */
export const OPENER_MAX_INTRO = 250;

export function isSlowOpener(context: RuleContext): boolean {
  const tempo = context.candidate.attributes?.tempo;
  return tempo === 'ballad' || tempo === 'slow';
}

export function hasLongIntro(context: RuleContext): boolean {
  return context.candidate.cart.timing.intro > OPENER_MAX_INTRO;
}

export const openerRule: Rule = {
  name: 'opener',
  tier: 3,
  evaluate(context: RuleContext): RuleVerdict {
    if (!context.slot.opensHour) {
      return PASSED;
    }
    if (isSlowOpener(context)) {
      const tempo = context.candidate.attributes?.tempo ?? '';
      return rejected(BAD_OPENER, `opens the hour on a ${tempo}`, 1, { tempo, reason: 'tempo' });
    }
    if (hasLongIntro(context)) {
      const intro = context.candidate.cart.timing.intro;
      return rejected(
        BAD_OPENER,
        `opens the hour with a ${(intro / 10).toFixed(1)} second ramp`,
        intro - OPENER_MAX_INTRO,
        { intro, allowed: OPENER_MAX_INTRO, reason: 'intro' },
      );
    }
    return PASSED;
  },
};

/** A cart that ends cold gives the news a clean join. */
export function endsCold(context: RuleContext): boolean {
  return context.candidate.cart.timing.endType === 'cold';
}

export const closerRule: Rule = {
  name: 'closer',
  tier: 3,
  evaluate(context: RuleContext): RuleVerdict {
    if (!context.slot.closesHour || endsCold(context)) {
      return PASSED;
    }
    return rejected(
      BAD_CLOSER,
      `closes the hour on a ${context.candidate.cart.timing.endType} into the news`,
      1,
      { endType: context.candidate.cart.timing.endType, reason: 'ending' },
    );
  },
};

/**
 * Whether the candidate would be a legal opener or closer, ignoring where the
 * slot actually is. The candidate search reads these to prefer a cart that keeps
 * its options open when two are otherwise equal.
 */
export function couldOpen(context: RuleContext): boolean {
  return !isSlowOpener(context) && !hasLongIntro(context);
}

export function couldClose(context: RuleContext): boolean {
  return endsCold(context);
}
