import { beforeEach, describe, expect, it } from 'vitest';
import {
  balances,
  buildQuarterly,
  describePeriod,
  linesFor,
  payees,
} from '../../src/royalty/quarterly.js';
import type { ReportPeriod } from '../../src/royalty/quarterly.js';
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

const PERIOD: ReportPeriod = {
  from: { year: 2025, month: 4, day: 1 },
  to: { year: 2025, month: 6, day: 30 },
  label: 'Q2 2025',
};

const LIBRARY = () =>
  libraryOf([
    {
      number: 'M0001',
      category: 'A',
      billed: 'Emmylou Harris',
      title: 'Boulder to Birmingham',
      label: 'Reprise',
      isrc: 'USRC17607839',
    },
    {
      number: 'M0002',
      category: 'A',
      billed: 'Kendrick Lamar feat. SZA',
      title: 'All the Stars',
      label: 'TDE',
      isrc: 'USRC17607840',
    },
  ]);

function airing(number: string, at: number, length = 180_000): Airing {
  return {
    cart: cart(number),
    startedAt: at,
    endedAt: at + length,
    length,
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

const report = (numbers: readonly string[]) =>
  buildQuarterly({ station: 'KHRT', period: PERIOD, spins: spins(numbers) });

describe('buildQuarterly', () => {
  it('gives a solo recording one line', () => {
    const built = report(['M0001']);
    expect(built.lines).toHaveLength(1);
    expect(built.lines[0]?.artist).toBe('Emmylou Harris');
    expect(built.lines[0]?.spins).toBe(1);
    expect(built.lines[0]?.parts).toBe(1);
    expect(built.lines[0]?.of).toBe(1);
  });

  it('gives a collaboration one line per credited artist', () => {
    const built = report(['M0002']);
    expect(built.lines).toHaveLength(2);
    expect(built.lines.map((each) => each.artist)).toEqual(['Kendrick Lamar', 'SZA']);
    expect(built.lines.map((each) => each.featured)).toEqual([false, true]);
  });

  it('carries the whole recording spin count onto every artist line', () => {
    const built = report(['M0002', 'M0002']);
    expect(built.lines.every((each) => each.spins === 2)).toBe(true);
    expect(built.lines.every((each) => each.of === 2)).toBe(true);
  });

  it('hyphenates the isrc for the wire', () => {
    expect(report(['M0001']).lines[0]?.formattedIsrc).toBe('US-RC1-76-07839');
  });

  it('gives every line an isrc', () => {
    const built = report(['M0001', 'M0002']);
    expect(built.lines.every((each) => each.isrc.length === 12)).toBe(true);
  });

  it('totals the seconds performed per recording', () => {
    const built = report(['M0001', 'M0001']);
    expect(built.lines[0]?.seconds).toBe(360);
    expect(built.totalSeconds).toBe(360);
  });

  it('counts the recordings and the spins', () => {
    const built = report(['M0001', 'M0001', 'M0002']);
    expect(built.recordings).toBe(2);
    expect(built.totalSpins).toBe(3);
  });

  it('orders by payee, then title, then the billed artist first', () => {
    const built = report(['M0001', 'M0002']);
    expect(built.lines.map((each) => each.payee)).toEqual(['Reprise', 'TDE', 'TDE']);
    expect(built.lines[1]?.featured).toBe(false);
  });

  it('builds an empty report from no spins', () => {
    const built = report([]);
    expect(built.lines).toEqual([]);
    expect(built.totalSpins).toBe(0);
    expect(built.recordings).toBe(0);
  });

  it('keeps the station and the period', () => {
    const built = report(['M0001']);
    expect(built.station).toBe('KHRT');
    expect(built.period.label).toBe('Q2 2025');
  });
});

describe('balancing', () => {
  it('balances when every recording is counted once', () => {
    expect(balances(report(['M0001', 'M0002', 'M0002']))).toBe(true);
  });

  it('balances an empty report', () => {
    expect(balances(report([]))).toBe(true);
  });

  it('does not double count a recording across its artist lines', () => {
    const built = report(['M0002']);
    expect(built.lines).toHaveLength(2);
    expect(built.totalSpins).toBe(1);
    expect(balances(built)).toBe(true);
  });
});

describe('reading the report', () => {
  it('names every payee in line order', () => {
    expect(payees(report(['M0001', 'M0002']))).toEqual(['Reprise', 'TDE']);
  });

  it('gives the lines owed to one payee', () => {
    expect(linesFor(report(['M0001', 'M0002']), 'TDE')).toHaveLength(2);
    expect(linesFor(report(['M0001']), 'Nobody')).toEqual([]);
  });

  it('describes the period for the header', () => {
    expect(describePeriod(PERIOD)).toBe('Q2 2025 (2025-04-01 to 2025-06-30)');
  });
});
