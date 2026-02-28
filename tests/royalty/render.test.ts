import { beforeEach, describe, expect, it } from 'vitest';
import { renderQuarterly } from '../../src/royalty/render.js';
import { buildQuarterly } from '../../src/royalty/quarterly.js';
import type { ReportPeriod } from '../../src/royalty/quarterly.js';
import { censusSample, weeklySample } from '../../src/royalty/sampling.js';
import { spinsFrom } from '../../src/royalty/spin.js';
import { fitsPage } from '../../src/report/frame.js';
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
      title: 'Boulder',
      label: 'Reprise',
    },
    {
      number: 'M0002',
      category: 'A',
      billed: 'Kendrick Lamar feat. SZA',
      title: 'All the Stars',
      label: 'TDE',
    },
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

const report = (numbers: readonly string[]) =>
  buildQuarterly({
    station: 'KHRT',
    period: PERIOD,
    spins: spinsFrom(
      numbers.map((number, index) => airing(number, BASE + index * 200_000)),
      LIBRARY(),
    ).spins,
  });

describe('renderQuarterly', () => {
  it('opens with the title and the station', () => {
    const lines = renderQuarterly(report(['M0001']));
    expect(lines[0]?.trim()).toBe('PERFORMANCE REPORT');
    expect(lines.join('\n')).toContain('KHRT');
    expect(lines.join('\n')).toContain('Q2 2025');
  });

  it('summarises the recordings, spins and lines', () => {
    const text = renderQuarterly(report(['M0001', 'M0002'])).join('\n');
    expect(text).toContain('recordings:');
    expect(text).toContain('spins:');
    expect(text).toContain('lines:');
  });

  it('prints a payee section and a detail section', () => {
    const lines = renderQuarterly(report(['M0001', 'M0002']));
    expect(lines).toContain('BY PAYEE');
    expect(lines).toContain('DETAIL');
  });

  it('prints the hyphenated isrc in the detail', () => {
    expect(renderQuarterly(report(['M0001'])).join('\n')).toMatch(
      /[A-Z]{2}-[A-Z0-9]{3}-\d{2}-\d{5}/,
    );
  });

  it('shows a whole share as all and a split one as a fraction', () => {
    const text = renderQuarterly(report(['M0001', 'M0002'])).join('\n');
    expect(text).toContain('all');
    expect(text).toContain('1/2');
  });

  it('names the basis when a sample is given', () => {
    const census = renderQuarterly(report(['M0001']), censusSample(PERIOD.from, PERIOD.to));
    expect(census.join('\n')).toContain('census of 91 days');
    const sampled = renderQuarterly(report(['M0001']), weeklySample(PERIOD.from, PERIOD.to, 2));
    expect(sampled.join('\n')).toContain('sample of 14 days');
  });

  it('leaves the basis out when no sample is given', () => {
    expect(renderQuarterly(report(['M0001'])).join('\n')).not.toContain('basis:');
  });

  it('drops both sections on an empty report', () => {
    const lines = renderQuarterly(report([]));
    expect(lines).not.toContain('DETAIL');
    expect(lines).not.toContain('BY PAYEE');
  });

  it('fits the page and leaves no trailing space', () => {
    expect(fitsPage(renderQuarterly(report(['M0001', 'M0002'])))).toBe(true);
  });

  it('orders the payees by spins', () => {
    const lines = renderQuarterly(report(['M0002', 'M0002', 'M0001']));
    const start = lines.indexOf('BY PAYEE');
    expect(lines[start + 3]).toContain('TDE');
  });
});
