/**
 * The breach report.
 *
 * A week of scheduling produces a few hundred breaches on a station with a tight
 * library, and printing them in time order is the same as not printing them. A
 * director has an hour a week for this and needs to spend it on the four things
 * that would remove two hundred of them.
 *
 * So the report leads with the rules, then the carts, and only then the
 * individual breaches. Forty artist separation breaches on one cart is one
 * carding decision. Forty across forty carts in one category is a category that
 * is too small. Those are different problems with different fixes and the
 * individual list distinguishes them not at all.
 */

import { renderFrame } from './frame.js';
import type { Column } from '../util/table.js';
import { percent } from '../util/table.js';
import { compareText } from '../util/ordering.js';
import type { Breach } from '../schedule/breach.js';
import { byCart, byRule, ranked, severityOf, worstRules } from '../schedule/breach.js';
import type { HoleRecord } from '../schedule/hole.js';
import { describeCause } from '../schedule/hole.js';

const RULE_COLUMNS: readonly Column[] = [
  { heading: 'rule', align: 'left', width: 24 },
  { heading: 'count', align: 'right' },
  { heading: 'share', align: 'right' },
];

const CART_COLUMNS: readonly Column[] = [
  { heading: 'cart', align: 'left' },
  { heading: 'count', align: 'right' },
  { heading: 'worst rule', align: 'left', width: 24 },
];

const BREACH_COLUMNS: readonly Column[] = [
  { heading: 'slot', align: 'right' },
  { heading: 'cart', align: 'left' },
  { heading: 'rule', align: 'left', width: 20 },
  { heading: 'why', align: 'left', width: 28 },
];

const HOLE_COLUMNS: readonly Column[] = [
  { heading: 'slot', align: 'right' },
  { heading: 'cat', align: 'left' },
  { heading: 'cause', align: 'left', width: 40 },
];

/** How many individual breaches are worth printing after the summaries. */
export const DETAIL_LIMIT = 25;

/** Carts breaching this often are a carding decision rather than a scheduling one. */
export const REPEAT_THRESHOLD = 3;

export interface BreachReportInput {
  readonly breaches: readonly Breach[];
  readonly holes: readonly HoleRecord[];
  readonly station: string;
  readonly period: string;
  readonly detailLimit?: number;
}

/** Carts breaching often enough to be worth looking at on their own. */
export function repeatOffenders(
  breaches: readonly Breach[],
  threshold = REPEAT_THRESHOLD,
): { cart: string; count: number; worst: string }[] {
  const out: { cart: string; count: number; worst: string }[] = [];
  for (const [cart, list] of byCart(breaches)) {
    if (list.length < threshold) {
      continue;
    }
    const worst = ranked(list)[0];
    out.push({ cart, count: list.length, worst: worst?.rule ?? '' });
  }
  return out.sort((a, b) => b.count - a.count || compareText(a.cart, b.cart));
}

export function renderBreaches(input: BreachReportInput): string[] {
  const limit = input.detailLimit ?? DETAIL_LIMIT;
  const total = input.breaches.length;
  const errors = input.breaches.filter((breach) => severityOf(breach) === 'error').length;
  const worst = ranked(input.breaches).slice(0, limit);

  return renderFrame({
    title: 'BREACHES AND HOLES',
    heading: [
      ['station', input.station],
      ['period', input.period],
    ],
    summary: [
      ['breaches', String(total)],
      ['errors', String(errors)],
      ['holes', String(input.holes.length)],
      ['rules broken', String(byRule(input.breaches).size)],
    ],
    sections: [
      {
        title: 'BY RULE',
        columns: RULE_COLUMNS,
        rows: worstRules(input.breaches).map((each) => [
          each.rule,
          String(each.count),
          percent(each.count, Math.max(1, total)),
        ]),
      },
      {
        title: 'REPEAT OFFENDERS',
        columns: CART_COLUMNS,
        rows: repeatOffenders(input.breaches).map((each) => [
          each.cart,
          String(each.count),
          each.worst,
        ]),
      },
      {
        title: `WORST ${String(Math.min(limit, total))}`,
        columns: BREACH_COLUMNS,
        rows: worst.map((breach) => [
          String(breach.position),
          breach.cart,
          breach.rule,
          breach.message,
        ]),
      },
      {
        title: 'HOLES',
        columns: HOLE_COLUMNS,
        rows: input.holes.map((hole) => [
          String(hole.position),
          hole.category,
          describeCause(hole.diagnosis),
        ]),
      },
    ],
  });
}

/** The one line a director scanning a week of these reads. */
export function breachSummary(input: BreachReportInput): string {
  if (input.breaches.length === 0 && input.holes.length === 0) {
    return `${input.period} clean`;
  }
  const worst = worstRules(input.breaches)[0];
  const parts = [`${input.breaches.length} breaches`, `${input.holes.length} holes`];
  if (worst !== undefined) {
    parts.push(`mostly ${worst.rule}`);
  }
  return `${input.period} ${parts.join(', ')}`;
}
