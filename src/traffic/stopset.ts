/**
 * Filling a commercial break.
 *
 * The clock says a break sits here and is built to hold so much. Traffic decides
 * what actually goes in it, from the spots due to run that day in that daypart.
 *
 * The break almost never comes out at its budget, and that is the point. A break
 * built for two minutes holding two thirty second spots runs a minute short, and
 * every piece of music after it moves a minute earlier. A break oversold to two
 * and a half minutes moves everything thirty seconds later. Neither is a music
 * decision and both change what the separation rules measure.
 *
 * Spots are placed by priority until the next one will not fit. A spot that
 * would overfill the break is not squeezed in, because a break that runs long
 * pushes the news, and joining the network late is worse than an unsold thirty
 * seconds.
 */

import { codeFor, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { inRunOrder, totalLength } from './spot.js';
import type { Spot } from './spot.js';

const STP = (n: number): string => codeFor('traffic', n);

export const BREAK_SHORT = STP(20);
export const BREAK_OVER = STP(21);
export const SPOT_DROPPED = STP(22);

export interface Stopset {
  readonly name: string;
  /** What the clock built the break to hold. */
  readonly budget: Tenths;
  readonly spots: readonly Spot[];
  /** What it actually runs, which is the sum of what went in. */
  readonly length: Tenths;
  /** Spots that were due but did not fit. */
  readonly dropped: readonly Spot[];
}

export interface FillOptions {
  /** How far past the budget a break may run before spots are refused. */
  readonly tolerance?: Tenths;
  /** Fill past the budget rather than dropping. Used when traffic oversold. */
  readonly allowOverfill?: boolean;
}

export const DEFAULT_TOLERANCE = tenths(0);

/**
 * Place spots into a break in run order, stopping when the next will not fit.
 *
 * A spot that does not fit is skipped rather than ending the fill, because a
 * sixty second spot that will not fit should not block a thirty that would.
 */
export function fillStopset(
  name: string,
  budget: Tenths,
  due: readonly Spot[],
  options: FillOptions = {},
): Stopset {
  const ceiling = budget + (options.tolerance ?? DEFAULT_TOLERANCE);
  const placed: Spot[] = [];
  const dropped: Spot[] = [];
  let used = 0;
  for (const spot of inRunOrder(due)) {
    if (options.allowOverfill === true || used + spot.length <= ceiling) {
      placed.push(spot);
      used += spot.length;
    } else {
      dropped.push(spot);
    }
  }
  return {
    name,
    budget,
    spots: placed,
    length: tenths(used),
    dropped,
  };
}

/** How far the break runs from what the clock built it for. */
export function stopsetDrift(stopset: Stopset): Tenths {
  return tenths(stopset.length - stopset.budget);
}

export function isShort(stopset: Stopset): boolean {
  return stopset.length < stopset.budget;
}

export function isOver(stopset: Stopset): boolean {
  return stopset.length > stopset.budget;
}

/** Unsold time in the break, which is what sales is measured on. */
export function unsold(stopset: Stopset): Tenths {
  return tenths(Math.max(0, stopset.budget - stopset.length));
}

export function auditStopset(stopset: Stopset): Problem[] {
  const problems: Problem[] = [];
  const drift = stopsetDrift(stopset);
  if (drift < 0) {
    problems.push(
      info(BREAK_SHORT, stopset.name, 'runs short of its budget', {
        by: unsold(stopset),
        budget: stopset.budget,
      }),
    );
  }
  if (drift > 0) {
    problems.push(
      warning(BREAK_OVER, stopset.name, 'runs past its budget and pushes the hour', {
        by: drift,
        budget: stopset.budget,
      }),
    );
  }
  for (const spot of stopset.dropped) {
    problems.push(
      warning(SPOT_DROPPED, stopset.name, 'could not fit a spot that was due', {
        spot: spot.id,
        order: spot.orderId,
        length: spot.length,
      }),
    );
  }
  return problems;
}

/** Time the whole run of breaks carries, for the hour summary. */
export function totalCommercialTime(stopsets: readonly Stopset[]): Tenths {
  let total = 0;
  for (const stopset of stopsets) {
    total += stopset.length;
  }
  return tenths(total);
}

export function droppedSpots(stopsets: readonly Stopset[]): Spot[] {
  return stopsets.flatMap((stopset) => [...stopset.dropped]);
}

/** What the break would have run if everything due had been placed. */
export function demandedLength(stopset: Stopset): Tenths {
  return tenths(stopset.length + totalLength([...stopset.dropped]));
}
