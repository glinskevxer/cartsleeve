/**
 * The rule set and the relaxation ladder.
 *
 * Every rule carries a tier. The scheduler tries to fill a slot with every rule
 * satisfied; if nothing fits it drops the highest tier and tries again, and
 * keeps going down until either something fits or it runs out of tiers and
 * leaves a hole.
 *
 * The order is a policy decision rather than a technical one, and it is the
 * decision that most changes what the log looks like on a hard hour:
 *
 *   0  eligibility, category, music        never relaxed, these are correctness
 *   1  recording separation                the same master twice is indefensible
 *   2  artist and title separation         the rules a listener would name
 *   3  sound separation, open and close    texture and presentation
 *   4  featured credit, package            refinements
 *   5  era spread, tempo flow              shape
 *   6  mood flow, tempo variety            polish
 *
 * A station that would rather leave a hole than break artist separation sets the
 * floor at 2, and one that would rather play anything than leave dead air sets
 * it at 0. Both are legitimate and the ladder makes the choice explicit instead
 * of burying it in the order the rules happen to run.
 */

import { makeRuleSet, maxTier } from './rule.js';
import type { Rule, RuleContext, RuleSet } from './rule.js';
import { evaluate } from './rule.js';
import type { Evaluation } from './rule.js';
import { artistSeparation } from './artist-separation.js';
import { titleSeparation } from './title-separation.js';
import { recordingSeparation } from './recording-separation.js';
import { soundSeparation } from './sound-separation.js';
import { packageSeparation } from './package-separation.js';
import { featuredSeparation } from './featured.js';
import { eraSpread } from './era-spread.js';
import { moodFlow, tempoFlow, tempoVariety } from './flow.js';
import { closerRule, openerRule } from './position-rules.js';
import { categoryMatch, makeEligibilityRule, musicOnly } from './eligibility.js';
import type { RestrictionMap } from '../library/restriction.js';
import type { WindowMap } from '../library/window.js';

/** The lowest tier, which the relaxation pass may never drop. */
export const HARD_TIER = 0;

/** Rules that do not depend on the restriction or window maps. */
export const STANDARD_RULES: readonly Rule[] = [
  categoryMatch,
  musicOnly,
  recordingSeparation,
  artistSeparation,
  titleSeparation,
  soundSeparation,
  openerRule,
  closerRule,
  featuredSeparation,
  packageSeparation,
  eraSpread,
  tempoFlow,
  moodFlow,
  tempoVariety,
];

export function standardRuleSet(
  restrictions: RestrictionMap,
  windows: WindowMap,
  extra: readonly Rule[] = [],
): RuleSet {
  return makeRuleSet([makeEligibilityRule(restrictions, windows), ...STANDARD_RULES, ...extra]);
}

export interface RelaxationOutcome {
  /** The tier at which the context passed, or undefined if it never did. */
  readonly tier?: number;
  readonly evaluation: Evaluation;
  /** How many tiers had to be dropped to get there. */
  readonly relaxedBy: number;
}

/**
 * Walk down the ladder until the context passes.
 *
 * Reports the tier it settled at and the evaluation there, so a caller can
 * record which rules were given up. A pass at the top tier is not the same
 * event as a pass at tier two and the breach report has to tell them apart.
 */
export function relax(
  set: RuleSet,
  context: RuleContext,
  floor: number = HARD_TIER,
): RelaxationOutcome {
  const top = maxTier(set);
  for (let tier = top; tier >= floor; tier -= 1) {
    const evaluation = evaluate(set, tier, context);
    if (evaluation.passed) {
      return { tier, evaluation, relaxedBy: top - tier };
    }
  }
  return { evaluation: evaluate(set, floor, context), relaxedBy: top - floor + 1 };
}

/** The rules given up by settling at a tier, for the breach report. */
export function relaxedRules(set: RuleSet, tier: number): Rule[] {
  return set.rules.filter((rule) => rule.tier > tier);
}

/** The tiers actually in use, ascending, so a report can walk them. */
export function tiersInUse(set: RuleSet): number[] {
  return [...new Set(set.rules.map((rule) => rule.tier))].sort((a, b) => a - b);
}

export function rulesByTier(set: RuleSet): Map<number, Rule[]> {
  const byTier = new Map<number, Rule[]>();
  for (const rule of set.rules) {
    const bucket = byTier.get(rule.tier);
    if (bucket === undefined) {
      byTier.set(rule.tier, [rule]);
    } else {
      bucket.push(rule);
    }
  }
  return byTier;
}
