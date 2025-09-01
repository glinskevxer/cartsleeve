import { describe, expect, it } from 'vitest';
import {
  BREACH_SUMMARY,
  ERROR_TIER,
  breachesFrom,
  byCart,
  byRule,
  ranked,
  severityOf,
  summarise,
  toProblem,
  worstRules,
} from '../../src/schedule/breach.js';
import type { Breach } from '../../src/schedule/breach.js';
import { tenths } from '../../src/util/duration.js';
import type { CartNumber } from '../../src/util/ids.js';

const cart = (value: string): CartNumber => value as CartNumber;

function breach(over: Partial<Breach> = {}): Breach {
  return {
    position: 4,
    at: tenths(2400),
    cart: cart('M0001'),
    rule: 'artist separation',
    tier: 2,
    code: 'RUL-001',
    message: 'too close',
    shortfall: 600,
    detail: { artist: 'DOLLY PARTON' },
    ...over,
  };
}

describe('breachesFrom', () => {
  it('turns each failure into a breach carrying the slot', () => {
    const found = breachesFrom({
      position: 7,
      at: tenths(4200),
      cart: cart('M0009'),
      failures: [
        {
          rule: 'artist separation',
          tier: 2,
          code: 'RUL-001',
          message: 'too close',
          shortfall: 600,
        },
        { rule: 'tempo flow', tier: 5, code: 'RUL-006', message: 'a jump', shortfall: 2 },
      ],
    });
    expect(found).toHaveLength(2);
    expect(found[0]?.position).toBe(7);
    expect(found[0]?.cart).toBe('M0009');
    expect(found[1]?.rule).toBe('tempo flow');
  });

  it('gives a failure with no detail an empty one', () => {
    const found = breachesFrom({
      position: 1,
      at: tenths(0),
      cart: cart('M0001'),
      failures: [{ rule: 'x', tier: 3, code: 'RUL-009', message: 'm', shortfall: 1 }],
    });
    expect(found[0]?.detail).toEqual({});
  });

  it('keeps detail when it is there', () => {
    const found = breachesFrom({
      position: 1,
      at: tenths(0),
      cart: cart('M0001'),
      failures: [
        { rule: 'x', tier: 3, code: 'RUL-009', message: 'm', shortfall: 1, detail: { by: 4 } },
      ],
    });
    expect(found[0]?.detail).toEqual({ by: 4 });
  });

  it('produces nothing from no failures', () => {
    expect(breachesFrom({ position: 1, at: tenths(0), cart: cart('M0001'), failures: [] })).toEqual(
      [],
    );
  });
});

describe('severity', () => {
  it('calls a tight tier an error and a loose one a warning', () => {
    expect(severityOf(breach({ tier: 0 }))).toBe('error');
    expect(severityOf(breach({ tier: ERROR_TIER }))).toBe('error');
    expect(severityOf(breach({ tier: ERROR_TIER + 1 }))).toBe('warning');
    expect(severityOf(breach({ tier: 6 }))).toBe('warning');
  });

  it('turns a breach into a problem carrying the rule and tier', () => {
    const problem = toProblem(breach());
    expect(problem.severity).toBe('warning');
    expect(problem.code).toBe('RUL-001');
    expect(problem.subject).toBe('slot 4 M0001');
    expect(problem.detail?.['rule']).toBe('artist separation');
    expect(problem.detail?.['artist']).toBe('DOLLY PARTON');
  });

  it('turns a tight breach into an error problem', () => {
    expect(toProblem(breach({ tier: 1 })).severity).toBe('error');
  });
});

describe('ranked', () => {
  it('puts the tighter tier first', () => {
    const list = [breach({ tier: 5, position: 1 }), breach({ tier: 1, position: 2 })];
    expect(ranked(list).map((each) => each.tier)).toEqual([1, 5]);
  });

  it('breaks a tier tie on the larger shortfall', () => {
    const list = [breach({ shortfall: 100 }), breach({ shortfall: 900 })];
    expect(ranked(list).map((each) => each.shortfall)).toEqual([900, 100]);
  });

  it('breaks a shortfall tie on the position', () => {
    const list = [breach({ position: 9 }), breach({ position: 2 })];
    expect(ranked(list).map((each) => each.position)).toEqual([2, 9]);
  });

  it('does not reorder the list it was given', () => {
    const list = [breach({ tier: 5 }), breach({ tier: 1 })];
    ranked(list);
    expect(list.map((each) => each.tier)).toEqual([5, 1]);
  });

  it('ranks an empty list to an empty one', () => {
    expect(ranked([])).toEqual([]);
  });
});

describe('grouping', () => {
  const many = () => [
    breach({ rule: 'artist separation', cart: cart('M0001') }),
    breach({ rule: 'artist separation', cart: cart('M0002') }),
    breach({ rule: 'tempo flow', tier: 5, cart: cart('M0001') }),
  ];

  it('groups by rule', () => {
    expect(byRule(many()).get('artist separation')).toHaveLength(2);
    expect(byRule(many()).get('tempo flow')).toHaveLength(1);
  });

  it('groups by cart', () => {
    expect(byCart(many()).get(cart('M0001'))).toHaveLength(2);
  });

  it('ranks the rules by how often they broke', () => {
    expect(worstRules(many())).toEqual([
      { rule: 'artist separation', count: 2 },
      { rule: 'tempo flow', count: 1 },
    ]);
  });

  it('breaks a count tie on the rule name', () => {
    const list = [breach({ rule: 'zebra' }), breach({ rule: 'apple' })];
    expect(worstRules(list).map((each) => each.rule)).toEqual(['apple', 'zebra']);
  });

  it('reports nothing for an empty list', () => {
    expect(worstRules([])).toEqual([]);
    expect(byRule([]).size).toBe(0);
  });
});

describe('summarise', () => {
  it('says nothing when there are no breaches', () => {
    expect(summarise([])).toBeUndefined();
  });

  it('counts the breaches and the errors among them', () => {
    const problem = summarise([breach({ tier: 1 }), breach({ tier: 5 }), breach({ tier: 5 })]);
    expect(problem?.code).toBe(BREACH_SUMMARY);
    expect(problem?.severity).toBe('error');
    expect(problem?.detail?.['total']).toBe(3);
    expect(problem?.detail?.['errors']).toBe(1);
  });

  it('is only a warning when nothing is an error', () => {
    expect(summarise([breach({ tier: 5 })])?.severity).toBe('warning');
  });

  it('names the rule that broke most often', () => {
    const problem = summarise([
      breach({ rule: 'artist separation' }),
      breach({ rule: 'artist separation' }),
      breach({ rule: 'tempo flow', tier: 5 }),
    ]);
    expect(problem?.detail?.['worst']).toBe('artist separation');
  });
});
