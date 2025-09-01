/**
 * Breaches.
 *
 * A slot the scheduler filled by relaxing a rule is not an error and it is not a
 * success. It is a decision the machine made on the station's behalf, and the
 * only useful thing to do with it is write it down.
 *
 * The temptation is to throw, or to refuse the placement, and both are wrong.
 * Refusing leaves a hole, and a hole is worse than a breach for every rule above
 * tier one. Throwing means one bad hour stops a week's scheduling, when what the
 * director actually needs is the week plus a list of the forty places it had to
 * compromise.
 *
 * So a breach carries enough to act on: which slot, which rule, what it was
 * measured against, and how far short it fell. That last is what lets the report
 * sort by severity rather than by time, and a director fix the six that matter
 * rather than reading all forty.
 */

import { ascending, groupBy } from '../util/ordering.js';
import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { Tenths } from '../util/duration.js';
import type { CartNumber } from '../util/ids.js';
import type { RuleFailure } from '../rules/rule.js';

export interface Breach {
  readonly position: number;
  readonly at: Tenths;
  readonly cart: CartNumber;
  readonly rule: string;
  readonly tier: number;
  readonly code: string;
  readonly message: string;
  /** How far short the placement fell, in the rule's own units. */
  readonly shortfall: number;
  readonly detail: Readonly<Record<string, string | number>>;
}

export interface BreachInput {
  readonly position: number;
  readonly at: Tenths;
  readonly cart: CartNumber;
  readonly failures: readonly (RuleFailure & { readonly rule: string; readonly tier: number })[];
}

export function breachesFrom(input: BreachInput): Breach[] {
  return input.failures.map((failure) => ({
    position: input.position,
    at: input.at,
    cart: input.cart,
    rule: failure.rule,
    tier: failure.tier,
    code: failure.code,
    message: failure.message,
    shortfall: failure.shortfall,
    detail: failure.detail ?? {},
  }));
}

/**
 * A breach at tier one or below is an error and anything above it a warning.
 * That is the same line the relaxation ladder draws, so the two cannot drift.
 */
export const ERROR_TIER = 1;

export function severityOf(breach: Breach): 'error' | 'warning' {
  return breach.tier <= ERROR_TIER ? 'error' : 'warning';
}

export function toProblem(breach: Breach): Problem {
  const subject = `slot ${breach.position} ${breach.cart}`;
  const detail = { ...breach.detail, rule: breach.rule, tier: breach.tier };
  return severityOf(breach) === 'error'
    ? error(breach.code, subject, breach.message, detail)
    : warning(breach.code, subject, breach.message, detail);
}

/** Worst first, so a director reading the top of the list reads what matters. */
export function bySeverity(a: Breach, b: Breach): number {
  if (a.tier !== b.tier) {
    return ascending(a.tier, b.tier);
  }
  if (a.shortfall !== b.shortfall) {
    return b.shortfall - a.shortfall;
  }
  return ascending(a.position, b.position);
}

export function ranked(breaches: readonly Breach[]): Breach[] {
  return [...breaches].sort(bySeverity);
}

export function byRule(breaches: readonly Breach[]): Map<string, Breach[]> {
  return groupBy(breaches, (breach) => breach.rule);
}

export function byCart(breaches: readonly Breach[]): Map<CartNumber, Breach[]> {
  return groupBy(breaches, (breach) => breach.cart);
}

/**
 * The rules that broke most often. A director acts on this rather than on the
 * individual breaches, because forty artist separation breaches in a week is one
 * library problem and not forty scheduling ones.
 */
export function worstRules(breaches: readonly Breach[]): { rule: string; count: number }[] {
  const counts = [...byRule(breaches)].map(([rule, list]) => ({ rule, count: list.length }));
  return counts.sort((a, b) => b.count - a.count || (a.rule < b.rule ? -1 : 1));
}

export const BREACH_SUMMARY = codeFor('schedule', 20);

export function summarise(breaches: readonly Breach[]): Problem | undefined {
  if (breaches.length === 0) {
    return undefined;
  }
  const errors = breaches.filter((breach) => severityOf(breach) === 'error').length;
  const worst = worstRules(breaches)[0];
  return (errors > 0 ? error : warning)(
    BREACH_SUMMARY,
    'schedule',
    `has ${breaches.length} breaches, ${errors} of them errors`,
    { total: breaches.length, errors, worst: worst?.rule ?? '' },
  );
}
