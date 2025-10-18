/**
 * Merging a whole day of traffic.
 *
 * Two translations happen here and both are easy to get wrong in a way nothing
 * downstream notices.
 *
 * Traffic works in wall clock hours and the schedule works in hour indexes from
 * the start of the broadcast day. On a station whose day starts at 05:00, hour
 * index 0 is 05:00 and hour index 21 is 02:00 the following morning. Getting
 * that backwards puts the overnight breaks on the wrong day, which nobody
 * notices until the invoices go out.
 *
 * And each hour's merge shifts the hours after it. A break that sells short at
 * 07:00 pulls 08:00 earlier, which pulls 09:00 earlier, all the way to the end
 * of the day. So the day merge cannot merge each hour independently against its
 * scheduled start; it has to carry the running clock forward the same way the
 * schedule pass did.
 */

import { codeFor, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import type { FilledHour } from '../schedule/day.js';
import { mergeTraffic } from './merge.js';
import type { MergeOutcome } from './merge.js';
import type { Stopset } from './stopset.js';
import type { Spot } from './spot.js';

const DAY = (n: number): string => codeFor('traffic', n);

export const DAY_DRIFTED = DAY(60);
export const ORPHANED_BREAK = DAY(61);

/** Wall clock hour for an hour index of the broadcast day. */
export function clockHourOf(dayStartHour: number, hourIndex: number): number {
  return (dayStartHour + hourIndex) % 24;
}

/** Hour index for a wall clock hour, on a day that starts where it does. */
export function hourIndexOf(dayStartHour: number, clockHour: number): number {
  return (clockHour - dayStartHour + 24) % 24;
}

export interface DayMergeInput {
  readonly hours: readonly FilledHour[];
  readonly dayStartHour: number;
  /** Spots traffic sold into a break, by wall clock hour and break name. */
  readonly spotsFor: (clockHour: number, breakName: string) => readonly Spot[];
  readonly allowOverfill?: boolean;
  /** How far the day may drift before it is worth reporting. */
  readonly driftTolerance?: Tenths;
}

export const DEFAULT_DRIFT_TOLERANCE = tenths(600);

export interface MergedHour {
  readonly hourIndex: number;
  readonly clockHour: number;
  readonly outcome: MergeOutcome;
}

export interface DayMergeOutcome {
  readonly hours: readonly MergedHour[];
  readonly stopsets: readonly Stopset[];
  readonly endsAt: Tenths;
  /** How far the whole day moved once the real breaks went in. */
  readonly driftedBy: Tenths;
  readonly problems: readonly Problem[];
}

export function mergeDay(input: DayMergeInput): DayMergeOutcome {
  const hours: MergedHour[] = [];
  const stopsets: Stopset[] = [];
  const problems: Problem[] = [];
  let cursor = tenths(0);
  let scheduledEnd = tenths(0);

  for (const hour of input.hours) {
    const clockHour = clockHourOf(input.dayStartHour, hour.hourIndex);
    const outcome = mergeTraffic({
      slots: hour.outcome.slots,
      spotsFor: (breakName) => input.spotsFor(clockHour, breakName),
      startsAt: cursor,
      ...(input.allowOverfill === undefined ? {} : { allowOverfill: input.allowOverfill }),
    });
    hours.push({ hourIndex: hour.hourIndex, clockHour, outcome });
    stopsets.push(...outcome.stopsets);
    problems.push(...outcome.problems);
    cursor = outcome.endsAt;
    scheduledEnd = hour.outcome.endsAt;
  }

  const drifted = tenths(cursor - scheduledEnd);
  const tolerance = input.driftTolerance ?? DEFAULT_DRIFT_TOLERANCE;
  if (Math.abs(drifted) > tolerance) {
    problems.push(
      warning(DAY_DRIFTED, 'day', 'ends somewhere other than the schedule expected', {
        by: drifted,
        tolerance,
      }),
    );
  }

  return { hours, stopsets, endsAt: cursor, driftedBy: drifted, problems };
}

/** Break names the clocks of these hours actually define. */
export function definedBreaks(hours: readonly FilledHour[]): Set<string> {
  const names = new Set<string>();
  for (const hour of hours) {
    for (const slot of hour.outcome.slots) {
      if (slot.element.kind === 'stopset') {
        names.add(slot.element.name);
      }
    }
  }
  return names;
}

/**
 * Break names traffic sold into that no clock defines. Those spots will never
 * air and nothing else in the system will say so, because the merge only ever
 * asks for the breaks the clock has.
 */
export function orphanedBreaks(
  hours: readonly FilledHour[],
  soldInto: readonly string[],
): Problem[] {
  const defined = definedBreaks(hours);
  const seen = new Set<string>();
  const problems: Problem[] = [];
  for (const name of soldInto) {
    if (!defined.has(name) && !seen.has(name)) {
      seen.add(name);
      problems.push(
        warning(ORPHANED_BREAK, name, 'was sold into but no clock defines it', {
          defined: [...defined].sort().join(' '),
        }),
      );
    }
  }
  return problems;
}

/** Every merged music slot of the day, for the royalty reconciliation. */
export function dayMusic(outcome: DayMergeOutcome): {
  hourIndex: number;
  clockHour: number;
  at: Tenths;
  cart: string;
}[] {
  const out: { hourIndex: number; clockHour: number; at: Tenths; cart: string }[] = [];
  for (const hour of outcome.hours) {
    for (const slot of hour.outcome.slots) {
      if (slot.element.kind === 'music' && slot.cart !== undefined) {
        out.push({
          hourIndex: hour.hourIndex,
          clockHour: hour.clockHour,
          at: slot.mergedAt,
          cart: slot.cart,
        });
      }
    }
  }
  return out;
}
