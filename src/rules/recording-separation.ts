/**
 * Recording separation.
 *
 * The same master must not air twice inside the minimum. That sounds like the
 * title rule and it is not, in both directions.
 *
 * A cover shares the title and not the master, so the title rule catches it and
 * this one does not. And a master carded twice, once in gold and once in a
 * Christmas category, has two cart numbers, so a rule comparing cart numbers
 * misses it entirely. The second case is the reason this rule exists at all: it
 * is invisible to everything else in the system, and it is what ends up on a
 * performance report as two spins of the same ISRC forty minutes apart.
 */

import { codeFor } from '../util/problem.js';
import { TENTHS_PER_MINUTE } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import type { Isrc } from '../util/ids.js';
import { PASSED, rejected } from './rule.js';
import type { Placed, Rule, RuleContext, RuleVerdict } from './rule.js';

export const RECORDING_TOO_CLOSE = codeFor('rule', 4);

export function recordingMinimum(context: RuleContext): Tenths {
  return context.categories.get(context.slot.category)?.separation.recording ?? (0 as Tenths);
}

export interface RecordingCollision {
  readonly isrc: Isrc;
  readonly cart: string;
  readonly distance: number;
  /** True when the two placements went out on different cart numbers. */
  readonly doubleCarded: boolean;
}

export function nearestRecordingCollision(
  context: RuleContext,
  window: Tenths,
): RecordingCollision | undefined {
  const ours = context.candidate.recording?.isrc;
  if (ours === undefined) {
    return undefined;
  }
  let nearest: RecordingCollision | undefined;
  for (const item of context.schedule.within(context.slot.at, window)) {
    if (item.position === context.slot.position || item.entry.recording?.isrc !== ours) {
      continue;
    }
    const distance = Math.abs(item.at - context.slot.at);
    if (nearest === undefined || distance < nearest.distance) {
      nearest = {
        isrc: ours,
        cart: item.cart,
        distance,
        doubleCarded: item.cart !== context.candidate.cart.number,
      };
    }
  }
  return nearest;
}

export const recordingSeparation: Rule = {
  name: 'recording separation',
  tier: 1,
  evaluate(context: RuleContext): RuleVerdict {
    const minimum = recordingMinimum(context);
    if (minimum <= 0) {
      return PASSED;
    }
    const collision = nearestRecordingCollision(context, minimum);
    if (collision === undefined || collision.distance >= minimum) {
      return PASSED;
    }
    const how = collision.doubleCarded ? ' on another cart' : '';
    return rejected(
      RECORDING_TOO_CLOSE,
      `the same master played ${Math.round(collision.distance / TENTHS_PER_MINUTE)} minutes ago${how} and needs ${Math.round(minimum / TENTHS_PER_MINUTE)}`,
      minimum - collision.distance,
      {
        isrc: collision.isrc,
        against: collision.cart,
        doubleCarded: collision.doubleCarded ? 'yes' : 'no',
        minutes: Math.round(collision.distance / TENTHS_PER_MINUTE),
        needed: Math.round(minimum / TENTHS_PER_MINUTE),
      },
    );
  },
};

/**
 * Every placement of this master in the window, whatever cart it went out on.
 * The royalty reconciliation reads this, because two carts of one master are one
 * recording with two spins and the report has to say so.
 */
export function spinsOfSameMaster(context: RuleContext, window: Tenths): Placed[] {
  const ours = context.candidate.recording?.isrc;
  if (ours === undefined) {
    return [];
  }
  return context.schedule
    .within(context.slot.at, window)
    .filter(
      (item) => item.position !== context.slot.position && item.entry.recording?.isrc === ours,
    )
    .slice();
}
