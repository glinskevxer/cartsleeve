import { beforeEach, describe, expect, it } from 'vitest';
import {
  HARD_TIER,
  STANDARD_RULES,
  relax,
  relaxedRules,
  rulesByTier,
  standardRuleSet,
  tiersInUse,
} from '../../src/rules/tiers.js';
import { maxTier } from '../../src/rules/rule.js';
import { NO_RESTRICTIONS, makeRestrictionMap } from '../../src/library/restriction.js';
import { NO_WINDOWS } from '../../src/library/window.js';
import { WEEKDAYS, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import { tenths } from '../../src/util/duration.js';
import type { CartNumber } from '../../src/util/ids.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;
const cart = (value: string): CartNumber => value as CartNumber;
const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));

const set = () => standardRuleSet(NO_RESTRICTIONS, NO_WINDOWS);

describe('the standard rule set', () => {
  it('carries every rule plus the eligibility rule', () => {
    expect(set().rules).toHaveLength(STANDARD_RULES.length + 1);
  });

  it('gives every rule a distinct name', () => {
    expect(new Set(set().rules.map((rule) => rule.name)).size).toBe(set().rules.length);
  });

  it('orders the rules by tier', () => {
    const tiers = set().rules.map((rule) => rule.tier);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
  });

  it('puts correctness rules at the hard tier and nothing else', () => {
    const hard = set()
      .rules.filter((rule) => rule.tier === HARD_TIER)
      .map((rule) => rule.name);
    expect(hard).toEqual(['category match', 'eligibility', 'music only']);
  });

  it('uses a contiguous ladder of tiers', () => {
    const tiers = tiersInUse(set());
    expect(tiers[0]).toBe(0);
    for (const [index, tier] of tiers.entries()) {
      expect(tier).toBe(index);
    }
  });

  it('groups the rules by tier', () => {
    const grouped = rulesByTier(set());
    expect(grouped.get(0)).toHaveLength(3);
    expect(grouped.get(maxTier(set()))?.length).toBeGreaterThan(0);
  });

  it('takes extra rules', () => {
    const extra = { name: 'extra', tier: 9, evaluate: () => ({ passed: true }) as const };
    const built = standardRuleSet(NO_RESTRICTIONS, NO_WINDOWS, [extra]);
    expect(maxTier(built)).toBe(9);
  });
});

describe('relaxedRules', () => {
  it('names the rules given up at a tier', () => {
    const given = relaxedRules(set(), 2).map((rule) => rule.name);
    expect(given).toContain('tempo flow');
    expect(given).not.toContain('artist separation');
  });

  it('gives up nothing at the top tier', () => {
    expect(relaxedRules(set(), maxTier(set()))).toEqual([]);
  });

  it('gives up everything above the hard tier at the floor', () => {
    const given = relaxedRules(set(), HARD_TIER);
    expect(given.every((rule) => rule.tier > 0)).toBe(true);
    expect(given).toHaveLength(set().rules.length - 3);
  });
});

describe('relax', () => {
  it('settles at the top tier when nothing objects', () => {
    const outcome = relax(set(), ruleContext());
    expect(outcome.tier).toBe(maxTier(set()));
    expect(outcome.relaxedBy).toBe(0);
    expect(outcome.evaluation.passed).toBe(true);
  });

  it('drops just far enough to clear a single objection', () => {
    const context = ruleContext({
      placed: [
        placed({
          position: 0,
          at: at(0),
          number: 'M0001',
          billed: 'Dolly Parton',
          title: 'Jolene',
          sounds: ['fiddle'],
        }),
      ],
      candidate: {
        number: 'M0009',
        billed: 'Johnny Cash',
        title: 'Ring of Fire',
        sounds: ['violin'],
      },
      slot: { position: 1, at: tenths(at(8)) },
    });
    const outcome = relax(set(), context);
    expect(outcome.tier).toBe(2);
    expect(outcome.relaxedBy).toBeGreaterThan(0);
    expect(outcome.evaluation.passed).toBe(true);
  });

  it('names what it gave up to get there', () => {
    const context = ruleContext({
      placed: [
        placed({
          position: 0,
          at: at(0),
          number: 'M0001',
          billed: 'Dolly Parton',
          title: 'Jolene',
          sounds: ['fiddle'],
        }),
      ],
      candidate: {
        number: 'M0009',
        billed: 'Johnny Cash',
        title: 'Ring of Fire',
        sounds: ['violin'],
      },
      slot: { position: 1, at: tenths(at(8)) },
    });
    const outcome = relax(set(), context);
    const given = relaxedRules(set(), outcome.tier ?? 0).map((rule) => rule.name);
    expect(given).toContain('sound separation');
  });

  it('cannot relax past a tier zero rule and reports no tier', () => {
    const restrictions = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'] }], [AMD]),
    );
    const built = standardRuleSet(restrictions, NO_WINDOWS);
    const context = ruleContext({
      candidate: { number: 'M0001' },
      slot: { cell: cellOf(1, 7) },
    });
    const outcome = relax(built, context);
    expect(outcome.tier).toBeUndefined();
    expect(outcome.evaluation.passed).toBe(false);
    expect(outcome.relaxedBy).toBe(maxTier(built) + 1);
  });

  it('honours a floor above zero and refuses to go below it', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), number: 'M0001', billed: 'Dolly Parton' })],
      candidate: { number: 'M0009', billed: 'Dolly Parton' },
      slot: { position: 1, at: tenths(at(8)) },
    });
    expect(relax(set(), context, 0).tier).toBe(1);
    expect(relax(set(), context, 2).tier).toBeUndefined();
  });

  it('reports the failures at the floor when it never passes', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), number: 'M0001', billed: 'Dolly Parton' })],
      candidate: { number: 'M0009', billed: 'Dolly Parton' },
      slot: { position: 1, at: tenths(at(8)) },
    });
    const outcome = relax(set(), context, 2);
    expect(outcome.evaluation.passed).toBe(false);
    expect(outcome.evaluation.failures.map((each) => each.rule)).toContain('artist separation');
  });

  it('shows the ladder is a policy choice, not a technical one', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), number: 'M0001', billed: 'Dolly Parton' })],
      candidate: { number: 'M0009', billed: 'Dolly Parton' },
      slot: { position: 1, at: tenths(at(8)) },
    });
    // A station that would rather play it than leave a hole gets a placement.
    expect(relax(set(), context, 0).tier).toBeDefined();
    // One that would rather leave the hole gets none.
    expect(relax(set(), context, 2).tier).toBeUndefined();
  });
});
