/**
 * Eligibility as a rule.
 *
 * The rotation order already filters out carts that are restricted or retired,
 * so on an ordinary pass this rule never fires: nothing that reaches it could
 * fail it. That is exactly why it has to exist.
 *
 * Three paths put a cart in a slot without going through the filter. A manual
 * pin puts one there by hand. A reschedule of one hour reads yesterday's log and
 * revalidates it against today's restrictions. And the relaxation pass can be
 * asked to fill a hole from a wider pool. In all three the filter was not
 * consulted, and a constraint that lives only in the filter is silently not
 * enforced.
 *
 * So the constraint is expressed twice, and the pair being consistent is
 * something to test rather than to assume. It sits at tier zero because a
 * retired record airing is a licensing problem rather than a taste one.
 */

import { codeFor } from '../util/problem.js';
import { allowedInCell } from '../library/restriction.js';
import type { RestrictionMap } from '../library/restriction.js';
import { liveOn } from '../library/window.js';
import type { WindowMap } from '../library/window.js';
import { PASSED, rejected } from './rule.js';
import type { Rule, RuleContext, RuleVerdict } from './rule.js';

export const NOT_LIVE = codeFor('rule', 12);
export const RESTRICTED_HERE = codeFor('rule', 13);

/**
 * The rule needs the restriction and window maps, which are not on the context
 * because most rules do not want them. Building the rule around them keeps the
 * context narrow and makes the dependency explicit at the point of assembly.
 */
export function makeEligibilityRule(restrictions: RestrictionMap, windows: WindowMap): Rule {
  return {
    name: 'eligibility',
    tier: 0,
    evaluate(context: RuleContext): RuleVerdict {
      const cart = context.candidate.cart.number;
      if (!liveOn(windows, cart, context.slot.day)) {
        return rejected(NOT_LIVE, 'is not live on this broadcast day', 1, {
          cart,
          day: `${context.slot.day.year}-${context.slot.day.month}-${context.slot.day.day}`,
        });
      }
      if (!allowedInCell(restrictions, cart, context.slot.cell)) {
        return rejected(RESTRICTED_HERE, 'is restricted out of this hour', 1, {
          cart,
          cell: context.slot.cell,
        });
      }
      return PASSED;
    },
  };
}

/** Whether the candidate is eligible, asked directly rather than as a verdict. */
export function isEligible(
  restrictions: RestrictionMap,
  windows: WindowMap,
  context: RuleContext,
): boolean {
  return makeEligibilityRule(restrictions, windows).evaluate(context).passed;
}

/**
 * The category slot the candidate is being considered for must be the one it is
 * carded into. The search only ever offers carts from the right category, so
 * like the rest of this module it is a guard against the paths that bypass it.
 */
export const categoryMatch: Rule = {
  name: 'category match',
  tier: 0,
  evaluate(context: RuleContext): RuleVerdict {
    if (context.candidate.cart.category === context.slot.category) {
      return PASSED;
    }
    return rejected(
      codeFor('rule', 14),
      `is carded ${context.candidate.cart.category} and the slot wants ${context.slot.category}`,
      1,
      { carded: context.candidate.cart.category, wanted: context.slot.category },
    );
  },
};

/** A slot may only be filled by a music cart. */
export const musicOnly: Rule = {
  name: 'music only',
  tier: 0,
  evaluate(context: RuleContext): RuleVerdict {
    if (context.candidate.cart.music) {
      return PASSED;
    }
    return rejected(codeFor('rule', 15), 'is not a music cart', 1, {
      cart: context.candidate.cart.number,
    });
  },
};
