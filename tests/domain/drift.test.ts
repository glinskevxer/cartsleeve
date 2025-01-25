import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRIFT_BUDGET,
  budgetFor,
  driftProblems,
  hourDrift,
  measureDrift,
  worstDrift,
} from '../../src/domain/drift.js';
import { HOUR_TENTHS, makeClock } from '../../src/domain/clock.js';
import type { ClockElement } from '../../src/domain/clock.js';
import { tenths } from '../../src/util/duration.js';
import { expectOk } from '../support/result.js';

const CLOCK = expectOk(
  makeClock('AMD', [
    { kind: 'fixed', target: '0:00', cart: 'J0001' },
    { kind: 'music', target: '0:08', category: 'A' },
    { kind: 'music', target: '3:50', category: 'B' },
    { kind: 'stopset', target: '7:30', name: 'break one' },
    { kind: 'news', target: '10:00', length: '3:00' },
  ]),
);

const ELEMENTS: readonly ClockElement[] = CLOCK.elements;

describe('budgetFor', () => {
  it('gives news the tightest budget and music none at all', () => {
    expect(budgetFor(ELEMENTS[4] as ClockElement, DEFAULT_DRIFT_BUDGET)).toBe(50);
    expect(budgetFor(ELEMENTS[3] as ClockElement, DEFAULT_DRIFT_BUDGET)).toBe(300);
    expect(budgetFor(ELEMENTS[0] as ClockElement, DEFAULT_DRIFT_BUDGET)).toBe(150);
    expect(budgetFor(ELEMENTS[1] as ClockElement, DEFAULT_DRIFT_BUDGET)).toBeUndefined();
  });

  it('honours a budget that does hold music to its target', () => {
    const strict = { ...DEFAULT_DRIFT_BUDGET, music: tenths(200) };
    expect(budgetFor(ELEMENTS[1] as ClockElement, strict)).toBe(200);
  });
});

describe('measureDrift', () => {
  it('reports zero drift when everything lands on target', () => {
    const actuals = ELEMENTS.map((e) => e.target);
    const drifts = measureDrift(ELEMENTS, actuals);
    expect(drifts).toHaveLength(5);
    expect(drifts.every((d) => d.drift === 0)).toBe(true);
    expect(drifts.every((d) => !d.breached)).toBe(true);
  });

  it('signs the drift late positive and early negative', () => {
    const actuals = ELEMENTS.map((e) => tenths(e.target + 20));
    expect(measureDrift(ELEMENTS, actuals).every((d) => d.drift === 20)).toBe(true);
    const early = ELEMENTS.map((e) => tenths(e.target - 20));
    expect(measureDrift(ELEMENTS, early).every((d) => d.drift === -20)).toBe(true);
  });

  it('never breaches a music element however far it drifts', () => {
    const actuals = ELEMENTS.map((e) => tenths(e.target + 900));
    const drifts = measureDrift(ELEMENTS, actuals);
    const music = drifts.filter((d) => d.position === 1 || d.position === 2);
    expect(music.every((d) => !d.breached)).toBe(true);
    expect(music.every((d) => d.budget === undefined)).toBe(true);
  });

  it('breaches news at six seconds late but not at five', () => {
    const onBudget = ELEMENTS.map((e) => (e.kind === 'news' ? tenths(e.target + 50) : e.target));
    const overBudget = ELEMENTS.map((e) => (e.kind === 'news' ? tenths(e.target + 51) : e.target));
    expect(measureDrift(ELEMENTS, onBudget).some((d) => d.breached)).toBe(false);
    expect(measureDrift(ELEMENTS, overBudget).some((d) => d.breached)).toBe(true);
  });

  it('breaches early as readily as late', () => {
    const early = ELEMENTS.map((e) => (e.kind === 'news' ? tenths(e.target - 90) : e.target));
    const breached = measureDrift(ELEMENTS, early).filter((d) => d.breached);
    expect(breached).toHaveLength(1);
    expect(breached[0]?.drift).toBe(-90);
  });

  it('skips an element with no actual time supplied', () => {
    expect(measureDrift(ELEMENTS, [tenths(0), tenths(80)])).toHaveLength(2);
    expect(measureDrift(ELEMENTS, [])).toEqual([]);
  });

  it('shows drift accumulating down the hour rather than staying put', () => {
    const creeping = ELEMENTS.map((e, index) => tenths(e.target + index * 15));
    const drifts = measureDrift(ELEMENTS, creeping);
    expect(drifts.map((d) => d.drift)).toEqual([0, 15, 30, 45, 60]);
    expect(drifts[4]?.breached).toBe(true);
    expect(drifts[3]?.breached).toBe(false);
  });
});

describe('worstDrift', () => {
  it('finds the largest drift by magnitude, ignoring unbudgeted music', () => {
    const actuals = ELEMENTS.map((e) =>
      e.kind === 'music' ? tenths(e.target + 5000) : tenths(e.target - 120),
    );
    const worst = worstDrift(measureDrift(ELEMENTS, actuals));
    expect(worst?.drift).toBe(-120);
    expect(worst?.position).not.toBe(1);
  });

  it('returns undefined when nothing has a budget', () => {
    const musicOnly = ELEMENTS.filter((e) => e.kind === 'music');
    const actuals = musicOnly.map((e) => e.target);
    expect(worstDrift(measureDrift(musicOnly, actuals))).toBeUndefined();
    expect(worstDrift([])).toBeUndefined();
  });
});

describe('driftProblems', () => {
  it('reports nothing when nothing breached', () => {
    expect(
      driftProblems(
        ELEMENTS,
        measureDrift(
          ELEMENTS,
          ELEMENTS.map((e) => e.target),
        ),
      ),
    ).toEqual([]);
  });

  it('calls a late news an error and says it joined in progress', () => {
    const actuals = ELEMENTS.map((e) => (e.kind === 'news' ? tenths(e.target + 200) : e.target));
    const problems = driftProblems(ELEMENTS, measureDrift(ELEMENTS, actuals));
    expect(problems[0]?.code).toBe('SCH-010');
    expect(problems[0]?.severity).toBe('error');
    expect(problems[0]?.message).toContain('in progress');
  });

  it('calls an early news an error too but words it the other way', () => {
    const actuals = ELEMENTS.map((e) => (e.kind === 'news' ? tenths(e.target - 200) : e.target));
    const problems = driftProblems(ELEMENTS, measureDrift(ELEMENTS, actuals));
    expect(problems[0]?.severity).toBe('error');
    expect(problems[0]?.message).toContain('early');
  });

  it('calls a late stopset only a warning', () => {
    const actuals = ELEMENTS.map((e) => (e.kind === 'stopset' ? tenths(e.target + 400) : e.target));
    const problems = driftProblems(ELEMENTS, measureDrift(ELEMENTS, actuals));
    expect(problems[0]?.code).toBe('SCH-011');
    expect(problems[0]?.severity).toBe('warning');
    expect(problems[0]?.detail?.['budget']).toBe(300);
  });
});

describe('hourDrift', () => {
  it('is positive when the hour runs long and negative when it runs short', () => {
    expect(hourDrift(tenths(HOUR_TENTHS + 45), tenths(HOUR_TENTHS))).toBe(45);
    expect(hourDrift(tenths(HOUR_TENTHS - 45), tenths(HOUR_TENTHS))).toBe(-45);
    expect(hourDrift(tenths(HOUR_TENTHS), tenths(HOUR_TENTHS))).toBe(0);
  });
});
