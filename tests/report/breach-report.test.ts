import { describe, expect, it } from 'vitest';
import {
  DETAIL_LIMIT,
  REPEAT_THRESHOLD,
  breachSummary,
  renderBreaches,
  repeatOffenders,
} from '../../src/report/breach-report.js';
import type { BreachReportInput } from '../../src/report/breach-report.js';
import { fitsPage } from '../../src/report/frame.js';
import type { Breach } from '../../src/schedule/breach.js';
import type { HoleRecord } from '../../src/schedule/hole.js';
import { tenths } from '../../src/util/duration.js';
import type { CartNumber } from '../../src/util/ids.js';

const cart = (value: string): CartNumber => value as CartNumber;

const breach = (over: Partial<Breach> = {}): Breach => ({
  position: 4,
  at: tenths(2400),
  cart: cart('M0001'),
  rule: 'artist separation',
  tier: 2,
  code: 'RUL-001',
  message: 'DOLLY PARTON is 38 minutes away and needs 75',
  shortfall: 600,
  detail: {},
  ...over,
});

const hole = (over: Partial<HoleRecord> = {}): HoleRecord => ({
  position: 9,
  category: 'A',
  diagnosis: { cause: 'category empty', rejected: 0, considered: 0 },
  ...over,
});

const input = (over: Partial<BreachReportInput> = {}): BreachReportInput => ({
  breaches: [],
  holes: [],
  station: 'KHRT',
  period: 'week of 2025-06-09',
  ...over,
});

describe('repeatOffenders', () => {
  it('names a cart breaching often enough to matter', () => {
    const breaches = Array.from({ length: 4 }, (_, index) => breach({ position: index }));
    const found = repeatOffenders(breaches);
    expect(found).toHaveLength(1);
    expect(found[0]?.cart).toBe('M0001');
    expect(found[0]?.count).toBe(4);
    expect(found[0]?.worst).toBe('artist separation');
  });

  it('leaves out a cart under the threshold', () => {
    expect(repeatOffenders([breach(), breach({ position: 5 })])).toEqual([]);
    expect(REPEAT_THRESHOLD).toBeGreaterThan(1);
  });

  it('honours a threshold that is given', () => {
    expect(repeatOffenders([breach()], 1)).toHaveLength(1);
  });

  it('puts the worst offender first, then orders by cart', () => {
    const breaches = [
      breach({ cart: cart('M0002') }),
      breach({ cart: cart('M0002'), position: 5 }),
      breach({ cart: cart('M0001') }),
      breach({ cart: cart('M0001'), position: 5 }),
      breach({ cart: cart('M0001'), position: 6 }),
    ];
    expect(repeatOffenders(breaches, 2).map((each) => each.cart)).toEqual(['M0001', 'M0002']);
  });

  it('names nobody in an empty week', () => {
    expect(repeatOffenders([])).toEqual([]);
  });
});

describe('renderBreaches', () => {
  const busy = () =>
    input({
      breaches: [
        ...Array.from({ length: 4 }, (_, index) => breach({ position: index })),
        breach({ rule: 'tempo flow', tier: 5, cart: cart('M0009'), message: 'a jump of 4' }),
      ],
      holes: [hole()],
    });

  it('opens with the title, the station and the period', () => {
    const lines = renderBreaches(busy());
    expect(lines[0]?.trim()).toBe('BREACHES AND HOLES');
    expect(lines.join('\n')).toContain('KHRT');
    expect(lines.join('\n')).toContain('week of 2025-06-09');
  });

  it('leads with the rules rather than the individual breaches', () => {
    const lines = renderBreaches(busy());
    expect(lines.indexOf('BY RULE')).toBeLessThan(
      lines.findIndex((line) => line.startsWith('WORST')),
    );
  });

  it('shares the rules out as percentages', () => {
    expect(renderBreaches(busy()).join('\n')).toContain('80.0%');
  });

  it('prints the repeat offenders', () => {
    const lines = renderBreaches(busy());
    expect(lines).toContain('REPEAT OFFENDERS');
    expect(lines.join('\n')).toContain('M0001');
  });

  it('prints the holes with their causes', () => {
    const lines = renderBreaches(busy());
    expect(lines).toContain('HOLES');
    expect(lines.join('\n')).toContain('nothing in the category');
  });

  it('caps the detail list', () => {
    const many = input({
      breaches: Array.from({ length: 60 }, (_, index) => breach({ position: index })),
    });
    const lines = renderBreaches(many);
    const start = lines.findIndex((line) => line.startsWith('WORST'));
    expect(lines[start]).toContain(String(DETAIL_LIMIT));
    // The section is a title, then a heading row and a rule, then the rows.
    expect(lines.length - start - 3).toBe(DETAIL_LIMIT);
  });

  it('honours a detail limit that is given', () => {
    const many = input({
      breaches: Array.from({ length: 60 }, (_, index) => breach({ position: index })),
      detailLimit: 3,
    });
    expect(renderBreaches(many).findIndex((line) => line.startsWith('WORST 3'))).toBeGreaterThan(0);
  });

  it('drops every section on a clean week', () => {
    const lines = renderBreaches(input());
    expect(lines).not.toContain('BY RULE');
    expect(lines).not.toContain('HOLES');
  });

  it('fits the page', () => {
    expect(fitsPage(renderBreaches(busy()))).toBe(true);
  });
});

describe('breachSummary', () => {
  it('calls a clean week clean', () => {
    expect(breachSummary(input())).toBe('week of 2025-06-09 clean');
  });

  it('counts the breaches and the holes and names the worst rule', () => {
    const line = breachSummary(input({ breaches: [breach(), breach()], holes: [hole()] }));
    expect(line).toContain('2 breaches');
    expect(line).toContain('1 holes');
    expect(line).toContain('mostly artist separation');
  });

  it('says nothing about a rule on a week of holes only', () => {
    const line = breachSummary(input({ holes: [hole()] }));
    expect(line).toContain('0 breaches');
    expect(line).not.toContain('mostly');
  });
});
