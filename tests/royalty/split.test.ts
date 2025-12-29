import { beforeEach, describe, expect, it } from 'vitest';
import {
  MANY_CREDITS,
  NO_CREDITS,
  SUSPICIOUS_CREDIT_COUNT,
  artistsNamed,
  auditSplits,
  byArtist,
  creditDivergence,
  splitAll,
  splitSpin,
  spinsOwed,
} from '../../src/royalty/split.js';
import { spinsFrom } from '../../src/royalty/spin.js';
import type { Airing } from '../../src/aired/rebuild.js';
import type { CartNumber } from '../../src/util/ids.js';
import { resetFixtures } from '../support/fixtures.js';
import { libraryOf } from '../support/hour.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const BASE = 1_700_000_000_000;

const LIBRARY = () =>
  libraryOf([
    { number: 'M0001', category: 'A', billed: 'Emmylou Harris', title: 'Boulder to Birmingham' },
    {
      number: 'M0002',
      category: 'A',
      billed: 'Kendrick Lamar feat. SZA, Jay Rock',
      title: 'All the Stars',
    },
    { number: 'M0003', category: 'A', billed: '...', title: 'Nameless' },
    {
      number: 'M0004',
      category: 'A',
      billed: 'A feat. B, C, D, E, F, G',
      title: 'A Crowded Track',
    },
  ]);

function airing(number: string, at: number): Airing {
  return {
    cart: cart(number),
    startedAt: at,
    endedAt: at + 1000,
    length: 1000,
    orphan: false,
    note: '',
  };
}

const spins = (numbers: readonly string[]) =>
  spinsFrom(
    numbers.map((number, index) => airing(number, BASE + index * 5000)),
    LIBRARY(),
  ).spins;

describe('splitSpin', () => {
  it('gives a solo spin one whole share', () => {
    const shares = splitSpin(spins(['M0001'])[0] as never);
    expect(shares).toHaveLength(1);
    expect(shares[0]?.parts).toBe(1);
    expect(shares[0]?.of).toBe(1);
    expect(shares[0]?.featured).toBe(false);
  });

  it('splits a collaboration evenly across every credit', () => {
    const shares = splitSpin(spins(['M0002'])[0] as never);
    expect(shares).toHaveLength(3);
    expect(shares.every((each) => each.parts === 1 && each.of === 3)).toBe(true);
  });

  it('marks the featured credits as featured', () => {
    const shares = splitSpin(spins(['M0002'])[0] as never);
    expect(shares.map((each) => each.featured)).toEqual([false, true, true]);
  });

  it('names the artist as billed and keys it normalised', () => {
    const shares = splitSpin(spins(['M0002'])[0] as never);
    expect(shares[1]?.artistName).toBe('SZA');
    expect(shares[1]?.artistKey).toBe('SZA');
  });

  it('carries the recording and the time onto every share', () => {
    const shares = splitSpin(spins(['M0002'])[0] as never);
    expect(new Set(shares.map((each) => each.isrc)).size).toBe(1);
    expect(new Set(shares.map((each) => each.at)).size).toBe(1);
  });

  it('splits nothing from a spin with no credits', () => {
    expect(splitSpin(spins(['M0003'])[0] as never)).toEqual([]);
  });

  it('splits a whole log at once', () => {
    expect(splitAll(spins(['M0001', 'M0002']))).toHaveLength(4);
    expect(splitAll([])).toEqual([]);
  });
});

describe('spinsOwed', () => {
  it('owes a solo artist one whole spin', () => {
    expect(spinsOwed(splitAll(spins(['M0001'])), 'EMMYLOU HARRIS')).toBe(1);
  });

  it('owes each of three collaborators a third', () => {
    const shares = splitAll(spins(['M0002']));
    expect(spinsOwed(shares, 'SZA')).toBeCloseTo(1 / 3);
  });

  it('sums three thirds back to a whole spin', () => {
    const shares = splitAll(spins(['M0002']));
    const total =
      spinsOwed(shares, 'KENDRICK LAMAR') +
      spinsOwed(shares, 'SZA') +
      spinsOwed(shares, 'JAY ROCK');
    expect(total).toBeCloseTo(1);
  });

  it('sums across several spins of one artist', () => {
    const shares = splitAll(spins(['M0001', 'M0001']));
    expect(spinsOwed(shares, 'EMMYLOU HARRIS')).toBe(2);
  });

  it('owes nothing to an artist who did not play', () => {
    expect(spinsOwed(splitAll(spins(['M0001'])), 'NOBODY')).toBe(0);
  });
});

describe('the log and the report disagree', () => {
  it('diverges by the featured credits under the billed policy', () => {
    expect(creditDivergence(spins(['M0002']), 'billed')).toBe(2);
  });

  it('agrees exactly under strict credit', () => {
    expect(creditDivergence(spins(['M0002']), 'strict')).toBe(0);
  });

  it('agrees on a solo record under either policy', () => {
    expect(creditDivergence(spins(['M0001']), 'billed')).toBe(0);
    expect(creditDivergence(spins(['M0001']), 'strict')).toBe(0);
  });

  it('names more artists than the log ever counts', () => {
    const shares = splitAll(spins(['M0002']));
    expect(artistsNamed(shares)).toEqual(['JAY ROCK', 'KENDRICK LAMAR', 'SZA']);
  });

  it('diverges by nothing when nothing aired', () => {
    expect(creditDivergence([], 'billed')).toBe(0);
  });
});

describe('auditSplits', () => {
  it('says nothing about ordinary spins', () => {
    expect(auditSplits(spins(['M0001', 'M0002']))).toEqual([]);
  });

  it('warns about a spin nobody can be paid for', () => {
    const problems = auditSplits(spins(['M0003']));
    expect(problems[0]?.code).toBe(NO_CREDITS);
  });

  it('warns about a track crediting implausibly many artists', () => {
    const problems = auditSplits(spins(['M0004']));
    expect(problems[0]?.code).toBe(MANY_CREDITS);
    expect(problems[0]?.detail?.['allowed']).toBe(SUSPICIOUS_CREDIT_COUNT);
  });
});

describe('byArtist', () => {
  it('groups the shares of each artist', () => {
    const grouped = byArtist(splitAll(spins(['M0001', 'M0002'])));
    expect(grouped.get('EMMYLOU HARRIS')).toHaveLength(1);
    expect(grouped.get('KENDRICK LAMAR')).toHaveLength(1);
    expect(grouped.size).toBe(4);
  });

  it('groups nothing from nothing', () => {
    expect(byArtist([]).size).toBe(0);
  });
});
