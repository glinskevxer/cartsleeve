/**
 * Holes, and why they happened.
 *
 * A hole is a slot nothing could fill. The scheduler already knows which
 * candidates it tried and which rules rejected each of them, and that raw list
 * is nearly useless to a director: thirty carts each rejected by two or three
 * rules is ninety lines saying nothing.
 *
 * What is useful is the diagnosis. A hole where every candidate failed the same
 * rule is one problem with one fix. A hole where the candidate list was empty
 * before any rule ran is a different problem entirely, and telling them apart is
 * the difference between widening a category and loosening a minimum.
 *
 * The diagnosis is a guess at the dominant cause and it says so. It is right
 * often enough to point at the right file and never treated as authoritative.
 */

import { countBy } from '../util/ordering.js';
import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { CartNumber } from '../util/ids.js';
import type { Hole } from './search.js';

export type HoleCause =
  | 'category empty'
  | 'all restricted'
  | 'one rule'
  | 'no single cause'
  | 'unknown';

export interface Diagnosis {
  readonly cause: HoleCause;
  /** The rule responsible, when one rule is. */
  readonly rule?: string;
  /** How many of the candidates that rule rejected. */
  readonly rejected: number;
  readonly considered: number;
}

/** A rule has to reject this share of the candidates to be called the cause. */
export const DOMINANT_SHARE = 0.8;

export function diagnose(hole: Hole): Diagnosis {
  if (hole.reason === 'no candidates') {
    return { cause: 'category empty', rejected: 0, considered: 0 };
  }
  if (hole.rejections.length === 0) {
    return { cause: 'unknown', rejected: 0, considered: hole.considered };
  }
  const counts = countBy(
    hole.rejections.flatMap((rejection) => rejection.rules),
    (rule) => rule,
  );
  let worstRule: string | undefined;
  let worstCount = 0;
  for (const [rule, count] of counts) {
    if (
      count > worstCount ||
      (count === worstCount && worstRule !== undefined && rule < worstRule)
    ) {
      worstRule = rule;
      worstCount = count;
    }
  }
  if (worstRule === undefined) {
    return { cause: 'unknown', rejected: 0, considered: hole.considered };
  }
  const share = worstCount / hole.rejections.length;
  if (worstRule === 'eligibility' && share >= DOMINANT_SHARE) {
    return {
      cause: 'all restricted',
      rule: worstRule,
      rejected: worstCount,
      considered: hole.considered,
    };
  }
  if (share >= DOMINANT_SHARE) {
    return {
      cause: 'one rule',
      rule: worstRule,
      rejected: worstCount,
      considered: hole.considered,
    };
  }
  return {
    cause: 'no single cause',
    rule: worstRule,
    rejected: worstCount,
    considered: hole.considered,
  };
}

export const HOLE_CODE = codeFor('schedule', 30);

export interface HoleRecord {
  readonly position: number;
  readonly category: string;
  readonly diagnosis: Diagnosis;
}

export function describeCause(diagnosis: Diagnosis): string {
  switch (diagnosis.cause) {
    case 'category empty':
      return 'nothing in the category was eligible here';
    case 'all restricted':
      return `every candidate was restricted or retired here`;
    case 'one rule':
      return `${diagnosis.rule ?? 'a rule'} rejected ${diagnosis.rejected} of ${diagnosis.considered}`;
    case 'no single cause':
      return `no single rule was responsible, the worst was ${diagnosis.rule ?? 'unknown'}`;
    case 'unknown':
      return 'nothing was recorded about why';
  }
}

export function toProblem(record: HoleRecord): Problem {
  const detail: Record<string, string | number> = {
    cause: record.diagnosis.cause,
    considered: record.diagnosis.considered,
    category: record.category,
  };
  if (record.diagnosis.rule !== undefined) {
    detail['rule'] = record.diagnosis.rule;
    detail['rejected'] = record.diagnosis.rejected;
  }
  // A hole in the log is dead air. Only an empty category is merely a warning,
  // because that one is a library decision somebody made on purpose.
  const raise = record.diagnosis.cause === 'category empty' ? warning : error;
  return raise(HOLE_CODE, `slot ${record.position}`, describeCause(record.diagnosis), detail);
}

/** Carts that were tried and rejected everywhere, across a run of holes. */
export function alwaysRejected(holes: readonly Hole[]): CartNumber[] {
  const filled = holes.filter((hole) => hole.rejections.length > 0);
  if (filled.length === 0) {
    return [];
  }
  const counts = countBy(
    filled.flatMap((hole) => hole.rejections.map((rejection) => rejection.cart)),
    (cart) => cart,
  );
  const out: CartNumber[] = [];
  for (const [cart, count] of counts) {
    if (count === filled.length) {
      out.push(cart as CartNumber);
    }
  }
  return out.sort();
}
