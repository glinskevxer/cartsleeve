import { beforeEach, describe, expect, it } from 'vitest';
import {
  BACKWARDS_PERIOD,
  DOES_NOT_BALANCE,
  DUPLICATE_LINE,
  EMPTY_FILING,
  MISSING_ISRC,
  MISSING_PAYEE,
  MISSING_TITLE,
  ZERO_SPINS,
  unfilableLines,
  validateReport,
} from '../../src/royalty/validate.js';
import { buildQuarterly } from '../../src/royalty/quarterly.js';
import type { QuarterlyReport, ReportPeriod } from '../../src/royalty/quarterly.js';
import { weeklySample } from '../../src/royalty/sampling.js';
import { spinsFrom } from '../../src/royalty/spin.js';
import type { Airing } from '../../src/aired/rebuild.js';
import type { CartNumber, Isrc } from '../../src/util/ids.js';
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
      billed: 'Johnny Cash',
      title: 'Ring of Fire',
      label: 'Columbia',
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

const report = (numbers: readonly string[]): QuarterlyReport =>
  buildQuarterly({
    station: 'KHRT',
    period: PERIOD,
    spins: spinsFrom(
      numbers.map((number, index) => airing(number, BASE + index * 5000)),
      LIBRARY(),
    ).spins,
  });

const broken = (over: Partial<QuarterlyReport['lines'][number]>): QuarterlyReport => {
  const built = report(['M0001']);
  return { ...built, lines: built.lines.map((line) => ({ ...line, ...over })) };
};

describe('a healthy filing', () => {
  it('is filable', () => {
    const outcome = validateReport(report(['M0001', 'M0002']));
    expect(outcome.filable).toBe(true);
    expect(outcome.fatal).toBe(0);
    expect(outcome.problems).toEqual([]);
  });
});

describe('line level checks', () => {
  it('refuses a line with no usable isrc', () => {
    const outcome = validateReport(broken({ isrc: 'short' as Isrc }));
    expect(outcome.problems[0]?.code).toBe(MISSING_ISRC);
    expect(outcome.filable).toBe(false);
  });

  it('refuses a line naming nobody to pay', () => {
    const outcome = validateReport(broken({ payee: '  ' }));
    expect(outcome.problems.map((each) => each.code)).toContain(MISSING_PAYEE);
    expect(outcome.filable).toBe(false);
  });

  it('warns about a line with no title but still files it', () => {
    const outcome = validateReport(broken({ title: '' }));
    expect(outcome.problems[0]?.code).toBe(MISSING_TITLE);
    expect(outcome.filable).toBe(true);
  });
  it('refuses a line with no usable isrc', () => {
    const outcome = validateReport(broken({ isrc: 'short' as Isrc }));
    expect(outcome.problems[0]?.code).toBe(MISSING_ISRC);
    expect(outcome.filable).toBe(false);
  });

  it('refuses a line naming nobody to pay', () => {
    const outcome = validateReport(broken({ payee: '  ' }));
    expect(outcome.problems.map((each) => each.code)).toContain(MISSING_PAYEE);
    expect(outcome.filable).toBe(false);
  });

  it('warns about a line with no title but still files it', () => {
    const outcome = validateReport(broken({ title: '' }));
    expect(outcome.problems[0]?.code).toBe(MISSING_TITLE);
    expect(outcome.filable).toBe(true);
  });

  it('refuses a line claiming no spins', () => {
    const outcome = validateReport(broken({ spins: 0 }));
    expect(outcome.problems.map((each) => each.code)).toContain(ZERO_SPINS);
  });

  it('names the lines a society would discard', () => {
    expect(unfilableLines(broken({ isrc: 'short' as Isrc }))).toHaveLength(1);
    expect(unfilableLines(report(['M0001']))).toEqual([]);
  });
});

describe('report level checks', () => {
  it('refuses a report that repeats a recording and artist', () => {
    const built = report(['M0001']);
    const doubled: QuarterlyReport = { ...built, lines: [...built.lines, ...built.lines] };
    const outcome = validateReport(doubled);
    expect(outcome.problems.map((each) => each.code)).toContain(DUPLICATE_LINE);
    expect(outcome.filable).toBe(false);
  });

  it('refuses a report whose spin counts do not add up', () => {
    const wrong: QuarterlyReport = { ...report(['M0001']), totalSpins: 99 };
    expect(validateReport(wrong).problems.map((each) => each.code)).toContain(DOES_NOT_BALANCE);
  });

  it('warns about a filing that claims nothing', () => {
    const outcome = validateReport(report([]));
    expect(outcome.problems.map((each) => each.code)).toContain(EMPTY_FILING);
    expect(outcome.filable).toBe(true);
  });

  it('refuses a period that runs backwards', () => {
    const backwards: QuarterlyReport = {
      ...report(['M0001']),
      period: { ...PERIOD, from: PERIOD.to, to: PERIOD.from },
    };
    expect(validateReport(backwards).problems.map((each) => each.code)).toContain(BACKWARDS_PERIOD);
  });

  it('folds in the sample audit when one is given', () => {
    const outcome = validateReport(report(['M0001']), weeklySample(PERIOD.from, PERIOD.to, 0));
    expect(outcome.problems.length).toBeGreaterThan(0);
  });

  it('says nothing about a healthy sample', () => {
    const outcome = validateReport(report(['M0001']), weeklySample(PERIOD.from, PERIOD.to, 2));
    expect(outcome.problems).toEqual([]);
  });
});

describe('counting the fatal problems', () => {
  it('counts only the errors toward filability', () => {
    const outcome = validateReport(broken({ title: '', payee: '  ' }));
    expect(outcome.fatal).toBe(1);
    expect(outcome.problems).toHaveLength(2);
    expect(outcome.filable).toBe(false);
  });
});
