/**
 * Songs that were scheduled and never aired.
 *
 * The commonest deviation and the one with the most causes, which is why the
 * reason matters more than the count. Forty drops in a week is a catastrophe if
 * they are automation errors and a normal Tuesday if they are the overnight
 * operator dumping records to make the network news.
 *
 * The reason is inferred from the evidence rather than asked for, because
 * nobody fills in a form at 03:00. The inference is stated as a guess with the
 * evidence behind it, so a director can disagree with it.
 */

import { codeFor, error, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { groupBy } from '../util/ordering.js';
import type { CartNumber } from '../util/ids.js';
import type { AutomationEvent, EventStream } from './event.js';
import { eventsOfKind } from './event.js';
import type { Rebuild } from './rebuild.js';

const DRP = (n: number): string => codeFor('aired', n);

export const DROPPED = DRP(20);

export type DropReason = 'skipped by operator' | 'automation error' | 'never reached' | 'unknown';

export interface Drop {
  readonly cart: CartNumber;
  readonly position: number;
  readonly reason: DropReason;
  /** What the inference was based on, so a director can disagree with it. */
  readonly evidence: string;
}

/** How severe a drop is depends entirely on why it happened. */
export function severityOf(reason: DropReason): 'info' | 'warning' | 'error' {
  switch (reason) {
    case 'skipped by operator':
      return 'info';
    case 'never reached':
      return 'warning';
    case 'automation error':
      return 'error';
    case 'unknown':
      return 'warning';
  }
}

export interface DropInput {
  /** What the log said should air, by position. */
  readonly scheduled: readonly { position: number; cart: CartNumber }[];
  readonly stream: EventStream;
  readonly rebuild: Rebuild;
}

function firstMatching(
  events: readonly AutomationEvent[],
  cart: CartNumber,
): AutomationEvent | undefined {
  return events.find((event) => event.cart === cart);
}

/**
 * Work out which scheduled carts never aired, and why.
 *
 * A cart with a skip event was dumped on purpose. One with an error event failed
 * to play. One with no event at all was never reached, which happens when the
 * hour ran out of time before the log ran out of records.
 */
export function findDrops(input: DropInput): Drop[] {
  const aired = new Set(input.rebuild.airings.map((airing) => airing.cart));
  const skips = eventsOfKind(input.stream, 'skip');
  const errors = eventsOfKind(input.stream, 'error');
  const drops: Drop[] = [];
  for (const item of input.scheduled) {
    if (aired.has(item.cart)) {
      continue;
    }
    const skip = firstMatching(skips, item.cart);
    if (skip !== undefined) {
      drops.push({
        cart: item.cart,
        position: item.position,
        reason: 'skipped by operator',
        evidence: skip.note.length > 0 ? skip.note : 'a skip event',
      });
      continue;
    }
    const failed = firstMatching(errors, item.cart);
    if (failed !== undefined) {
      drops.push({
        cart: item.cart,
        position: item.position,
        reason: 'automation error',
        evidence: failed.note.length > 0 ? failed.note : 'an error event',
      });
      continue;
    }
    const anything = input.stream.byCart.get(item.cart);
    drops.push({
      cart: item.cart,
      position: item.position,
      reason: anything === undefined ? 'never reached' : 'unknown',
      evidence: anything === undefined ? 'no event at all' : 'events but no airing',
    });
  }
  return drops;
}

export function toProblem(drop: Drop): Problem {
  const detail = { reason: drop.reason, evidence: drop.evidence, cart: drop.cart };
  const subject = `slot ${drop.position}`;
  const message = `${drop.cart} was scheduled and did not air: ${drop.reason}`;
  switch (severityOf(drop.reason)) {
    case 'info':
      return info(DROPPED, subject, message, detail);
    case 'warning':
      return warning(DROPPED, subject, message, detail);
    case 'error':
      return error(DROPPED, subject, message, detail);
  }
}

export function byReason(drops: readonly Drop[]): Map<DropReason, Drop[]> {
  return groupBy(drops, (drop) => drop.reason);
}

/** The drops worth acting on, which is anything not a deliberate skip. */
export function actionable(drops: readonly Drop[]): Drop[] {
  return drops.filter((drop) => severityOf(drop.reason) !== 'info');
}
