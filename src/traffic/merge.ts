/**
 * Merging traffic into the music log.
 *
 * The music pass filled the hour using each break's clock budget, because that
 * was all it knew. Traffic then says what actually sold into each break, and
 * almost none of them come out at budget. The merge rebuilds the hour's times
 * with the real break lengths in place of the budgeted ones.
 *
 * Nothing about the music changes. The same carts play in the same order. Only
 * the times move, and that is the whole problem: separation is a wall clock rule
 * measured in minutes, so two records that were forty one minutes apart on the
 * budgeted timing can be thirty eight apart once a break sells short, and a rule
 * that passed at schedule time fails on the log that actually airs.
 *
 * Which means the merge is not a presentation step. It is the point at which a
 * traffic decision becomes a music compliance finding, and the only way to know
 * is to remeasure afterwards.
 */

import { codeFor, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import type { FilledSlot } from '../schedule/hour.js';
import { NO_SEGUE, Walk } from '../schedule/timeline.js';
import { fillStopset } from './stopset.js';
import type { Stopset } from './stopset.js';
import type { Spot } from './spot.js';

const MRG = (n: number): string => codeFor('traffic', n);

export const HOUR_MOVED = MRG(50);
export const BREAK_EMPTY = MRG(51);

export interface MergedSlot extends FilledSlot {
  /** Where the slot lands once the real break lengths are in. */
  readonly mergedAt: Tenths;
  /** How far it moved from where the music pass put it. */
  readonly movedBy: Tenths;
  /** Present on a stopset slot once it has been filled from traffic. */
  readonly stopset?: Stopset;
}

export interface MergeInput {
  readonly slots: readonly FilledSlot[];
  /** The spots traffic sold into each named break of this hour. */
  readonly spotsFor: (breakName: string) => readonly Spot[];
  readonly startsAt: Tenths;
  readonly allowOverfill?: boolean;
}

export interface MergeOutcome {
  readonly slots: readonly MergedSlot[];
  readonly stopsets: readonly Stopset[];
  readonly endsAt: Tenths;
  /** How far the whole hour moved, positive when it runs longer. */
  readonly hourMovedBy: Tenths;
  readonly problems: readonly Problem[];
}

export function mergeTraffic(input: MergeInput): MergeOutcome {
  const slots: MergedSlot[] = [];
  const stopsets: Stopset[] = [];
  const problems: Problem[] = [];
  const walk = new Walk(input.startsAt);
  const wasEnd = input.slots.reduce<number>(
    (end, slot) => Math.max(end, slot.at + slot.length),
    input.startsAt,
  );

  for (const slot of input.slots) {
    if (slot.element.kind === 'stopset') {
      const filled = fillStopset(
        slot.element.name,
        slot.element.budget,
        input.spotsFor(slot.element.name),
        input.allowOverfill === undefined ? {} : { allowOverfill: input.allowOverfill },
      );
      stopsets.push(filled);
      if (filled.spots.length === 0) {
        problems.push(
          info(BREAK_EMPTY, filled.name, 'sold nothing and runs as dead air', {
            budget: filled.budget,
          }),
        );
      }
      const at = walk.place(NO_SEGUE, filled.length);
      slots.push({ ...slot, mergedAt: at, movedBy: tenths(at - slot.at), stopset: filled });
      continue;
    }
    if (slot.hole !== undefined) {
      const at = walk.skip();
      slots.push({ ...slot, mergedAt: at, movedBy: tenths(at - slot.at) });
      continue;
    }
    const timing = slot.placement === undefined ? NO_SEGUE : slot.placement.entry.cart.timing;
    const at = walk.place(timing, slot.length);
    slots.push({ ...slot, mergedAt: at, movedBy: tenths(at - slot.at) });
  }

  const moved = tenths(walk.endsAt - wasEnd);
  if (moved !== 0) {
    problems.push(
      warning(HOUR_MOVED, 'hour', 'changed length once the real breaks went in', {
        by: moved,
        was: wasEnd,
        now: walk.endsAt,
      }),
    );
  }

  return { slots, stopsets, endsAt: walk.endsAt, hourMovedBy: moved, problems };
}

/** The music slots of a merged hour, which is what gets remeasured. */
export function mergedMusic(outcome: MergeOutcome): MergedSlot[] {
  return outcome.slots.filter((slot) => slot.element.kind === 'music' && slot.cart !== undefined);
}

/** The furthest any single slot moved, which is the number that predicts a breach. */
export function worstMove(outcome: MergeOutcome): Tenths {
  let worst = 0;
  for (const slot of outcome.slots) {
    if (Math.abs(slot.movedBy) > Math.abs(worst)) {
      worst = slot.movedBy;
    }
  }
  return tenths(worst);
}

export function anythingMoved(outcome: MergeOutcome): boolean {
  return outcome.slots.some((slot) => slot.movedBy !== 0);
}
