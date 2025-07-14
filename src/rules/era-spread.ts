/**
 * Era spread.
 *
 * A gold hour that happens to draw six records from the same five years is a
 * themed set nobody planned, and rest ordering produces it regularly, because
 * the carts that rested longest are not spread across the eras by anything.
 *
 * The rule is not a separation. It is a property of a window: the last few
 * records plus the candidate must touch at least so many era bands. That makes
 * it the only rule whose verdict depends on the candidate and the window
 * together rather than on the candidate against one other cart, and it is why
 * it cannot be folded into the distance rules however similar they look.
 *
 * The bands come from the station's era map, so the same six records are a
 * themed set on one format and a spread on another.
 */

import { codeFor } from '../util/problem.js';
import { eraOf } from '../library/era.js';
import { PASSED, rejected } from './rule.js';
import type { Placed, Rule, RuleContext, RuleVerdict } from './rule.js';

export const ERA_TOO_NARROW = codeFor('rule', 9);

/** How many carts back the window reaches, the candidate included. */
export const ERA_WINDOW = 5;
/** How many distinct bands that window must touch. */
export const ERA_MINIMUM_BANDS = 2;

function yearOf(item: Placed): number | undefined {
  return item.entry.recording?.releaseYear;
}

/** The eras of the window behind the slot, nearest last, candidate excluded. */
export function windowEras(context: RuleContext, size: number): string[] {
  const out: string[] = [];
  for (const item of context.schedule.before(context.slot.position)) {
    if (out.length >= size) {
      break;
    }
    const year = yearOf(item);
    if (year === undefined) {
      continue;
    }
    out.unshift(eraOf(context.eras, year));
  }
  return out;
}

export function candidateEra(context: RuleContext): string | undefined {
  const year = context.candidate.recording?.releaseYear;
  return year === undefined ? undefined : eraOf(context.eras, year);
}

/** Distinct bands the window would touch with the candidate placed. */
export function spreadWith(context: RuleContext, size: number): number {
  const era = candidateEra(context);
  const eras = windowEras(context, size - 1);
  if (era !== undefined) {
    eras.push(era);
  }
  return new Set(eras).size;
}

export const eraSpread: Rule = {
  name: 'era spread',
  tier: 5,
  evaluate(context: RuleContext): RuleVerdict {
    const era = candidateEra(context);
    if (era === undefined) {
      return PASSED;
    }
    const behind = windowEras(context, ERA_WINDOW - 1);
    // A window that is not yet full cannot be judged: the hour is just starting.
    if (behind.length < ERA_WINDOW - 1) {
      return PASSED;
    }
    const bands = spreadWith(context, ERA_WINDOW);
    if (bands >= ERA_MINIMUM_BANDS) {
      return PASSED;
    }
    return rejected(
      ERA_TOO_NARROW,
      `would make ${ERA_WINDOW} records from ${bands} era, and ${ERA_MINIMUM_BANDS} are wanted`,
      ERA_MINIMUM_BANDS - bands,
      { era, bands, wanted: ERA_MINIMUM_BANDS, window: ERA_WINDOW },
    );
  },
};

/**
 * How many of the window sit in the candidate's own band. A director reads this
 * rather than the band count, because "four of the last five are outlaw" says
 * what is wrong and "one band" does not.
 */
export function sameBandCount(context: RuleContext, size: number): number {
  const era = candidateEra(context);
  if (era === undefined) {
    return 0;
  }
  return windowEras(context, size).filter((each) => each === era).length;
}
