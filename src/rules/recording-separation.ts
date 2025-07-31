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
import type { Tenths } from '../util/duration.js';
import { headroom, makeDistanceRule, nearestCollision } from './distance.js';
import type { Collision, DistanceSpec, Match } from './distance.js';
import type { Placed, RuleContext } from './rule.js';

export const RECORDING_TOO_CLOSE = codeFor('rule', 4);

export function recordingMinimum(context: RuleContext): Tenths {
  return context.categories.get(context.slot.category)?.separation.recording ?? (0 as Tenths);
}

export const recordingSpec: DistanceSpec = {
  name: 'recording separation',
  tier: 1,
  code: RECORDING_TOO_CLOSE,
  minimum: recordingMinimum,
  match(context: RuleContext, item: Placed): Match | undefined {
    const ours = context.candidate.recording?.isrc;
    if (ours === undefined || item.entry.recording?.isrc !== ours) {
      return undefined;
    }
    const doubleCarded = item.cart !== context.candidate.cart.number;
    return {
      what: ours,
      detail: { isrc: ours, doubleCarded: doubleCarded ? 'yes' : 'no' },
    };
  },
  message: (collision, minutes, needed) => {
    const how = collision.detail['doubleCarded'] === 'yes' ? ' on another cart' : '';
    return `the same master played ${minutes} minutes ago${how} and needs ${needed}`;
  },
};

export const recordingSeparation = makeDistanceRule(recordingSpec);

export function nearestRecordingCollision(
  context: RuleContext,
  window: Tenths,
): Collision | undefined {
  return nearestCollision(context, window, recordingSpec);
}

export function recordingHeadroom(context: RuleContext): number {
  return headroom(context, recordingSpec);
}

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
