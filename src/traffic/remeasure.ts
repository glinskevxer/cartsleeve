/**
 * Remeasuring the music rules against the log that will actually air.
 *
 * This is the module the whole traffic layer exists for.
 *
 * The music pass satisfied every separation rule against the budgeted timing.
 * The merge then moved everything, because the breaks did not sell at budget.
 * Separation is a wall clock rule stated in minutes, so a pair that was forty
 * one minutes apart when it was scheduled can be thirty eight apart on the log
 * that airs, and nothing in the music pass could have known.
 *
 * So the rules are run again over the merged placements, and the findings are
 * reported as their own kind. A breach found here is not a scheduling mistake:
 * the scheduler did everything right with what it had. It is the cost of selling
 * a break short, and the only useful response is either to accept it or to give
 * the hour back to the scheduler with the real break lengths in it.
 */

import { codeFor, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import type { Placed, RuleContext, RuleSet, Slot } from '../rules/rule.js';
import { evaluate } from '../rules/rule.js';
import { makeScheduleView } from '../rules/schedule-view.js';
import type { Breach } from '../schedule/breach.js';
import { breachesFrom } from '../schedule/breach.js';
import type { MergedSlot } from './merge.js';

const RMS = (n: number): string => codeFor('traffic', n);

export const CAUSED_BY_TRAFFIC = RMS(70);

/** Turn merged slots back into placements, at the times they will really air. */
export function placementsFrom(slots: readonly MergedSlot[]): Placed[] {
  const out: Placed[] = [];
  for (const slot of slots) {
    if (slot.element.kind !== 'music' || slot.placement === undefined || slot.cart === undefined) {
      continue;
    }
    out.push({
      cart: slot.cart,
      entry: slot.placement.entry,
      position: slot.element.position,
      at: slot.mergedAt,
      category: slot.element.category,
      cell: 0,
    });
  }
  return out;
}

export interface RemeasureInput {
  readonly slots: readonly MergedSlot[];
  readonly rules: RuleSet;
  /** The tier the music pass settled at, so nothing already relaxed is counted. */
  readonly tier: number;
  /** Build a rule context for a placement being checked against the others. */
  readonly contextFor: (slot: Slot, placed: Placed, others: readonly Placed[]) => RuleContext;
  readonly cell?: number;
}

export interface RemeasureOutcome {
  readonly breaches: readonly Breach[];
  readonly problems: readonly Problem[];
  /** How many placements were checked. */
  readonly checked: number;
}

/**
 * Run the rules over the merged log.
 *
 * Each placement is checked against every other, itself excluded, which is what
 * the search did while it was building the hour. Everything is present now,
 * where the forward pass could only see what came before, so this can find pairs
 * the original run genuinely could not.
 */
export function remeasure(input: RemeasureInput): RemeasureOutcome {
  const placements = placementsFrom(input.slots);
  const breaches: Breach[] = [];
  for (const placement of placements) {
    const others = placements.filter((each) => each.position !== placement.position);
    const slot: Slot = {
      position: placement.position,
      at: placement.at,
      category: placement.category,
      cell: input.cell ?? placement.cell,
      day: { year: 0, month: 1, day: 1 },
      opensHour: false,
      closesHour: false,
    };
    const context: RuleContext = {
      ...input.contextFor(slot, placement, others),
      schedule: makeScheduleView(others),
      slot,
      candidate: placement.entry,
    };
    const evaluation = evaluate(input.rules, input.tier, context);
    if (evaluation.passed) {
      continue;
    }
    breaches.push(
      ...breachesFrom({
        position: placement.position,
        at: placement.at,
        cart: placement.cart,
        failures: evaluation.failures,
      }),
    );
  }
  const problems =
    breaches.length === 0
      ? []
      : [
          warning(
            CAUSED_BY_TRAFFIC,
            'hour',
            'breaks separation once the real break lengths are in, though it did not when it was scheduled',
            { breaches: breaches.length },
          ),
        ];
  return { breaches, problems, checked: placements.length };
}

/** How far the merge moved the pair that now breaches, for the report. */
export function movementBehind(slots: readonly MergedSlot[], position: number): Tenths {
  const found = slots.find((slot) => slot.element.position === position);
  return tenths(found?.movedBy ?? 0);
}

/** Breaches that appear only after the merge, given what the pass already knew. */
export function newlyBreached(before: readonly Breach[], after: readonly Breach[]): Breach[] {
  const known = new Set(before.map((breach) => `${breach.position}:${breach.rule}`));
  return after.filter((breach) => !known.has(`${breach.position}:${breach.rule}`));
}
