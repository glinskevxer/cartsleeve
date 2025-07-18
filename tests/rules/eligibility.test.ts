import { beforeEach, describe, expect, it } from 'vitest';
import {
  NOT_LIVE,
  RESTRICTED_HERE,
  categoryMatch,
  isEligible,
  makeEligibilityRule,
  musicOnly,
} from '../../src/rules/eligibility.js';
import { WEEKDAYS, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import { NO_RESTRICTIONS, makeRestrictionMap } from '../../src/library/restriction.js';
import { CHRISTMAS, NO_WINDOWS, makeWindow, makeWindowMap } from '../../src/library/window.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { eligibleIn } from '../../src/rotation/order.js';
import { NO_POSITIONS } from '../../src/rotation/position.js';
import { makeLibrary } from '../../src/library/library.js';
import { ruleContext } from '../support/context.js';
import { entry, resetFixtures } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));
const MORNING = cellOf(1, 7);
const MIDDAY = cellOf(1, 12);
const SUMMER = { year: 2025, month: 6, day: 10 };
const DECEMBER = { year: 2025, month: 12, day: 10 };

const denying = (number: string) =>
  expectOk(makeRestrictionMap([{ cart: cart(number), mode: 'deny', dayparts: ['AMD'] }], [AMD]));

const seasonal = (number: string) =>
  makeWindowMap([expectOk(makeWindow(cart(number), undefined, CHRISTMAS))]);

describe('the eligibility rule', () => {
  it('passes a cart nothing constrains', () => {
    const rule = makeEligibilityRule(NO_RESTRICTIONS, NO_WINDOWS);
    expect(rule.evaluate(ruleContext({ candidate: { number: 'M0001' } })).passed).toBe(true);
  });

  it('rejects a cart outside its season', () => {
    const rule = makeEligibilityRule(NO_RESTRICTIONS, seasonal('M0001'));
    const verdict = rule.evaluate(
      ruleContext({ candidate: { number: 'M0001' }, slot: { day: SUMMER } }),
    );
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(NOT_LIVE);
    }
  });

  it('accepts the same cart inside its season', () => {
    const rule = makeEligibilityRule(NO_RESTRICTIONS, seasonal('M0001'));
    const context = ruleContext({ candidate: { number: 'M0001' }, slot: { day: DECEMBER } });
    expect(rule.evaluate(context).passed).toBe(true);
  });

  it('rejects a cart restricted out of this hour', () => {
    const rule = makeEligibilityRule(denying('M0001'), NO_WINDOWS);
    const verdict = rule.evaluate(
      ruleContext({ candidate: { number: 'M0001' }, slot: { cell: MORNING } }),
    );
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(RESTRICTED_HERE);
      expect(verdict.failure.detail?.['cell']).toBe(MORNING);
    }
  });

  it('accepts the same cart at another hour', () => {
    const rule = makeEligibilityRule(denying('M0001'), NO_WINDOWS);
    const context = ruleContext({ candidate: { number: 'M0001' }, slot: { cell: MIDDAY } });
    expect(rule.evaluate(context).passed).toBe(true);
  });

  it('reports the season before the restriction when both would fire', () => {
    const rule = makeEligibilityRule(denying('M0001'), seasonal('M0001'));
    const verdict = rule.evaluate(
      ruleContext({ candidate: { number: 'M0001' }, slot: { cell: MORNING, day: SUMMER } }),
    );
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(NOT_LIVE);
    }
  });

  it('sits at tier zero so the relaxation pass can never drop it', () => {
    expect(makeEligibilityRule(NO_RESTRICTIONS, NO_WINDOWS).tier).toBe(0);
  });

  it('answers directly as well as through a verdict', () => {
    const context = ruleContext({ candidate: { number: 'M0001' }, slot: { cell: MORNING } });
    expect(isEligible(denying('M0001'), NO_WINDOWS, context)).toBe(false);
    expect(isEligible(NO_RESTRICTIONS, NO_WINDOWS, context)).toBe(true);
  });
});

describe('the rule and the rotation filter agree', () => {
  /** Run both paths over the same two carts and compare what survives. */
  function compare(
    restrictions: ReturnType<typeof denying>,
    windows: ReturnType<typeof seasonal>,
    cell: number,
    day: { year: number; month: number; day: number },
  ): { filtered: string[]; ruled: string[] } {
    const entries = [
      entry({ number: 'M0001', category: 'A' }),
      entry({ number: 'M0002', category: 'A' }),
    ];
    const filtered = eligibleIn(
      { library: makeLibrary(entries), positions: NO_POSITIONS, restrictions, windows, day, cell },
      'A' as CategoryCode,
    ).eligible.map((each) => each.cart.number);
    const rule = makeEligibilityRule(restrictions, windows);
    const ruled = entries
      .filter((each) => {
        const context = ruleContext({
          candidate: each,
          slot: { cell, day, category: 'A' as CategoryCode },
        });
        return rule.evaluate(context).passed;
      })
      .map((each) => each.cart.number);
    return { filtered, ruled };
  }

  it('agree when nothing is constrained', () => {
    const { filtered, ruled } = compare(NO_RESTRICTIONS, NO_WINDOWS, MORNING, SUMMER);
    expect(ruled).toEqual(filtered);
    expect(filtered).toHaveLength(2);
  });

  it('agree on a restriction', () => {
    const { filtered, ruled } = compare(denying('M0001'), NO_WINDOWS, MORNING, SUMMER);
    expect(ruled).toEqual(filtered);
    expect(filtered).toEqual(['M0002']);
  });

  it('agree on a season', () => {
    const { filtered, ruled } = compare(NO_RESTRICTIONS, seasonal('M0001'), MORNING, SUMMER);
    expect(ruled).toEqual(filtered);
    expect(filtered).toEqual(['M0002']);
  });

  it('agree once the constraint no longer applies', () => {
    const { filtered, ruled } = compare(denying('M0001'), NO_WINDOWS, MIDDAY, SUMMER);
    expect(ruled).toEqual(filtered);
    expect(filtered).toHaveLength(2);
  });
});

describe('categoryMatch', () => {
  it('passes a cart carded into the slot category', () => {
    const context = ruleContext({
      candidate: { category: 'A' },
      slot: { category: 'A' as CategoryCode },
    });
    expect(categoryMatch.evaluate(context).passed).toBe(true);
  });

  it('rejects a cart from another category and names both', () => {
    const context = ruleContext({
      candidate: { category: 'G' },
      slot: { category: 'A' as CategoryCode },
    });
    const verdict = categoryMatch.evaluate(context);
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.detail?.['carded']).toBe('G');
      expect(verdict.failure.detail?.['wanted']).toBe('A');
    }
  });

  it('sits at tier zero', () => {
    expect(categoryMatch.tier).toBe(0);
  });
});

describe('musicOnly', () => {
  it('passes a music cart', () => {
    expect(musicOnly.evaluate(ruleContext({ candidate: { number: 'M0001' } })).passed).toBe(true);
  });

  it('rejects anything else', () => {
    const context = ruleContext({
      candidate: { number: 'J0001', billed: '', category: 'X' },
      slot: { category: 'X' as CategoryCode },
    });
    expect(musicOnly.evaluate(context).passed).toBe(false);
  });
});
