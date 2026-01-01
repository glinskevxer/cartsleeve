import { beforeEach, describe, expect, it } from 'vitest';
import {
  PAYEE_DIFFERS,
  PAYEE_MISSING,
  SPLIT_CATALOGUE,
  auditPayees,
  payeeOf,
  recordingsFor,
  shareOf,
  splitCatalogues,
  totalsByLabel,
  totalsByPayee,
} from '../../src/royalty/payee.js';
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
    { number: 'M0001', category: 'A', label: 'RCA Victor', isrc: 'USRC17607839' },
    { number: 'M0002', category: 'A', label: 'RCA Victor', isrc: 'USRC17607840' },
    { number: 'M0003', category: 'A', label: 'Columbia', isrc: 'USRC17600001' },
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

/** Override the payee on a spin, which the fixture builder cannot do directly. */
const paying = (spin: Spin, payee: string): Spin => ({
  ...spin,
  recording: { ...spin.recording, payee },
});

describe('payeeOf', () => {
  it('takes the payee when there is one', () => {
    const spin = paying(spins(['M0001'])[0] as Spin, 'Sony Music');
    expect(payeeOf(spin)).toBe('Sony Music');
  });

  it('falls back to the label when the payee is blank', () => {
    const spin = paying(spins(['M0001'])[0] as Spin, '   ');
    expect(payeeOf(spin)).toBe('RCA Victor');
  });
});

describe('totalsByPayee', () => {
  it('groups the spins by who gets paid', () => {
    const totals = totalsByPayee(spins(['M0001', 'M0002', 'M0003']));
    expect(totals).toHaveLength(2);
    expect(totals[0]?.payee).toBe('RCA Victor');
    expect(totals[0]?.spins).toBe(2);
  });

  it('counts the distinct recordings behind those spins', () => {
    const totals = totalsByPayee(spins(['M0001', 'M0001', 'M0002']));
    const rca = totals.find((each) => each.payee === 'RCA Victor');
    expect(rca?.spins).toBe(3);
    expect(rca?.recordings).toBe(2);
  });

  it('totals the measured performance time', () => {
    expect(totalsByPayee(spins(['M0003']))[0]?.performed).toBe(180_000);
  });

  it('names every label paying through one payee', () => {
    const list = spins(['M0001', 'M0003']).map((spin) => paying(spin, 'Sony Music'));
    const totals = totalsByPayee(list);
    expect(totals).toHaveLength(1);
    expect(totals[0]?.labels).toEqual(['Columbia', 'RCA Victor']);
  });

  it('orders the biggest payee first', () => {
    const totals = totalsByPayee(spins(['M0001', 'M0002', 'M0003']));
    expect(totals.map((each) => each.spins)).toEqual([2, 1]);
  });

  it('totals nothing from nothing', () => {
    expect(totalsByPayee([])).toEqual([]);
  });

  it('still counts by label when asked to', () => {
    const counts = totalsByLabel(spins(['M0001', 'M0002', 'M0003']));
    expect(counts.get('RCA Victor')).toBe(2);
    expect(counts.get('Columbia')).toBe(1);
  });

  it('groups by the payee, not the label, when they differ', () => {
    const list = [paying(spins(['M0001'])[0] as Spin, 'Sony Music'), ...spins(['M0003'])];
    expect(
      totalsByPayee(list)
        .map((each) => each.payee)
        .sort(),
    ).toEqual(['Columbia', 'Sony Music']);
    expect([...totalsByLabel(list).keys()].sort()).toEqual(['Columbia', 'RCA Victor']);
  });
});

describe('auditPayees', () => {
  it('says nothing when every label pays itself', () => {
    expect(auditPayees(spins(['M0001', 'M0003']))).toEqual([]);
  });

  it('notes a label paying through somebody else, once', () => {
    const list = spins(['M0001', 'M0002']).map((spin) => paying(spin, 'Sony Music'));
    const found = auditPayees(list).filter((each) => each.code === PAYEE_DIFFERS);
    expect(found).toHaveLength(1);
    expect(found[0]?.detail?.['payee']).toBe('Sony Music');
  });

  it('warns when nobody at all can be paid', () => {
    const list = spins(['M0001']).map((spin) => ({
      ...spin,
      recording: { ...spin.recording, label: '  ', payee: '  ' },
    }));
    expect(auditPayees(list)[0]?.code).toBe(PAYEE_MISSING);
  });

  it('warns when one label pays through two companies', () => {
    const list = [paying(spins(['M0001'])[0] as Spin, 'Sony Music'), spins(['M0002'])[0] as Spin];
    const found = splitCatalogues(list);
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe(SPLIT_CATALOGUE);
    expect(found[0]?.subject).toBe('RCA Victor');
  });

  it('says nothing about a label with one payee', () => {
    expect(splitCatalogues(spins(['M0001', 'M0002']))).toEqual([]);
  });
});

describe('reading the totals', () => {
  it('lists the recordings owed to a payee', () => {
    expect(recordingsFor(spins(['M0001', 'M0002', 'M0003']), 'RCA Victor')).toHaveLength(2);
    expect(recordingsFor(spins(['M0001']), 'Nobody')).toEqual([]);
  });

  it('reports what share of the quarter a payee accounts for', () => {
    const totals = totalsByPayee(spins(['M0001', 'M0002', 'M0003']));
    expect(shareOf(totals, 'RCA Victor')).toBeCloseTo(2 / 3);
    expect(shareOf(totals, 'Nobody')).toBe(0);
    expect(shareOf([], 'RCA Victor')).toBe(0);
  });
});
