/**
 * Reading breaches and holes off a filled pass.
 *
 * The day pass had this inline, and anything that fills hours needs the same
 * walk: a week pass, a reschedule of one hour, a what if run over a proposed
 * clock change. Three copies of a loop that decides whether a slot is a hole, a
 * breach or neither is three chances to disagree about it.
 *
 * The decision itself is not obvious enough to leave implicit. A slot is a hole
 * when nothing went in; a breach when something did but only after relaxing; and
 * neither when it was filled cleanly. A slot with a placement and a hole is
 * impossible, and the reader treats the hole as authoritative rather than
 * guessing.
 */

import type { Breach } from './breach.js';
import { breachesFrom } from './breach.js';
import { diagnose } from './hole.js';
import type { HoleRecord } from './hole.js';
import type { FilledSlot } from './hour.js';

/** Code carried by a breach recorded from a relaxation rather than a verdict. */
export const RELAXED_CODE = 'SCH-021';

/**
 * The rules a placement gave up, as failures. The search knows the names rather
 * than the verdicts, because re-evaluating every relaxed rule to get its message
 * would double the cost of a day pass for a report nobody reads on most hours.
 */
export function relaxedFailures(
  names: readonly string[],
  tier: number,
): { rule: string; tier: number; code: string; message: string; shortfall: number }[] {
  return names.map((rule) => ({
    rule,
    tier: tier + 1,
    code: RELAXED_CODE,
    message: 'relaxed to fill the slot',
    shortfall: 0,
  }));
}

export interface Collected {
  readonly breaches: Breach[];
  readonly holes: HoleRecord[];
}

export function collectFrom(slots: readonly FilledSlot[]): Collected {
  const breaches: Breach[] = [];
  const holes: HoleRecord[] = [];
  for (const slot of slots) {
    if (slot.hole !== undefined) {
      holes.push({
        position: slot.element.position,
        category: slot.element.kind === 'music' ? slot.element.category : slot.element.kind,
        diagnosis: diagnose(slot.hole),
      });
      continue;
    }
    const placement = slot.placement;
    if (placement === undefined || placement.relaxedBy === 0 || slot.cart === undefined) {
      continue;
    }
    breaches.push(
      ...breachesFrom({
        position: slot.element.position,
        at: slot.at,
        cart: slot.cart,
        failures: relaxedFailures(placement.breached, placement.tier),
      }),
    );
  }
  return { breaches, holes };
}

/** Fold several collections into one, for a pass over many hours. */
export function merge(parts: readonly Collected[]): Collected {
  return {
    breaches: parts.flatMap((part) => part.breaches),
    holes: parts.flatMap((part) => part.holes),
  };
}
