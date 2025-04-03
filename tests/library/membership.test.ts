import { describe, expect, it } from 'vitest';
import {
  EMPTY_HISTORY,
  categoryAt,
  churn,
  makeHistory,
  membersAt,
  moveCount,
  spansFor,
  tenureAt,
  withCarding,
  withCardings,
} from '../../src/library/membership.js';
import type { Carding } from '../../src/library/carding.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';

const cart = (value: string): CartNumber => value as CartNumber;
const code = (value: string): CategoryCode => value as CategoryCode;

function carding(number: string, to: string, at: number, from?: string): Carding {
  return {
    cart: cart(number),
    ...(from === undefined ? {} : { from: code(from) }),
    to: code(to),
    kind: from === undefined ? 'initial' : 'demotion',
    at,
    note: '',
  };
}

const HISTORY = makeHistory([
  carding('M0001', 'A', 100),
  carding('M0001', 'R', 200, 'A'),
  carding('M0001', 'G', 300, 'R'),
  carding('M0002', 'A', 150),
  carding('M0003', 'G', 120),
]);

describe('makeHistory', () => {
  it('orders the cardings by when they happened', () => {
    const history = makeHistory([carding('M0001', 'G', 300), carding('M0001', 'A', 100)]);
    expect(history.cardings.map((c) => c.at)).toEqual([100, 300]);
  });

  it('groups by cart', () => {
    expect(HISTORY.byCart.get(cart('M0001'))).toHaveLength(3);
    expect(HISTORY.byCart.get(cart('M0002'))).toHaveLength(1);
    expect(HISTORY.byCart.get(cart('M9999'))).toBeUndefined();
  });

  it('handles an empty history', () => {
    expect(EMPTY_HISTORY.cardings).toEqual([]);
    expect(makeHistory([]).byCart.size).toBe(0);
  });
});

describe('spansFor', () => {
  it('closes each span where the next one opens', () => {
    expect(spansFor(HISTORY, cart('M0001'))).toEqual([
      { cart: 'M0001', category: 'A', from: 100, to: 200 },
      { cart: 'M0001', category: 'R', from: 200, to: 300 },
      { cart: 'M0001', category: 'G', from: 300 },
    ]);
  });

  it('leaves the current span open', () => {
    const spans = spansFor(HISTORY, cart('M0002'));
    expect(spans).toHaveLength(1);
    expect('to' in (spans[0] ?? {})).toBe(false);
  });

  it('gives nothing for a cart with no history', () => {
    expect(spansFor(HISTORY, cart('M9999'))).toEqual([]);
  });
});

describe('categoryAt', () => {
  it('answers with where the cart was at that moment', () => {
    expect(categoryAt(HISTORY, cart('M0001'), 150)).toBe('A');
    expect(categoryAt(HISTORY, cart('M0001'), 250)).toBe('R');
    expect(categoryAt(HISTORY, cart('M0001'), 999)).toBe('G');
  });

  it('takes the new category from the moment of the move itself', () => {
    expect(categoryAt(HISTORY, cart('M0001'), 200)).toBe('R');
    expect(categoryAt(HISTORY, cart('M0001'), 199)).toBe('A');
  });

  it('says nothing before the first carding rather than guessing', () => {
    expect(categoryAt(HISTORY, cart('M0001'), 99)).toBeUndefined();
    expect(categoryAt(HISTORY, cart('M9999'), 500)).toBeUndefined();
  });
});

describe('membersAt', () => {
  it('lists the carts in a category at a moment', () => {
    expect(membersAt(HISTORY, code('A'), 160)).toEqual(['M0001', 'M0002']);
    expect(membersAt(HISTORY, code('A'), 250)).toEqual(['M0002']);
  });

  it('follows a cart out of a category as it is carded down', () => {
    expect(membersAt(HISTORY, code('G'), 150)).toEqual(['M0003']);
    expect(membersAt(HISTORY, code('G'), 350)).toEqual(['M0001', 'M0003']);
  });

  it('is empty before anything was carded', () => {
    expect(membersAt(HISTORY, code('A'), 50)).toEqual([]);
  });

  it('shows why counting every play against the current category is wrong', () => {
    expect(categoryAt(HISTORY, cart('M0001'), 150)).toBe('A');
    expect(categoryAt(HISTORY, cart('M0001'), 350)).toBe('G');
    expect(membersAt(HISTORY, code('G'), 150)).not.toContain('M0001');
  });
});

describe('tenure and churn', () => {
  it('measures how long the cart has been where it is', () => {
    expect(tenureAt(HISTORY, cart('M0001'), 350)).toBe(50);
    expect(tenureAt(HISTORY, cart('M0001'), 250)).toBe(50);
    expect(tenureAt(HISTORY, cart('M0002'), 350)).toBe(200);
  });

  it('says nothing about tenure before the first carding', () => {
    expect(tenureAt(HISTORY, cart('M0001'), 50)).toBeUndefined();
    expect(tenureAt(HISTORY, cart('M9999'), 500)).toBeUndefined();
  });

  it('counts moves as one fewer than the cardings', () => {
    expect(moveCount(HISTORY, cart('M0001'))).toBe(2);
    expect(moveCount(HISTORY, cart('M0002'))).toBe(0);
    expect(moveCount(HISTORY, cart('M9999'))).toBe(0);
  });

  it('finds the carts that keep being moved', () => {
    expect(churn(HISTORY, 2)).toEqual(['M0001']);
    expect(churn(HISTORY, 3)).toEqual([]);
    expect(churn(HISTORY, 0)).toHaveLength(3);
  });
});

describe('extending a history', () => {
  it('adds one carding and keeps the order', () => {
    const grown = withCarding(HISTORY, carding('M0002', 'R', 175, 'A'));
    expect(categoryAt(grown, cart('M0002'), 180)).toBe('R');
    expect(grown.cardings.map((c) => c.at)).toEqual([100, 120, 150, 175, 200, 300]);
  });

  it('adds several and leaves the original alone', () => {
    const grown = withCardings(HISTORY, [carding('M0004', 'A', 400), carding('M0005', 'B', 410)]);
    expect(grown.byCart.size).toBe(5);
    expect(HISTORY.byCart.size).toBe(3);
  });

  it('sorts a carding that arrives out of order into place', () => {
    const grown = withCarding(HISTORY, carding('M0001', 'B', 50));
    expect(categoryAt(grown, cart('M0001'), 60)).toBe('B');
    expect(categoryAt(grown, cart('M0001'), 150)).toBe('A');
  });
});
