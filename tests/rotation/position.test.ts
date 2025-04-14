import { describe, expect, it } from 'vitest';
import {
  NO_POSITIONS,
  isDue,
  makePositionIndex,
  playsIn,
  restCycles,
  restOrder,
  restPlays,
  withPlay,
} from '../../src/rotation/position.js';
import type { CategorisedPlay } from '../../src/rotation/position.js';
import { makePlayHistory, restHours } from '../../src/rotation/rest.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { HOUR_MS } from '../../src/util/time.js';

const cart = (value: string): CartNumber => value as CartNumber;
const code = (value: string): CategoryCode => value as CategoryCode;
const NOW = 1_000 * HOUR_MS;

function play(number: string, category: string, hoursAgo: number): CategorisedPlay {
  return { cart: cart(number), category: code(category), at: NOW - hoursAgo * HOUR_MS, cell: 0 };
}

/** Three plays of A after M0001, so M0001 has three plays of rest. */
const INDEX = makePositionIndex([
  play('M0001', 'A', 10),
  play('M0002', 'A', 8),
  play('M0003', 'A', 6),
  play('M0004', 'A', 4),
  play('M0100', 'G', 9),
  play('M0101', 'G', 2),
]);

describe('makePositionIndex', () => {
  it('counts the plays of each category', () => {
    expect(playsIn(INDEX, code('A'))).toBe(4);
    expect(playsIn(INDEX, code('G'))).toBe(2);
    expect(playsIn(INDEX, code('B'))).toBe(0);
  });

  it('orders the plays by time before numbering them', () => {
    const shuffled = makePositionIndex([
      play('M0004', 'A', 4),
      play('M0001', 'A', 10),
      play('M0002', 'A', 8),
    ]);
    expect(restPlays(shuffled, cart('M0001'), code('A'))).toBe(2);
    expect(restPlays(shuffled, cart('M0004'), code('A'))).toBe(0);
  });

  it('handles an empty index', () => {
    expect(playsIn(NO_POSITIONS, code('A'))).toBe(0);
    expect(restPlays(NO_POSITIONS, cart('M0001'), code('A'))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('restPlays', () => {
  it('counts the plays of the category since the cart aired', () => {
    expect(restPlays(INDEX, cart('M0001'), code('A'))).toBe(3);
    expect(restPlays(INDEX, cart('M0002'), code('A'))).toBe(2);
    expect(restPlays(INDEX, cart('M0004'), code('A'))).toBe(0);
  });

  it('rests a never played cart infinitely, matching rest in hours', () => {
    expect(restPlays(INDEX, cart('M9999'), code('A'))).toBe(Number.POSITIVE_INFINITY);
  });

  it('counts only the category asked about', () => {
    expect(restPlays(INDEX, cart('M0100'), code('G'))).toBe(1);
  });
});

describe('the two measures of rest disagree', () => {
  it('ranks a slow category ahead on hours and behind on plays', () => {
    const hours = makePlayHistory(
      INDEX.lastPositionByCart.size === 0
        ? []
        : [
            { cart: cart('M0001'), at: NOW - 10 * HOUR_MS, cell: 0 },
            { cart: cart('M0100'), at: NOW - 9 * HOUR_MS, cell: 0 },
          ],
    );
    expect(restHours(hours, cart('M0001'), NOW)).toBeGreaterThan(
      restHours(hours, cart('M0100'), NOW),
    );
    expect(restPlays(INDEX, cart('M0001'), code('A'))).toBeGreaterThan(
      restPlays(INDEX, cart('M0100'), code('G')),
    );
  });

  it('makes cycles comparable across categories where raw plays are not', () => {
    expect(restCycles(INDEX, cart('M0001'), code('A'), 4)).toBe(0.75);
    expect(restCycles(INDEX, cart('M0100'), code('G'), 2)).toBe(0.5);
    expect(restPlays(INDEX, cart('M0001'), code('A'))).toBeGreaterThan(
      restPlays(INDEX, cart('M0100'), code('G')),
    );
  });

  it('gives a never played cart infinite cycles too', () => {
    expect(restCycles(INDEX, cart('M9999'), code('A'), 40)).toBe(Number.POSITIVE_INFINITY);
  });

  it('gives zero cycles for a category with nothing in it', () => {
    expect(restCycles(INDEX, cart('M0001'), code('A'), 0)).toBe(0);
  });
});

describe('isDue', () => {
  it('is due once the category has come a whole cycle round', () => {
    expect(isDue(INDEX, cart('M0001'), code('A'), 3)).toBe(true);
    expect(isDue(INDEX, cart('M0001'), code('A'), 4)).toBe(false);
  });

  it('is due exactly on one full cycle', () => {
    expect(restCycles(INDEX, cart('M0002'), code('A'), 2)).toBe(1);
    expect(isDue(INDEX, cart('M0002'), code('A'), 2)).toBe(true);
  });

  it('is always due if it never played', () => {
    expect(isDue(INDEX, cart('M9999'), code('A'), 400)).toBe(true);
  });

  it('is not due the moment it plays', () => {
    expect(isDue(INDEX, cart('M0004'), code('A'), 4)).toBe(false);
  });
});

describe('withPlay', () => {
  it('advances the category and resets that cart', () => {
    const after = withPlay(INDEX, play('M0001', 'A', 0));
    expect(playsIn(after, code('A'))).toBe(5);
    expect(restPlays(after, cart('M0001'), code('A'))).toBe(0);
    expect(restPlays(after, cart('M0002'), code('A'))).toBe(3);
  });

  it('leaves the index it was given alone', () => {
    withPlay(INDEX, play('M0001', 'A', 0));
    expect(playsIn(INDEX, code('A'))).toBe(4);
    expect(restPlays(INDEX, cart('M0001'), code('A'))).toBe(3);
  });

  it('does not disturb another category', () => {
    const after = withPlay(INDEX, play('M0001', 'A', 0));
    expect(playsIn(after, code('G'))).toBe(2);
  });
});

describe('restOrder', () => {
  it('puts the best rested first', () => {
    const carts = [cart('M0004'), cart('M0001'), cart('M0003'), cart('M0002')];
    expect(restOrder(INDEX, carts, code('A'))).toEqual(['M0001', 'M0002', 'M0003', 'M0004']);
  });

  it('puts a never played cart at the very front', () => {
    const carts = [cart('M0001'), cart('M9999')];
    expect(restOrder(INDEX, carts, code('A'))[0]).toBe('M9999');
  });

  it('breaks a tie on the cart number so a rerun matches', () => {
    const carts = [cart('M9998'), cart('M9999'), cart('M9997')];
    expect(restOrder(INDEX, carts, code('A'))).toEqual(['M9997', 'M9998', 'M9999']);
    expect(restOrder(INDEX, [...carts].reverse(), code('A'))).toEqual(['M9997', 'M9998', 'M9999']);
  });

  it('does not reorder the list it was given', () => {
    const carts = [cart('M0004'), cart('M0001')];
    restOrder(INDEX, carts, code('A'));
    expect(carts).toEqual(['M0004', 'M0001']);
  });

  it('orders an empty list to an empty list', () => {
    expect(restOrder(INDEX, [], code('A'))).toEqual([]);
  });
});
