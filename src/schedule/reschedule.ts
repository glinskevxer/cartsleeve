/**
 * Rescheduling one hour in place.
 *
 * A director rejects an hour, or a record is pulled, or traffic sells another
 * break in. Refilling the whole day would work and is not acceptable: the rest
 * of the day has been approved, some of it has already aired, and a director who
 * asked to fix 15:00 will not accept 07:00 changing underneath them.
 *
 * So one hour is refilled against the hours around it, and this is the one path
 * where the rules can see forward as well as back. The 16:00 hour already exists,
 * so a cart placed at 15:55 is measured against it, which the forward day pass
 * could never do. That makes a rescheduled hour slightly better constrained than
 * an originally scheduled one, and it means rescheduling an hour that was clean
 * can produce breaches that were not there before. That is not a regression; the
 * original pass simply could not see them.
 *
 * The hour keeps its own position space, so nothing outside it moves.
 */

import { codeFor, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { Placed } from '../rules/rule.js';
import { fillHour } from './hour.js';
import type { HourInput, HourOutcome } from './hour.js';
import { collectFrom } from './collect.js';
import type { Breach } from './breach.js';
import type { HoleRecord } from './hole.js';

export const RESCHEDULE_NEW_BREACH = codeFor('schedule', 50);
export const RESCHEDULE_LONGER = codeFor('schedule', 51);

export interface RescheduleInput {
  /** The hour to refill, as it would be filled from scratch. */
  readonly hour: HourInput;
  /** Everything scheduled before this hour, on this day and earlier. */
  readonly before: readonly Placed[];
  /** Everything scheduled after it, which the forward pass could not see. */
  readonly after: readonly Placed[];
  /** What the hour held before, so the outcome can be compared against it. */
  readonly previous?: HourOutcome;
}

export interface RescheduleOutcome {
  readonly outcome: HourOutcome;
  readonly breaches: readonly Breach[];
  readonly holes: readonly HoleRecord[];
  /** Carts that were in the hour before and are not now. */
  readonly dropped: readonly string[];
  /** Carts in the hour now that were not before. */
  readonly added: readonly string[];
  readonly problems: readonly Problem[];
}

export function rescheduleHour(input: RescheduleInput): RescheduleOutcome {
  const outcome = fillHour({
    ...input.hour,
    carried: [...(input.hour.carried ?? []), ...input.before, ...input.after],
  });
  const collected = collectFrom(outcome.slots);
  const wasCarts = new Set(
    (input.previous?.placed ?? []).map((item) => item.cart as unknown as string),
  );
  const nowCarts = new Set(outcome.placed.map((item) => item.cart as unknown as string));
  const dropped = [...wasCarts].filter((cart) => !nowCarts.has(cart)).sort();
  const added = [...nowCarts].filter((cart) => !wasCarts.has(cart)).sort();

  const problems: Problem[] = [];
  const previous = input.previous;
  if (previous !== undefined) {
    if (previous.breaches === 0 && outcome.breaches > 0) {
      problems.push(
        warning(
          RESCHEDULE_NEW_BREACH,
          'reschedule',
          'introduced breaches into an hour that had none, because it can see the hours after it',
          { breaches: outcome.breaches },
        ),
      );
    }
    if (outcome.endsAt - previous.endsAt !== 0) {
      problems.push(
        warning(RESCHEDULE_LONGER, 'reschedule', 'changed the length of the hour', {
          was: previous.endsAt,
          now: outcome.endsAt,
          by: outcome.endsAt - previous.endsAt,
        }),
      );
    }
  }

  return {
    outcome,
    breaches: collected.breaches,
    holes: collected.holes,
    dropped,
    added,
    problems,
  };
}

/** Whether the reschedule changed anything at all. */
export function changedAnything(outcome: RescheduleOutcome): boolean {
  return outcome.dropped.length > 0 || outcome.added.length > 0;
}

/** How much of the hour survived the reschedule, as a fraction. */
export function retained(outcome: RescheduleOutcome, previousCount: number): number {
  if (previousCount === 0) {
    return 1;
  }
  return (previousCount - outcome.dropped.length) / previousCount;
}
