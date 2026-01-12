import { beforeEach, describe, expect, it } from 'vitest';
import {
  MINIMUM_SAMPLE_SHARE,
  SAMPLE_EMPTY,
  SAMPLE_TOO_SMALL,
  SAMPLE_UNEVEN,
  auditSample,
  censusSample,
  describeSample,
  inSample,
  periodLength,
  scaled,
  spinsInSample,
  weeklySample,
} from '../../src/royalty/sampling.js';
import { spinsFrom } from '../../src/royalty/spin.js';
import type { Spin } from '../../src/royalty/spin.js';
import type { Airing } from '../../src/aired/rebuild.js';
import type { BroadcastDay } from '../../src/util/time.js';
import type { CartNumber } from '../../src/util/ids.js';
import { resetFixtures } from '../support/fixtures.js';
import { libraryOf } from '../support/hour.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const BASE = 1_700_000_000_000;

const FROM: BroadcastDay = { year: 2025, month: 4, day: 1 };
const TO: BroadcastDay = { year: 2025, month: 6, day: 30 };

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

const spins = (count: number): Spin[] => [
  ...spinsFrom(
    Array.from({ length: count }, (_, index) => airing('M0001', BASE + index * 1000)),
    libraryOf([{ number: 'M0001', category: 'A' }]),
  ).spins,
];

describe('periodLength', () => {
  it('counts both bounds', () => {
    expect(periodLength(FROM, TO)).toBe(91);
    expect(periodLength(FROM, FROM)).toBe(1);
  });
});

describe('censusSample', () => {
  it('covers every day of the period', () => {
    const sample = censusSample(FROM, TO);
    expect(sample.mode).toBe('census');
    expect(sample.days).toHaveLength(91);
    expect(sample.periodDays).toBe(91);
  });

  it('scales by one, because nothing is being extrapolated', () => {
    expect(censusSample(FROM, TO).factor).toBe(1);
    expect(scaled(censusSample(FROM, TO), 7)).toBe(7);
  });

  it('says nothing on audit', () => {
    expect(auditSample(censusSample(FROM, TO))).toEqual([]);
  });

  it('describes itself as a census', () => {
    expect(describeSample(censusSample(FROM, TO))).toBe('census of 91 days');
  });
});

describe('weeklySample', () => {
  it('takes whole weeks', () => {
    const sample = weeklySample(FROM, TO, 2);
    expect(sample.days).toHaveLength(14);
    expect(sample.days.length % 7).toBe(0);
  });

  it('spaces the weeks through the period rather than bunching them', () => {
    const sample = weeklySample(FROM, TO, 2);
    const first = sample.days[0] ?? 0;
    const second = sample.days[7] ?? 0;
    expect(second - first).toBeGreaterThan(7);
  });

  it('scales by the period over the sample', () => {
    const sample = weeklySample(FROM, TO, 2);
    expect(sample.factor).toBeCloseTo(91 / 14);
    expect(scaled(sample, 1)).toBeCloseTo(6.5);
  });

  it('never runs past the end of the period', () => {
    const sample = weeklySample(FROM, TO, 20);
    const last = sample.days[sample.days.length - 1] ?? 0;
    const first = sample.days[0] ?? 0;
    expect(last - first).toBeLessThan(91);
  });

  it('takes nothing when asked for no weeks', () => {
    const sample = weeklySample(FROM, TO, 0);
    expect(sample.days).toEqual([]);
    expect(sample.factor).toBe(0);
  });

  it('describes itself with the factor', () => {
    expect(describeSample(weeklySample(FROM, TO, 2))).toContain('sample of 14 days in 91');
  });
});

describe('inSample', () => {
  it('is true for a day in the sample', () => {
    const sample = weeklySample(FROM, TO, 2);
    expect(inSample(sample, FROM)).toBe(true);
  });

  it('is false for a day outside it', () => {
    const sample = weeklySample(FROM, TO, 1);
    expect(inSample(sample, { year: 2025, month: 6, day: 29 })).toBe(false);
  });
});

describe('spinsInSample', () => {
  const dayOf = (): BroadcastDay => FROM;

  it('takes everything under a census', () => {
    expect(spinsInSample(spins(3), censusSample(FROM, TO), dayOf)).toHaveLength(3);
  });

  it('takes only what falls in the sample', () => {
    const sample = weeklySample(FROM, TO, 1);
    expect(spinsInSample(spins(3), sample, dayOf)).toHaveLength(3);
    const outside = spinsInSample(spins(3), sample, () => ({ year: 2025, month: 6, day: 29 }));
    expect(outside).toEqual([]);
  });

  it('takes nothing from nothing', () => {
    expect(spinsInSample([], censusSample(FROM, TO), dayOf)).toEqual([]);
  });
});

describe('auditSample', () => {
  it('warns when the sample covers nothing', () => {
    expect(auditSample(weeklySample(FROM, TO, 0))[0]?.code).toBe(SAMPLE_EMPTY);
  });

  it('warns when the sample is too small a share of the period', () => {
    const sample = { ...weeklySample(FROM, TO, 1), days: [0, 1], factor: 45.5 };
    const problems = auditSample(sample);
    expect(problems.map((each) => each.code)).toContain(SAMPLE_TOO_SMALL);
    expect(MINIMUM_SAMPLE_SHARE).toBeLessThan(1);
  });

  it('warns when the sample is not whole weeks', () => {
    const sample = { ...weeklySample(FROM, TO, 2), days: Array.from({ length: 10 }, (_, i) => i) };
    expect(auditSample(sample).map((each) => each.code)).toContain(SAMPLE_UNEVEN);
  });

  it('says nothing about a healthy weekly sample', () => {
    expect(auditSample(weeklySample(FROM, TO, 2))).toEqual([]);
  });
});

describe('the rounding trap', () => {
  it('does not round a scaled figure, so two hundred lines do not drift', () => {
    const sample = weeklySample(FROM, TO, 2);
    const perLine = scaled(sample, 1);
    expect(perLine).not.toBe(Math.round(perLine));
    const total = Array.from({ length: 200 }, () => perLine).reduce((sum, each) => sum + each, 0);
    const roundedFirst = 200 * Math.round(perLine);
    expect(Math.abs(total - roundedFirst)).toBeGreaterThan(50);
  });
});
