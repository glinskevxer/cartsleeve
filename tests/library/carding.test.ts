import { beforeEach, describe, expect, it } from 'vitest';
import { cardCart, cardMany, cardingKind, describeCarding } from '../../src/library/carding.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import type { Category } from '../../src/domain/category.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { inCategory, lookup, size } from '../../src/library/library.js';
import { library, resetFixtures } from '../support/fixtures.js';
import { expectErr, expectOk } from '../support/result.js';

const CATEGORIES = new Map<CategoryCode, Category>(
  STANDARD_CATEGORIES.map((input) => {
    const built = expectOk(makeCategory(input));
    return [built.code, built];
  }),
);

const category = (code: string): Category => {
  const found = CATEGORIES.get(code as CategoryCode);
  if (found === undefined) {
    throw new Error(`no fixture category ${code}`);
  }
  return found;
};

const cartNo = (value: string): CartNumber => value as CartNumber;
const code = (value: string): CategoryCode => value as CategoryCode;

beforeEach(() => {
  resetFixtures();
});

describe('cardingKind', () => {
  it('calls a first carding initial', () => {
    expect(cardingKind(undefined, category('A'))).toBe('initial');
  });

  it('reads the direction off the priorities, not the letters', () => {
    expect(cardingKind(category('G'), category('A'))).toBe('promotion');
    expect(cardingKind(category('A'), category('G'))).toBe('demotion');
  });

  it('calls a move between equal priorities lateral', () => {
    const left = expectOk(makeCategory({ code: 'A', name: 'left', priority: 10 }));
    const right = expectOk(makeCategory({ code: 'B', name: 'right', priority: 10 }));
    expect(cardingKind(left, right)).toBe('lateral');
  });

  it('calls a move into a non rotating category a retire', () => {
    expect(cardingKind(category('A'), category('X'))).toBe('retire');
  });

  it('gives the same answer whatever the letters are called', () => {
    const heavy = expectOk(makeCategory({ code: 'P', name: 'heavy', priority: 5 }));
    const light = expectOk(makeCategory({ code: 'Q', name: 'light', priority: 80 }));
    expect(cardingKind(heavy, light)).toBe('demotion');
    expect(cardingKind(light, heavy)).toBe('promotion');
  });
});

describe('cardCart', () => {
  const built = () =>
    library([
      { number: 'M0001', category: 'A' },
      { number: 'M0002', category: 'G' },
    ]);

  it('moves a cart and reports the move', () => {
    const outcome = expectOk(
      cardCart(built(), CATEGORIES, { cart: cartNo('M0001'), to: code('G'), at: 10 }),
    );
    expect(outcome.carding.kind).toBe('demotion');
    expect(outcome.carding.from).toBe('A');
    expect(outcome.carding.to).toBe('G');
    expect(outcome.carding.at).toBe(10);
    expect(inCategory(outcome.library, code('G'))).toHaveLength(2);
  });

  it('leaves the library it was given alone', () => {
    const original = built();
    cardCart(original, CATEGORIES, { cart: cartNo('M0001'), to: code('G'), at: 10 });
    expect(lookup(original, cartNo('M0001'))?.cart.category).toBe('A');
  });

  it('keeps the recording through the move', () => {
    const outcome = expectOk(
      cardCart(built(), CATEGORIES, { cart: cartNo('M0001'), to: code('G'), at: 10 }),
    );
    expect(lookup(outcome.library, cartNo('M0001'))?.recording).toBeDefined();
  });

  it('rejects a cart that is not in the library', () => {
    const problems = expectErr(
      cardCart(built(), CATEGORIES, { cart: cartNo('M9999'), to: code('G'), at: 1 }),
    );
    expect(problems[0]?.code).toBe('LIB-040');
  });

  it('rejects a category nothing defines', () => {
    const problems = expectErr(
      cardCart(built(), CATEGORIES, { cart: cartNo('M0001'), to: code('Z'), at: 1 }),
    );
    expect(problems[0]?.code).toBe('LIB-041');
  });

  it('rejects a move to the category it is already in', () => {
    const problems = expectErr(
      cardCart(built(), CATEGORIES, { cart: cartNo('M0001'), to: code('A'), at: 1 }),
    );
    expect(problems[0]?.code).toBe('LIB-042');
  });

  it('rejects a non music cart being carded into a rotating category', () => {
    const rack = library([{ number: 'J0001', billed: '', category: 'X' }]);
    const problems = expectErr(
      cardCart(rack, CATEGORIES, { cart: cartNo('J0001'), to: code('A'), at: 1 }),
    );
    expect(problems[0]?.code).toBe('LIB-043');
  });

  it('requires a note to retire a music cart', () => {
    const problems = expectErr(
      cardCart(built(), CATEGORIES, { cart: cartNo('M0001'), to: code('X'), at: 1 }),
    );
    expect(problems[0]?.code).toBe('LIB-044');
  });

  it('retires a music cart once the note is given', () => {
    const outcome = expectOk(
      cardCart(built(), CATEGORIES, {
        cart: cartNo('M0001'),
        to: code('X'),
        at: 1,
        note: 'label pulled it',
      }),
    );
    expect(outcome.carding.kind).toBe('retire');
    expect(outcome.carding.note).toBe('label pulled it');
  });
});

describe('cardMany', () => {
  it('applies every good move and reports the bad ones', () => {
    const built = library([
      { number: 'M0001', category: 'A' },
      { number: 'M0002', category: 'A' },
    ]);
    const outcome = cardMany(built, CATEGORIES, [
      { cart: cartNo('M0001'), to: code('G'), at: 1 },
      { cart: cartNo('M9999'), to: code('G'), at: 2 },
      { cart: cartNo('M0002'), to: code('R'), at: 3 },
    ]);
    expect(outcome.cardings).toHaveLength(2);
    expect(outcome.problems.map((p) => p.code)).toEqual(['LIB-040']);
    expect(inCategory(outcome.library, code('A'))).toEqual([]);
    expect(size(outcome.library)).toBe(2);
  });

  it('carries each move forward, so a second move on one cart sees the first', () => {
    const built = library([{ number: 'M0001', category: 'A' }]);
    const outcome = cardMany(built, CATEGORIES, [
      { cart: cartNo('M0001'), to: code('R'), at: 1 },
      { cart: cartNo('M0001'), to: code('G'), at: 2 },
    ]);
    expect(outcome.cardings.map((c) => c.from)).toEqual(['A', 'R']);
    expect(outcome.cardings.map((c) => c.kind)).toEqual(['demotion', 'demotion']);
    expect(lookup(outcome.library, cartNo('M0001'))?.cart.category).toBe('G');
  });

  it('does nothing for an empty request list', () => {
    const built = library([{ number: 'M0001' }]);
    const outcome = cardMany(built, CATEGORIES, []);
    expect(outcome.cardings).toEqual([]);
    expect(outcome.problems).toEqual([]);
    expect(size(outcome.library)).toBe(1);
  });
});

describe('describeCarding', () => {
  it('describes a move between two categories', () => {
    expect(
      describeCarding({
        cart: cartNo('M0001'),
        from: code('A'),
        to: code('G'),
        kind: 'demotion',
        at: 1,
        note: '',
      }),
    ).toBe('M0001 demotion A to G');
  });

  it('says nothing for a first carding with no from', () => {
    expect(
      describeCarding({
        cart: cartNo('M0001'),
        to: code('A'),
        kind: 'initial',
        at: 1,
        note: '',
      }),
    ).toBe('M0001 initial nothing to A');
  });
});
