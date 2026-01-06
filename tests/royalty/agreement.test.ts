import { beforeEach, describe, expect, it } from 'vitest';
import {
  EXPECTED_DIVERGENCE,
  UNEXPECTED_DIVERGENCE,
  claimedOnly,
  diverging,
  explain,
  measureAgreement,
} from '../../src/royalty/agreement.js';
import { spinsFrom } from '../../src/royalty/spin.js';
import type { Spin } from '../../src/royalty/spin.js';
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
    { number: 'M0001', category: 'A', billed: 'Emmylou Harris', title: 'Boulder' },
    { number: 'M0002', category: 'A', billed: 'Kendrick Lamar feat. SZA', title: 'All the Stars' },
    { number: 'M0003', category: 'A', billed: 'SZA', title: 'Good Days' },
  ]);

function airing(number: string, at: number): Airing {
  return {
    cart: cart(number),
    startedAt: at,
    endedAt: at + 180_000,
    length: 180_000,
    orphan: false,
    note: '',
  };
}

const spins = (numbers: readonly string[]): Spin[] => [
  ...spinsFrom(
    numbers.map((number, index) => airing(number, BASE + index * 200_000)),
    LIBRARY(),
  ).spins,
];

describe('a log of solo records', () => {
  it('agrees under either policy', () => {
    for (const policy of ['billed', 'strict'] as const) {
      const found = measureAgreement(spins(['M0001', 'M0003']), policy);
      expect(found.agrees).toBe(true);
      expect(diverging(found)).toEqual([]);
      expect(explain(found)).toEqual([]);
    }
  });

  it('counts one play and one claim per record', () => {
    const found = measureAgreement(spins(['M0001']), 'billed');
    expect(found.totalLogged).toBe(1);
    expect(found.totalClaimed).toBe(1);
  });
});

describe('a log with a collaboration', () => {
  it('diverges under the billed policy', () => {
    const found = measureAgreement(spins(['M0002']), 'billed');
    expect(found.agrees).toBe(false);
    expect(found.totalLogged).toBe(1);
    expect(found.totalClaimed).toBeCloseTo(1);
  });

  it('names the artist the log never counted', () => {
    const found = measureAgreement(spins(['M0002']), 'billed');
    expect(claimedOnly(found).map((each) => each.artistKey)).toEqual(['SZA']);
  });

  it('shows the primary claiming less than the log counted', () => {
    const found = measureAgreement(spins(['M0002']), 'billed');
    const primary = found.artists.find((each) => each.artistKey === 'KENDRICK LAMAR');
    expect(primary?.logged).toBe(1);
    expect(primary?.claimed).toBeCloseTo(0.5);
    expect(primary?.divergence).toBeCloseTo(-0.5);
  });

  it('names the same artists under strict credit', () => {
    const found = measureAgreement(spins(['M0002']), 'strict');
    expect(found.agrees).toBe(true);
    expect(diverging(found)).toEqual([]);
    expect(claimedOnly(found)).toEqual([]);
  });

  it('still disagrees about how much under strict credit', () => {
    const found = measureAgreement(spins(['M0002']), 'strict');
    // Two artists, each logged a whole play, each claiming half a spin.
    expect(found.totalLogged).toBe(2);
    expect(found.totalClaimed).toBeCloseTo(1);
    expect(found.artists.every((each) => each.divergence < 0)).toBe(true);
  });

  it('shows the who disagreement is the policy, not a defect', () => {
    const billed = measureAgreement(spins(['M0002']), 'billed');
    const strict = measureAgreement(spins(['M0002']), 'strict');
    expect(billed.agrees).toBe(false);
    expect(strict.agrees).toBe(true);
  });
});

describe('explain', () => {
  it('says nothing when the two agree', () => {
    expect(explain(measureAgreement(spins(['M0001']), 'billed'))).toEqual([]);
  });

  it('calls a divergence expected under the billed policy', () => {
    const problems = explain(measureAgreement(spins(['M0002']), 'billed'));
    expect(problems[0]?.code).toBe(EXPECTED_DIVERGENCE);
    expect(problems[0]?.severity).toBe('info');
    expect(problems[0]?.message).toContain('billed credit policy');
  });

  it('says nothing under strict credit, where the names always match', () => {
    expect(explain(measureAgreement(spins(['M0002']), 'strict'))).toEqual([]);
  });

  it('warns if the names ever disagree under strict credit', () => {
    const found = measureAgreement(spins(['M0002']), 'strict');
    const forced: typeof found = {
      ...found,
      policy: 'strict',
      artists: [{ artistKey: 'GHOST', artistName: 'Ghost', logged: 0, claimed: 1, divergence: 1 }],
      agrees: false,
    };
    const problems = explain(forced);
    expect(problems[0]?.code).toBe(UNEXPECTED_DIVERGENCE);
    expect(problems[0]?.severity).toBe('warning');
  });
});

describe('ordering and edges', () => {
  it('puts the largest divergence first', () => {
    const found = measureAgreement(spins(['M0002', 'M0002', 'M0003']), 'billed');
    expect(Math.abs(found.artists[0]?.divergence ?? 0)).toBeGreaterThanOrEqual(
      Math.abs(found.artists[1]?.divergence ?? 0),
    );
  });

  it('counts an artist appearing both solo and as a guest', () => {
    const found = measureAgreement(spins(['M0002', 'M0003']), 'billed');
    const sza = found.artists.find((each) => each.artistKey === 'SZA');
    expect(sza?.logged).toBe(1);
    expect(sza?.claimed).toBeCloseTo(1.5);
  });

  it('measures nothing from nothing', () => {
    const found = measureAgreement([], 'billed');
    expect(found.artists).toEqual([]);
    expect(found.agrees).toBe(true);
    expect(found.totalLogged).toBe(0);
  });

  it('keeps the artist name as billed', () => {
    const found = measureAgreement(spins(['M0002']), 'billed');
    expect(found.artists.map((each) => each.artistName)).toContain('Kendrick Lamar');
  });
});
