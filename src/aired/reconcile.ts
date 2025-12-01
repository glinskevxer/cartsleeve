/**
 * Reconciling what aired against what was scheduled.
 *
 * Three questions asked at once, because they are the same question from
 * different sides: what was planned and did not air, what aired and was not
 * planned, and what aired at a different time from the plan.
 *
 * Asking them separately is what makes a reconciliation wrong. A cart that was
 * scheduled at 07:20, dropped, and manually fired at 08:40 shows up as one drop
 * and one unscheduled play, and reporting both is not false but it is not what
 * happened either. It moved. So the reconciliation matches those up and calls it
 * a move, which is the only reading a director recognises and the only one that
 * pays royalty exactly once.
 */

import { codeFor, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { ascending } from '../util/ordering.js';
import type { CartNumber } from '../util/ids.js';
import type { Library } from '../library/library.js';
import type { EventStream } from './event.js';
import type { Rebuild } from './rebuild.js';
import { findDrops } from './dropped.js';
import type { Drop } from './dropped.js';
import { findUnscheduled } from './unscheduled.js';
import type { Unscheduled } from './unscheduled.js';
import { measureRecovery, measureTiming } from './timing.js';
import type { Deviation, PlannedStart, Recovery } from './timing.js';

const REC = (n: number): string => codeFor('aired', n);

export const MOVED = REC(50);

export interface Moved {
  readonly cart: CartNumber;
  readonly position: number;
  readonly plannedAt: number;
  readonly airedAt: number;
  readonly by: number;
}

export interface ReconcileInput {
  readonly planned: readonly PlannedStart[];
  readonly stream: EventStream;
  readonly rebuild: Rebuild;
  readonly library: Library;
}

export interface Reconciliation {
  readonly dropped: readonly Drop[];
  readonly unscheduled: readonly Unscheduled[];
  readonly moved: readonly Moved[];
  readonly deviations: readonly Deviation[];
  readonly recovery: Recovery;
  readonly aired: number;
  readonly planned: number;
}

/**
 * A drop and an unscheduled play of the same cart are one move. Matching them
 * up is what keeps royalty from paying twice and the report from reading as two
 * separate incidents.
 */
export function reconcile(input: ReconcileInput): Reconciliation {
  const scheduled = input.planned.map((item) => ({ position: item.position, cart: item.cart }));
  const drops = findDrops({ scheduled, stream: input.stream, rebuild: input.rebuild });
  const unscheduled = findUnscheduled({
    scheduled,
    rebuild: input.rebuild,
    library: input.library,
  });

  const plannedAt = new Map(input.planned.map((item) => [item.cart, item.at]));
  const moved: Moved[] = [];
  const dropsLeft: Drop[] = [];
  const claimed = new Set<Unscheduled>();

  for (const drop of drops) {
    const match = unscheduled.find((item) => !claimed.has(item) && item.airing.cart === drop.cart);
    if (match === undefined) {
      dropsLeft.push(drop);
      continue;
    }
    claimed.add(match);
    const planned = plannedAt.get(drop.cart) ?? match.airing.startedAt;
    moved.push({
      cart: drop.cart,
      position: drop.position,
      plannedAt: planned,
      airedAt: match.airing.startedAt,
      by: match.airing.startedAt - planned,
    });
  }

  const deviations = measureTiming(input.planned, input.rebuild.airings);
  return {
    dropped: dropsLeft,
    unscheduled: unscheduled.filter((item) => !claimed.has(item)),
    moved: moved.sort((a, b) => ascending(a.position, b.position)),
    deviations,
    recovery: measureRecovery(deviations),
    aired: input.rebuild.airings.length,
    planned: input.planned.length,
  };
}

export function movedProblem(moved: Moved): Problem {
  const seconds = Math.round(Math.abs(moved.by) / 1000);
  const direction = moved.by >= 0 ? 'later' : 'earlier';
  const detail = { cart: moved.cart, by: moved.by, seconds };
  const subject = `slot ${moved.position}`;
  return seconds > 300
    ? warning(MOVED, subject, `${moved.cart} aired ${seconds} seconds ${direction}`, detail)
    : info(MOVED, subject, `${moved.cart} aired ${seconds} seconds ${direction}`, detail);
}

/** Whether the hour aired as planned, ignoring slippage inside tolerance. */
export function isFaithful(reconciliation: Reconciliation): boolean {
  return (
    reconciliation.dropped.length === 0 &&
    reconciliation.unscheduled.length === 0 &&
    reconciliation.moved.length === 0
  );
}

/** How much of the plan survived to air, as a fraction. */
export function fidelity(reconciliation: Reconciliation): number {
  if (reconciliation.planned === 0) {
    return 1;
  }
  const faithful =
    reconciliation.planned - reconciliation.dropped.length - reconciliation.moved.length;
  return Math.max(0, faithful) / reconciliation.planned;
}
