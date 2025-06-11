import { beforeEach, describe, expect, it } from 'vitest';
import {
  PASSED,
  evaluate,
  evaluateFast,
  makeRuleSet,
  maxTier,
  rejected,
  rulesAtOrBelow,
} from '../../src/rules/rule.js';
import type { Rule, RuleContext, ScheduleReader } from '../../src/rules/rule.js';
import { EMPTY_SOUND_INDEX } from '../../src/library/sounds.js';
import { COUNTRY_BANDS, makeEraMap } from '../../src/library/era.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import type { Category } from '../../src/domain/category.js';
import type { CategoryCode } from '../../src/util/ids.js';
import { tenths } from '../../src/util/duration.js';
import { cellOf } from '../../src/domain/daypart.js';
import { entry, resetFixtures, station } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

const EMPTY_READER: ScheduleReader = {
  before: () => [],
  after: () => [],
  within: () => [],
  previous: () => undefined,
  count: 0,
};

const CATEGORIES = new Map<CategoryCode, Category>(
  STANDARD_CATEGORIES.map((input) => {
    const built = expectOk(makeCategory(input));
    return [built.code, built];
  }),
);

function context(): RuleContext {
  return {
    station: station(),
    categories: CATEGORIES,
    sounds: EMPTY_SOUND_INDEX,
    eras: expectOk(makeEraMap(COUNTRY_BANDS)),
    schedule: EMPTY_READER,
    slot: {
      position: 4,
      at: tenths(2400),
      category: 'A' as CategoryCode,
      cell: cellOf(1, 7),
      day: { year: 2025, month: 6, day: 10 },
      opensHour: false,
      closesHour: false,
    },
    candidate: entry({ number: 'M0001' }),
  };
}

const always = (name: string, tier: number): Rule => ({
  name,
  tier,
  evaluate: () => PASSED,
});

const never = (name: string, tier: number, shortfall = 5): Rule => ({
  name,
  tier,
  evaluate: () => rejected(`RUL-${name}`, `${name} says no`, shortfall, { by: shortfall }),
});

beforeEach(() => {
  resetFixtures();
});

describe('rejected', () => {
  it('carries the code, the message and the shortfall', () => {
    const verdict = rejected('RUL-001', 'too close', 12);
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe('RUL-001');
      expect(verdict.failure.shortfall).toBe(12);
      expect('detail' in verdict.failure).toBe(false);
    }
  });

  it('keeps detail when it is given', () => {
    const verdict = rejected('RUL-001', 'too close', 12, { minutes: 38 });
    if (!verdict.passed) {
      expect(verdict.failure.detail).toEqual({ minutes: 38 });
    }
  });

  it('has a shared passed verdict', () => {
    expect(PASSED.passed).toBe(true);
  });
});

describe('makeRuleSet', () => {
  it('orders by tier and then by name', () => {
    const set = makeRuleSet([always('zebra', 1), always('apple', 2), always('bravo', 1)]);
    expect(set.rules.map((rule) => rule.name)).toEqual(['bravo', 'zebra', 'apple']);
  });

  it('does not reorder the list it was given', () => {
    const rules = [always('zebra', 1), always('apple', 0)];
    makeRuleSet(rules);
    expect(rules.map((rule) => rule.name)).toEqual(['zebra', 'apple']);
  });

  it('reports the highest tier', () => {
    expect(maxTier(makeRuleSet([always('a', 0), always('b', 3)]))).toBe(3);
    expect(maxTier(makeRuleSet([]))).toBe(0);
  });

  it('selects the rules at or below a tier', () => {
    const set = makeRuleSet([always('a', 0), always('b', 1), always('c', 2)]);
    expect(rulesAtOrBelow(set, 1).map((rule) => rule.name)).toEqual(['a', 'b']);
    expect(rulesAtOrBelow(set, 0).map((rule) => rule.name)).toEqual(['a']);
    expect(rulesAtOrBelow(set, 9)).toHaveLength(3);
  });
});

describe('evaluate', () => {
  it('passes when every rule passes', () => {
    const outcome = evaluate(makeRuleSet([always('a', 0), always('b', 1)]), 1, context());
    expect(outcome.passed).toBe(true);
    expect(outcome.failures).toEqual([]);
  });

  it('collects every failure rather than stopping at the first', () => {
    const set = makeRuleSet([never('a', 0), always('b', 0), never('c', 1)]);
    const outcome = evaluate(set, 1, context());
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.map((failure) => failure.rule)).toEqual(['a', 'c']);
  });

  it('names the rule and its tier on each failure', () => {
    const outcome = evaluate(makeRuleSet([never('a', 2)]), 2, context());
    expect(outcome.failures[0]?.rule).toBe('a');
    expect(outcome.failures[0]?.tier).toBe(2);
    expect(outcome.failures[0]?.detail).toEqual({ by: 5 });
  });

  it('ignores a rule above the tier being run', () => {
    const set = makeRuleSet([always('a', 0), never('b', 2)]);
    expect(evaluate(set, 1, context()).passed).toBe(true);
    expect(evaluate(set, 2, context()).passed).toBe(false);
  });

  it('shows relaxation dropping the rule that objected', () => {
    const set = makeRuleSet([always('hard', 0), never('soft', 1)]);
    expect(evaluate(set, 1, context()).passed).toBe(false);
    expect(evaluate(set, 0, context()).passed).toBe(true);
  });

  it('never relaxes a tier zero rule away', () => {
    const set = makeRuleSet([never('hard', 0)]);
    expect(evaluate(set, 0, context()).passed).toBe(false);
  });

  it('passes an empty rule set', () => {
    expect(evaluate(makeRuleSet([]), 0, context()).passed).toBe(true);
  });
});

describe('evaluateFast', () => {
  it('agrees with the full evaluation on the verdict', () => {
    const cases: Rule[][] = [
      [always('a', 0)],
      [never('a', 0)],
      [always('a', 0), never('b', 1)],
      [],
    ];
    for (const rules of cases) {
      const set = makeRuleSet(rules);
      expect(evaluateFast(set, 1, context())).toBe(evaluate(set, 1, context()).passed);
    }
  });

  it('stops at the first failure', () => {
    let ran = 0;
    const counting = (name: string, verdict: boolean): Rule => ({
      name,
      tier: 0,
      evaluate: () => {
        ran += 1;
        return verdict ? PASSED : rejected('X', 'no', 0);
      },
    });
    evaluateFast(makeRuleSet([counting('a', false), counting('b', true)]), 0, context());
    expect(ran).toBe(1);
  });
});
