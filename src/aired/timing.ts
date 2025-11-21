/**
 * When things actually started, against when they were meant to.
 *
 * An hour runs late because a break sold long, a jock talked, or the network fed
 * late. It catches up because the automation dumps a record, cuts a break, or
 * simply because the next few carts are shorter than the ones they replaced.
 *
 * The useful shape is not the deviation at any one point but the curve: an hour
 * forty seconds late at the top and on time at the bottom caught up and nobody
 * needs to know. An hour that starts on time and ends ninety seconds late did
 * not, and the next hour inherits it.
 *
 * So this measures each airing against its planned start, and then reports
 * whether the hour recovered, because those are two different questions and only
 * the second one matters to the operator.
 */

import { codeFor, error, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { ascending } from '../util/ordering.js';
import type { CartNumber } from '../util/ids.js';
import type { Airing } from './rebuild.js';

const TIM = (n: number): string => codeFor('aired', n);

export const RAN_LATE = TIM(40);
export const RAN_EARLY = TIM(41);
export const NEVER_RECOVERED = TIM(42);

/** Past this a deviation is worth reporting. Under it is normal slippage. */
export const NORMAL_SLIP_MS = 10_000;

/** Past this the hour is in trouble rather than merely late. */
export const SERIOUS_SLIP_MS = 60_000;

export interface PlannedStart {
  readonly cart: CartNumber;
  readonly position: number;
  /** When the merged log said it would start, in milliseconds. */
  readonly at: number;
}

export interface Deviation {
  readonly cart: CartNumber;
  readonly position: number;
  readonly plannedAt: number;
  readonly actualAt: number;
  /** Positive when it ran late. */
  readonly by: number;
}

export function measureTiming(
  planned: readonly PlannedStart[],
  airings: readonly Airing[],
): Deviation[] {
  const byCart = new Map<CartNumber, Airing[]>();
  for (const airing of airings) {
    const bucket = byCart.get(airing.cart);
    if (bucket === undefined) {
      byCart.set(airing.cart, [airing]);
    } else {
      bucket.push(airing);
    }
  }
  const out: Deviation[] = [];
  for (const item of planned) {
    const candidates = byCart.get(item.cart);
    const airing = candidates?.shift();
    if (airing === undefined) {
      continue;
    }
    out.push({
      cart: item.cart,
      position: item.position,
      plannedAt: item.at,
      actualAt: airing.startedAt,
      by: airing.startedAt - item.at,
    });
  }
  return out.sort((a, b) => ascending(a.position, b.position));
}

export function isLate(deviation: Deviation): boolean {
  return deviation.by > NORMAL_SLIP_MS;
}

export function isEarly(deviation: Deviation): boolean {
  return deviation.by < -NORMAL_SLIP_MS;
}

export interface Recovery {
  /** The worst the hour got, signed. */
  readonly worst: number;
  /** Where it ended up. */
  readonly finished: number;
  /** True when it came back inside normal slippage by the end. */
  readonly recovered: boolean;
}

export function measureRecovery(deviations: readonly Deviation[]): Recovery {
  if (deviations.length === 0) {
    return { worst: 0, finished: 0, recovered: true };
  }
  let worst = 0;
  for (const deviation of deviations) {
    if (Math.abs(deviation.by) > Math.abs(worst)) {
      worst = deviation.by;
    }
  }
  const last = deviations[deviations.length - 1];
  const finished = last?.by ?? 0;
  return { worst, finished, recovered: Math.abs(finished) <= NORMAL_SLIP_MS };
}

export function auditTiming(deviations: readonly Deviation[]): Problem[] {
  const problems: Problem[] = [];
  for (const deviation of deviations) {
    if (!isLate(deviation) && !isEarly(deviation)) {
      continue;
    }
    const seconds = Math.round(Math.abs(deviation.by) / 1000);
    const detail = { cart: deviation.cart, seconds, by: deviation.by };
    const subject = `slot ${deviation.position}`;
    if (isLate(deviation)) {
      problems.push(
        Math.abs(deviation.by) > SERIOUS_SLIP_MS
          ? error(RAN_LATE, subject, `started ${seconds} seconds late`, detail)
          : warning(RAN_LATE, subject, `started ${seconds} seconds late`, detail),
      );
    } else {
      problems.push(info(RAN_EARLY, subject, `started ${seconds} seconds early`, detail));
    }
  }
  const recovery = measureRecovery(deviations);
  if (!recovery.recovered) {
    problems.push(
      warning(NEVER_RECOVERED, 'hour', 'never came back on time and hands the slip to the next', {
        worst: recovery.worst,
        finished: recovery.finished,
      }),
    );
  }
  return problems;
}

/** The deviations worth showing, largest first. */
export function worstFirst(deviations: readonly Deviation[]): Deviation[] {
  return [...deviations]
    .filter((deviation) => isLate(deviation) || isEarly(deviation))
    .sort((a, b) => Math.abs(b.by) - Math.abs(a.by) || ascending(a.position, b.position));
}
