/**
 * Drift against the clock.
 *
 * A clock element carries a target time, and the element will not land on it.
 * Music does not come in convenient lengths, so a target is a goal that the
 * actual hour drifts around. How much drift is tolerable depends entirely on
 * what the element is.
 *
 * News at the top of the hour is a network feed that starts whether the station
 * is ready or not, so it has a budget of a few seconds. A stopset can slide half
 * a minute because the traffic is local. A music element has no budget at all,
 * because its target only exists to shape the hour.
 *
 * This is where the segue arithmetic turns into a compliance question. Two
 * seconds of extra overlap on element two is invisible; the same two seconds
 * accumulated over eight elements is a news feed joined in progress.
 */

import { tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { ClockElement } from './clock.js';

export interface DriftBudget {
  readonly news: Tenths;
  readonly stopset: Tenths;
  readonly fixed: Tenths;
  /** Undefined means the element is not held to its target at all. */
  readonly music?: Tenths;
}

export const DEFAULT_DRIFT_BUDGET: DriftBudget = {
  news: tenths(50),
  stopset: tenths(300),
  fixed: tenths(150),
};

export function budgetFor(element: ClockElement, budget: DriftBudget): Tenths | undefined {
  switch (element.kind) {
    case 'news':
      return budget.news;
    case 'stopset':
      return budget.stopset;
    case 'fixed':
      return budget.fixed;
    case 'music':
      return budget.music;
  }
}

export interface Drift {
  readonly position: number;
  readonly target: Tenths;
  readonly actual: Tenths;
  /** Positive means late, negative means early. */
  readonly drift: Tenths;
  readonly budget?: Tenths;
  readonly breached: boolean;
}

const DRF = (n: number): string => codeFor('schedule', n);

export function measureDrift(
  elements: readonly ClockElement[],
  actuals: readonly Tenths[],
  budget: DriftBudget = DEFAULT_DRIFT_BUDGET,
): Drift[] {
  const out: Drift[] = [];
  for (const [index, element] of elements.entries()) {
    const actual = actuals[index];
    if (actual === undefined) {
      continue;
    }
    const allowed = budgetFor(element, budget);
    const amount = tenths(actual - element.target);
    out.push({
      position: element.position,
      target: element.target,
      actual,
      drift: amount,
      ...(allowed === undefined ? {} : { budget: allowed }),
      breached: allowed !== undefined && Math.abs(amount) > allowed,
    });
  }
  return out;
}

/**
 * The worst drift in the hour, ignoring elements with no budget. Used as the
 * single number on an hour summary, because a director scanning a day wants one
 * column, not one per element.
 */
export function worstDrift(drifts: readonly Drift[]): Drift | undefined {
  let worst: Drift | undefined;
  for (const item of drifts) {
    if (item.budget === undefined) {
      continue;
    }
    if (worst === undefined || Math.abs(item.drift) > Math.abs(worst.drift)) {
      worst = item;
    }
  }
  return worst;
}

export function driftProblems(
  elements: readonly ClockElement[],
  drifts: readonly Drift[],
): Problem[] {
  const problems: Problem[] = [];
  const byPosition = new Map(elements.map((element) => [element.position, element]));
  for (const item of drifts) {
    if (!item.breached) {
      continue;
    }
    const element = byPosition.get(item.position);
    const late = item.drift > 0;
    const detail = { drift: item.drift, budget: item.budget ?? 0 };
    if (element?.kind === 'news') {
      problems.push(
        error(
          DRF(10),
          `element ${item.position}`,
          late ? 'joins the news in progress' : 'reaches the news early',
          detail,
        ),
      );
    } else {
      problems.push(
        warning(
          DRF(11),
          `element ${item.position}`,
          late ? 'runs past its target' : 'reaches its target early',
          detail,
        ),
      );
    }
  }
  return problems;
}

/** How far the hour as a whole runs over or under sixty minutes. */
export function hourDrift(length: Tenths, hourLength: Tenths): Tenths {
  return tenths(length - hourLength);
}
