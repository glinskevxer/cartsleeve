/**
 * Spot load.
 *
 * How much commercial time an hour carries. Sales wants it high and programming
 * wants it low, and the station sets a ceiling that settles the argument. It is
 * a format decision rather than a legal one for a commercial music station, and
 * a station that quietly exceeds its own ceiling loses listeners rather than a
 * licence.
 *
 * Load is measured three ways and they answer different questions. The hour load
 * is what a listener experiences. The daypart load is what sales sold against.
 * And the longest single break is the one that actually drives people away:
 * eight minutes in one stopset is worse than twelve spread over three.
 */

import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { TENTHS_PER_MINUTE, tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import type { Stopset } from './stopset.js';

const LOD = (n: number): string => codeFor('traffic', n);

export const HOUR_OVER_CEILING = LOD(30);
export const BREAK_TOO_LONG = LOD(31);
export const HOUR_UNDERSOLD = LOD(32);

/** The longest a single break may run before listeners leave. */
export const DEFAULT_BREAK_CEILING = tenths(1800);

/** Below this share of the ceiling an hour is undersold. */
export const DEFAULT_FLOOR_SHARE = 0.4;

export interface HourLoad {
  readonly total: Tenths;
  readonly ceiling: Tenths;
  readonly longestBreak: Tenths;
  readonly breaks: number;
  /** Load as a share of the ceiling, so a report can print a percentage. */
  readonly share: number;
}

export function hourLoad(stopsets: readonly Stopset[], ceiling: Tenths): HourLoad {
  let total = 0;
  let longest = 0;
  for (const stopset of stopsets) {
    total += stopset.length;
    longest = Math.max(longest, stopset.length);
  }
  return {
    total: tenths(total),
    ceiling,
    longestBreak: tenths(longest),
    breaks: stopsets.length,
    share: ceiling === 0 ? 0 : total / ceiling,
  };
}

export function isOverCeiling(load: HourLoad): boolean {
  return load.total > load.ceiling;
}

export function overBy(load: HourLoad): Tenths {
  return tenths(Math.max(0, load.total - load.ceiling));
}

export function remaining(load: HourLoad): Tenths {
  return tenths(Math.max(0, load.ceiling - load.total));
}

export interface LoadOptions {
  readonly breakCeiling?: Tenths;
  readonly floorShare?: number;
}

export function auditLoad(load: HourLoad, options: LoadOptions = {}): Problem[] {
  const problems: Problem[] = [];
  const minutes = (value: number): number => Math.round(value / TENTHS_PER_MINUTE);
  if (isOverCeiling(load)) {
    problems.push(
      error(HOUR_OVER_CEILING, 'hour', 'carries more commercial time than the ceiling allows', {
        minutes: minutes(load.total),
        ceiling: minutes(load.ceiling),
        over: overBy(load),
      }),
    );
  }
  const breakCeiling = options.breakCeiling ?? DEFAULT_BREAK_CEILING;
  if (load.longestBreak > breakCeiling) {
    problems.push(
      warning(BREAK_TOO_LONG, 'hour', 'has a break longer than listeners will sit through', {
        longest: minutes(load.longestBreak),
        allowed: minutes(breakCeiling),
      }),
    );
  }
  const floor = options.floorShare ?? DEFAULT_FLOOR_SHARE;
  if (load.breaks > 0 && load.share < floor) {
    problems.push(
      warning(HOUR_UNDERSOLD, 'hour', 'is well under its commercial ceiling', {
        share: Math.round(load.share * 100),
        floor: Math.round(floor * 100),
      }),
    );
  }
  return problems;
}

export interface LoadSummary {
  readonly hours: number;
  readonly total: Tenths;
  readonly average: Tenths;
  readonly worst: Tenths;
  readonly overCeiling: number;
}

/** Load across many hours, for a daypart or a day. */
export function summariseLoad(loads: readonly HourLoad[]): LoadSummary {
  if (loads.length === 0) {
    return { hours: 0, total: tenths(0), average: tenths(0), worst: tenths(0), overCeiling: 0 };
  }
  let total = 0;
  let worst = 0;
  let over = 0;
  for (const load of loads) {
    total += load.total;
    worst = Math.max(worst, load.total);
    if (isOverCeiling(load)) {
      over += 1;
    }
  }
  return {
    hours: loads.length,
    total: tenths(total),
    average: tenths(total / loads.length),
    worst: tenths(worst),
    overCeiling: over,
  };
}
