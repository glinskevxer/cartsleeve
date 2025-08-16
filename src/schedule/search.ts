/**
 * Filling one slot.
 *
 * The whole system narrows to this. Take the candidates in rest order, try each
 * against the rules, and take the best of whatever passes. If nothing passes,
 * drop a tier and try the same candidates again. If nothing passes at the floor,
 * leave a hole and say why.
 *
 * Two decisions in here are worth stating because both look like details and
 * neither is.
 *
 * The tier is dropped for the whole slot rather than per candidate. Trying every
 * candidate at every tier and taking the best would find placements that satisfy
 * more rules, and it would also mean a cart that breaks artist separation could
 * beat one that breaks only tempo flow on total score. The ladder exists to say
 * which rules matter more, and scoring across tiers would quietly undo it.
 *
 * And the search records what it gave up. A slot filled at tier two after
 * relaxing three is a breach, not a success, even though a cart went in. A log
 * that does not distinguish those two is a log nobody can act on.
 */

import type { LibraryEntry } from '../library/library.js';
import { evaluate, maxTier } from '../rules/rule.js';
import type { RuleContext, RuleSet, Slot } from '../rules/rule.js';
import { HARD_TIER } from '../rules/tiers.js';
import type { Evaluation } from '../rules/rule.js';
import { compareScored, scoreCandidate } from './score.js';
import type { ScoreInput, ScoreParts } from './score.js';

export interface SearchInput {
  readonly slot: Slot;
  readonly candidates: readonly LibraryEntry[];
  readonly rules: RuleSet;
  /** Build the rule context for one candidate. */
  readonly contextFor: (candidate: LibraryEntry) => RuleContext;
  /** Everything scoring needs that the rule context does not carry. */
  readonly scoring: Omit<ScoreInput, 'context'>;
  readonly floor?: number;
}

export interface Placement {
  readonly entry: LibraryEntry;
  readonly score: ScoreParts;
  /** The tier the slot was filled at. */
  readonly tier: number;
  /** How many tiers had to be dropped. Zero is a clean placement. */
  readonly relaxedBy: number;
  /** The rules given up to place it, empty on a clean placement. */
  readonly breached: readonly string[];
  /** How many candidates were tried before this one was taken. */
  readonly considered: number;
}

export interface Hole {
  readonly reason: 'no candidates' | 'nothing passed';
  /** Why each candidate was rejected at the floor, for the hole report. */
  readonly rejections: readonly { readonly cart: string; readonly rules: readonly string[] }[];
  readonly considered: number;
}

export type SlotOutcome =
  | { readonly filled: true; readonly placement: Placement }
  | { readonly filled: false; readonly hole: Hole };

function passingAt(
  input: SearchInput,
  tier: number,
): { entry: LibraryEntry; score: ScoreParts; considered: number }[] {
  const out: { entry: LibraryEntry; score: ScoreParts; considered: number }[] = [];
  for (const [index, entry] of input.candidates.entries()) {
    const context = input.contextFor(entry);
    if (!evaluate(input.rules, tier, context).passed) {
      continue;
    }
    out.push({
      entry,
      score: scoreCandidate({ ...input.scoring, context }),
      considered: index + 1,
    });
  }
  return out;
}

/** The rules above a tier, which is what settling there gave up. */
function givenUp(rules: RuleSet, tier: number): string[] {
  return rules.rules.filter((rule) => rule.tier > tier).map((rule) => rule.name);
}

export function fillSlot(input: SearchInput): SlotOutcome {
  const floor = input.floor ?? HARD_TIER;
  if (input.candidates.length === 0) {
    return { filled: false, hole: { reason: 'no candidates', rejections: [], considered: 0 } };
  }
  const top = maxTier(input.rules);
  for (let tier = top; tier >= floor; tier -= 1) {
    const passing = passingAt(input, tier);
    if (passing.length === 0) {
      continue;
    }
    const best = [...passing].sort((a, b) =>
      compareScored(
        { total: a.score.total, cart: a.entry.cart.number },
        { total: b.score.total, cart: b.entry.cart.number },
      ),
    )[0];
    if (best === undefined) {
      continue;
    }
    return {
      filled: true,
      placement: {
        entry: best.entry,
        score: best.score,
        tier,
        relaxedBy: top - tier,
        breached: givenUp(input.rules, tier),
        considered: best.considered,
      },
    };
  }
  return {
    filled: false,
    hole: {
      reason: 'nothing passed',
      rejections: input.candidates.map((entry) => ({
        cart: entry.cart.number,
        rules: rejectionsFor(input, entry, floor),
      })),
      considered: input.candidates.length,
    },
  };
}

function rejectionsFor(input: SearchInput, entry: LibraryEntry, floor: number): string[] {
  const evaluation: Evaluation = evaluate(input.rules, floor, input.contextFor(entry));
  return evaluation.failures.map((failure) => failure.rule);
}

/** Whether a placement is clean, which is not the same as the slot being filled. */
export function isClean(outcome: SlotOutcome): boolean {
  return outcome.filled && outcome.placement.relaxedBy === 0;
}
