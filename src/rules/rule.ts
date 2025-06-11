/**
 * The rule protocol.
 *
 * A rule answers one question about one candidate in one slot: may this cart go
 * here. It answers against the schedule as it stands, not against the library,
 * which is what makes the rules interact. Filling slot four changes the answer
 * every later rule gives for slots five onward, so the order the scheduler tries
 * candidates in decides which rule is the one that says no.
 *
 * Rules never throw and never mutate. A rejection is a value carrying enough
 * detail to print on a breach report, including how far off it was, because the
 * relaxation pass needs to know whether a placement missed by two minutes or by
 * forty.
 */

import type { Station } from '../domain/station.js';
import type { Category } from '../domain/category.js';
import type { CartNumber, CategoryCode } from '../util/ids.js';
import type { Tenths } from '../util/duration.js';
import type { WeekCell } from '../domain/daypart.js';
import type { BroadcastDay } from '../util/time.js';
import type { LibraryEntry } from '../library/library.js';
import type { SoundIndex } from '../library/sounds.js';
import type { EraMap } from '../library/era.js';

/** One item already placed in the log, as the rules need to see it. */
export interface Placed {
  readonly cart: CartNumber;
  readonly entry: LibraryEntry;
  /** Position in the day's log, so two slots can be ordered. */
  readonly position: number;
  /** When it starts, in tenths from the beginning of the broadcast day. */
  readonly at: Tenths;
  readonly category: CategoryCode;
  readonly cell: WeekCell;
}

/**
 * What a rule may ask about the log so far. Deliberately narrow: a rule that
 * could see the whole scheduler could depend on the order candidates are tried
 * in, and then a rerun would not reproduce.
 */
export interface ScheduleReader {
  /** Everything placed before this point, nearest first. */
  before(position: number): readonly Placed[];
  /** Everything placed after this point, nearest first. Empty on a forward pass. */
  after(position: number): readonly Placed[];
  /** Placed items within a wall clock distance of the given time. */
  within(at: Tenths, distance: Tenths): readonly Placed[];
  /** What is directly before this position, if anything. */
  previous(position: number): Placed | undefined;
  readonly count: number;
}

/** The slot a candidate is being considered for. */
export interface Slot {
  readonly position: number;
  readonly at: Tenths;
  readonly category: CategoryCode;
  readonly cell: WeekCell;
  readonly day: BroadcastDay;
  /** Whether this is the first or last music element of its hour. */
  readonly opensHour: boolean;
  readonly closesHour: boolean;
}

export interface RuleContext {
  readonly station: Station;
  readonly categories: ReadonlyMap<CategoryCode, Category>;
  readonly sounds: SoundIndex;
  readonly eras: EraMap;
  readonly schedule: ScheduleReader;
  readonly slot: Slot;
  readonly candidate: LibraryEntry;
}

export interface RuleFailure {
  readonly code: string;
  readonly message: string;
  /**
   * How far short the placement fell, in whatever unit the rule measures. Zero
   * means it only just failed. Used to rank breaches, never to decide them.
   */
  readonly shortfall: number;
  readonly detail?: Readonly<Record<string, string | number>>;
}

export type RuleVerdict =
  | { readonly passed: true }
  | { readonly passed: false; readonly failure: RuleFailure };

export const PASSED: RuleVerdict = { passed: true };

export function rejected(
  code: string,
  message: string,
  shortfall: number,
  detail?: Readonly<Record<string, string | number>>,
): RuleVerdict {
  return {
    passed: false,
    failure:
      detail === undefined ? { code, message, shortfall } : { code, message, shortfall, detail },
  };
}

/**
 * Tiers are the relaxation order. The scheduler tries to satisfy every rule; if
 * nothing fits it drops the highest tier and tries again, and so on down. Tier 0
 * is never dropped, so a rule at tier 0 is a hard constraint.
 */
export interface Rule {
  readonly name: string;
  readonly tier: number;
  evaluate(context: RuleContext): RuleVerdict;
}

export interface RuleSet {
  readonly rules: readonly Rule[];
}

export function makeRuleSet(rules: readonly Rule[]): RuleSet {
  return { rules: [...rules].sort((a, b) => a.tier - b.tier || (a.name < b.name ? -1 : 1)) };
}

export function rulesAtOrBelow(set: RuleSet, tier: number): Rule[] {
  return set.rules.filter((rule) => rule.tier <= tier);
}

export function maxTier(set: RuleSet): number {
  return set.rules.reduce((max, rule) => Math.max(max, rule.tier), 0);
}

export interface Evaluation {
  readonly passed: boolean;
  readonly failures: readonly (RuleFailure & { readonly rule: string; readonly tier: number })[];
}

/**
 * Run every rule at or below a tier. All of them run even after one fails,
 * because a breach report that names only the first rule to object sends a
 * director to fix one thing and hit the next.
 */
export function evaluate(set: RuleSet, tier: number, context: RuleContext): Evaluation {
  const failures: (RuleFailure & { rule: string; tier: number })[] = [];
  for (const rule of rulesAtOrBelow(set, tier)) {
    const verdict = rule.evaluate(context);
    if (!verdict.passed) {
      failures.push({ ...verdict.failure, rule: rule.name, tier: rule.tier });
    }
  }
  return { passed: failures.length === 0, failures };
}

/** Stop at the first failure. Used on the hot path once a tier is settled. */
export function evaluateFast(set: RuleSet, tier: number, context: RuleContext): boolean {
  for (const rule of rulesAtOrBelow(set, tier)) {
    if (!rule.evaluate(context).passed) {
      return false;
    }
  }
  return true;
}
