import { beforeEach, describe, expect, it } from 'vitest';
import {
  NO_LENGTH,
  NO_RECORDING,
  UNKNOWN_CART,
  spinCounts,
  spinsFrom,
  spinsOf,
  totalPerformed,
  unmeasuredSpins,
} from '../../src/royalty/spin.js';
import type { Airing } from '../../src/aired/rebuild.js';
import type { CartNumber, Isrc } from '../../src/util/ids.js';
import { resetFixtures } from '../support/fixtures.js';
import { libraryOf } from '../support/hour.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const isrc = (value: string): Isrc => value as Isrc;
const BASE = 1_700_000_000_000;

const JOLENE = 'USRC17607839';
const RING = 'USRC17600001';

const LIBRARY = () =>
  libraryOf([
    { number: 'M0001', category: 'A', isrc: JOLENE, title: 'Jolene', billed: 'Dolly Parton' },
    { number: 'M0500', category: 'G', isrc: JOLENE, title: 'Jolene', billed: 'Dolly Parton' },
    { number: 'M0002', category: 'A', isrc: RING, title: 'Ring of Fire', billed: 'Johnny Cash' },
    { number: 'M0003', category: 'A', noRecording: true },
    { number: 'J0009', billed: '', category: 'X', runtime: '0:10' },
  ]);

function airing(number: string, at: number, length?: number): Airing {
  return {
    cart: cart(number),
    startedAt: at,
    orphan: false,
    note: '',
    ...(length === undefined ? {} : { endedAt: at + length, length }),
  };
}

describe('spinsFrom', () => {
  it('turns a music airing into a spin', () => {
    const outcome = spinsFrom([airing('M0001', BASE, 180_000)], LIBRARY());
    expect(outcome.spins).toHaveLength(1);
    expect(outcome.spins[0]?.isrc).toBe(JOLENE);
    expect(outcome.spins[0]?.length).toBe(180_000);
    expect(outcome.problems).toEqual([]);
  });

  it('carries the credits onto the spin', () => {
    const outcome = spinsFrom([airing('M0001', BASE, 1000)], LIBRARY());
    expect(outcome.spins[0]?.credits.map((each) => each.name)).toEqual(['Dolly Parton']);
  });

  it('produces two spins of one recording from two carts of it', () => {
    const outcome = spinsFrom(
      [airing('M0001', BASE, 1000), airing('M0500', BASE + 5000, 1000)],
      LIBRARY(),
    );
    expect(outcome.spins).toHaveLength(2);
    expect(spinsOf(outcome, isrc(JOLENE))).toHaveLength(2);
    expect(spinCounts(outcome).get(isrc(JOLENE))).toBe(2);
  });

  it('produces no spin from a cart that is not music', () => {
    const outcome = spinsFrom([airing('J0009', BASE, 1000)], LIBRARY());
    expect(outcome.spins).toEqual([]);
    expect(outcome.problems).toEqual([]);
    expect(outcome.unclaimed).toEqual([]);
  });

  it('reports music with no recording as unclaimable', () => {
    const outcome = spinsFrom([airing('M0003', BASE, 1000)], LIBRARY());
    expect(outcome.spins).toEqual([]);
    expect(outcome.problems[0]?.code).toBe(NO_RECORDING);
    expect(outcome.problems[0]?.severity).toBe('error');
    expect(outcome.unclaimed).toHaveLength(1);
  });

  it('reports a cart the library does not have as unclaimable', () => {
    const outcome = spinsFrom([airing('M9999', BASE, 1000)], LIBRARY());
    expect(outcome.problems[0]?.code).toBe(UNKNOWN_CART);
    expect(outcome.unclaimed).toHaveLength(1);
  });

  it('still claims a spin whose length was never reported, and warns', () => {
    const outcome = spinsFrom([airing('M0001', BASE)], LIBRARY());
    expect(outcome.spins).toHaveLength(1);
    expect(outcome.spins[0]?.length).toBeUndefined();
    expect(outcome.problems[0]?.code).toBe(NO_LENGTH);
    expect(outcome.problems[0]?.severity).toBe('warning');
  });

  it('produces nothing from nothing', () => {
    const outcome = spinsFrom([], LIBRARY());
    expect(outcome.spins).toEqual([]);
    expect(outcome.problems).toEqual([]);
  });

  it('keeps going past an airing it cannot claim', () => {
    const outcome = spinsFrom(
      [airing('M9999', BASE, 1000), airing('M0001', BASE + 5000, 1000)],
      LIBRARY(),
    );
    expect(outcome.spins).toHaveLength(1);
    expect(outcome.problems).toHaveLength(1);
  });
});

describe('reading the spins back', () => {
  const outcome = () =>
    spinsFrom(
      [
        airing('M0001', BASE, 180_000),
        airing('M0002', BASE + 200_000, 160_000),
        airing('M0500', BASE + 400_000),
      ],
      LIBRARY(),
    );

  it('finds the spins of one recording whichever cart carried it', () => {
    expect(spinsOf(outcome(), isrc(JOLENE)).map((each) => each.cart)).toEqual(['M0001', 'M0500']);
    expect(spinsOf(outcome(), isrc('GBAYE0601498'))).toEqual([]);
  });

  it('counts the spins per recording', () => {
    const counts = spinCounts(outcome());
    expect(counts.get(isrc(JOLENE))).toBe(2);
    expect(counts.get(isrc(RING))).toBe(1);
  });

  it('totals only the time that was measured', () => {
    expect(totalPerformed(outcome())).toBe(340_000);
  });

  it('names the spins whose length was never observed', () => {
    expect(unmeasuredSpins(outcome()).map((each) => each.cart)).toEqual(['M0500']);
  });

  it('reports nothing for an empty log', () => {
    const empty = spinsFrom([], LIBRARY());
    expect(spinCounts(empty).size).toBe(0);
    expect(totalPerformed(empty)).toBe(0);
    expect(unmeasuredSpins(empty)).toEqual([]);
  });
});
