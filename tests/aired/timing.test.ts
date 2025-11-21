import { describe, expect, it } from 'vitest';
import {
  NEVER_RECOVERED,
  NORMAL_SLIP_MS,
  RAN_EARLY,
  RAN_LATE,
  SERIOUS_SLIP_MS,
  auditTiming,
  isEarly,
  isLate,
  measureRecovery,
  measureTiming,
  worstFirst,
} from '../../src/aired/timing.js';
import type { PlannedStart } from '../../src/aired/timing.js';
import type { Airing } from '../../src/aired/rebuild.js';
import type { CartNumber } from '../../src/util/ids.js';

const cart = (value: string): CartNumber => value as CartNumber;
const BASE = 1_700_000_000_000;

const planned = (carts: readonly string[]): PlannedStart[] =>
  carts.map((number, index) => ({
    cart: cart(number),
    position: index,
    at: BASE + index * 180_000,
  }));

const airing = (number: string, at: number): Airing => ({
  cart: cart(number),
  startedAt: at,
  endedAt: at + 180_000,
  length: 180_000,
  orphan: false,
  note: '',
});

/** Three carts, each `slips` milliseconds later than planned. */
const slipping = (slips: readonly number[]): Airing[] =>
  slips.map((slip, index) => airing(`M000${index + 1}`, BASE + index * 180_000 + slip));

const THREE = ['M0001', 'M0002', 'M0003'];

describe('measureTiming', () => {
  it('reports no deviation when everything ran to plan', () => {
    const found = measureTiming(planned(THREE), slipping([0, 0, 0]));
    expect(found).toHaveLength(3);
    expect(found.every((each) => each.by === 0)).toBe(true);
  });

  it('signs a late start positive and an early one negative', () => {
    const found = measureTiming(planned(THREE), slipping([20_000, -20_000, 0]));
    expect(found[0]?.by).toBe(20_000);
    expect(found[1]?.by).toBe(-20_000);
  });

  it('orders by position however the airings arrive', () => {
    const found = measureTiming(planned(THREE), [...slipping([0, 0, 0])].reverse());
    expect(found.map((each) => each.position)).toEqual([0, 1, 2]);
  });

  it('skips a planned cart that never aired', () => {
    const found = measureTiming(planned(THREE), [airing('M0001', BASE)]);
    expect(found).toHaveLength(1);
    expect(found[0]?.cart).toBe('M0001');
  });

  it('matches two plays of one cart to two plannings, in order', () => {
    const twice: PlannedStart[] = [
      { cart: cart('M0001'), position: 0, at: BASE },
      { cart: cart('M0001'), position: 1, at: BASE + 180_000 },
    ];
    const found = measureTiming(twice, [
      airing('M0001', BASE + 1000),
      airing('M0001', BASE + 181_000),
    ]);
    expect(found.map((each) => each.by)).toEqual([1000, 1000]);
  });

  it('measures nothing against nothing', () => {
    expect(measureTiming([], [])).toEqual([]);
    expect(measureTiming(planned(THREE), [])).toEqual([]);
  });
});

describe('what counts as late', () => {
  it('ignores slippage inside the normal band', () => {
    const found = measureTiming(planned(THREE), slipping([NORMAL_SLIP_MS, 0, 0]));
    expect(isLate(found[0] as never)).toBe(false);
    expect(isEarly(found[0] as never)).toBe(false);
  });

  it('calls anything past it late or early', () => {
    const found = measureTiming(
      planned(THREE),
      slipping([NORMAL_SLIP_MS + 1, -NORMAL_SLIP_MS - 1, 0]),
    );
    expect(isLate(found[0] as never)).toBe(true);
    expect(isEarly(found[1] as never)).toBe(true);
  });
});

describe('measureRecovery', () => {
  it('reports an hour that ran to plan as recovered', () => {
    const recovery = measureRecovery(measureTiming(planned(THREE), slipping([0, 0, 0])));
    expect(recovery.worst).toBe(0);
    expect(recovery.recovered).toBe(true);
  });

  it('reports an hour that slipped and caught up as recovered', () => {
    const recovery = measureRecovery(measureTiming(planned(THREE), slipping([40_000, 20_000, 0])));
    expect(recovery.worst).toBe(40_000);
    expect(recovery.finished).toBe(0);
    expect(recovery.recovered).toBe(true);
  });

  it('reports an hour that never caught up', () => {
    const recovery = measureRecovery(measureTiming(planned(THREE), slipping([0, 40_000, 90_000])));
    expect(recovery.finished).toBe(90_000);
    expect(recovery.recovered).toBe(false);
  });

  it('keeps the sign of the worst deviation', () => {
    const recovery = measureRecovery(measureTiming(planned(THREE), slipping([0, -40_000, 0])));
    expect(recovery.worst).toBe(-40_000);
  });

  it('reports an empty hour as recovered', () => {
    expect(measureRecovery([])).toEqual({ worst: 0, finished: 0, recovered: true });
  });
});

describe('auditTiming', () => {
  it('says nothing about an hour that ran to plan', () => {
    expect(auditTiming(measureTiming(planned(THREE), slipping([0, 0, 0])))).toEqual([]);
  });

  it('warns about a late start and errors on a serious one', () => {
    const mild = auditTiming(measureTiming(planned(THREE), slipping([20_000, 0, 0])));
    expect(mild[0]?.code).toBe(RAN_LATE);
    expect(mild[0]?.severity).toBe('warning');
    const bad = auditTiming(
      measureTiming(planned(THREE), slipping([SERIOUS_SLIP_MS + 1000, 0, 0])),
    );
    expect(bad[0]?.severity).toBe('error');
  });

  it('notes an early start at info only', () => {
    const found = auditTiming(measureTiming(planned(THREE), slipping([-20_000, 0, 0])));
    expect(found[0]?.code).toBe(RAN_EARLY);
    expect(found[0]?.severity).toBe('info');
    expect(found[0]?.detail?.['seconds']).toBe(20);
  });

  it('warns once when the hour never came back on time', () => {
    const found = auditTiming(measureTiming(planned(THREE), slipping([0, 40_000, 90_000])));
    expect(found.filter((each) => each.code === NEVER_RECOVERED)).toHaveLength(1);
  });

  it('says nothing about recovery when the hour caught up', () => {
    const found = auditTiming(measureTiming(planned(THREE), slipping([40_000, 20_000, 0])));
    expect(found.map((each) => each.code)).not.toContain(NEVER_RECOVERED);
  });
});

describe('worstFirst', () => {
  it('puts the largest deviation first whichever way it went', () => {
    const found = worstFirst(measureTiming(planned(THREE), slipping([20_000, -90_000, 40_000])));
    expect(found.map((each) => each.position)).toEqual([1, 2, 0]);
  });

  it('leaves out anything inside the normal band', () => {
    expect(worstFirst(measureTiming(planned(THREE), slipping([0, 5000, 0])))).toEqual([]);
  });
});
