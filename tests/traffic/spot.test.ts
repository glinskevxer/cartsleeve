import { describe, expect, it } from 'vitest';
import {
  inRunOrder,
  makeOrder,
  makeSpot,
  orderValueCents,
  runsIn,
  runsOn,
  totalLength,
} from '../../src/traffic/spot.js';
import type { OrderInput, SpotInput } from '../../src/traffic/spot.js';
import { expectErr, expectOk } from '../support/result.js';

const ORDER: OrderInput = {
  id: 'ORD-1041',
  advertiser: 'Hansen Feed and Seed',
  from: { year: 2025, month: 6, day: 1 },
  to: { year: 2025, month: 6, day: 30 },
  spots: 60,
  rateCents: 4500,
};

const SPOT: SpotInput = {
  id: 'SPT-1',
  orderId: 'ORD-1041',
  cart: 'C0455',
  length: '0:30',
};

describe('makeOrder', () => {
  it('builds an order and trims what it was given', () => {
    const order = expectOk(makeOrder({ ...ORDER, id: ' ORD-1041 ', advertiser: ' Hansen ' }));
    expect(order.id).toBe('ORD-1041');
    expect(order.advertiser).toBe('Hansen');
    expect(order.spots).toBe(60);
  });

  it('defaults to running in any daypart', () => {
    expect(expectOk(makeOrder(ORDER)).dayparts).toEqual([]);
  });

  it('keeps the dayparts it was sold into', () => {
    expect(expectOk(makeOrder({ ...ORDER, dayparts: ['AMD', 'PMD'] })).dayparts).toEqual([
      'AMD',
      'PMD',
    ]);
  });

  it('rejects an order with no number or no advertiser', () => {
    expect(expectErr(makeOrder({ ...ORDER, id: ' ' }))[0]?.code).toBe('TRF-001');
    expect(expectErr(makeOrder({ ...ORDER, advertiser: '' }))[0]?.code).toBe('TRF-002');
  });

  it('rejects an order that ends before it starts', () => {
    const problems = expectErr(makeOrder({ ...ORDER, from: { year: 2025, month: 7, day: 1 } }));
    expect(problems[0]?.code).toBe('TRF-003');
  });

  it('accepts an order that runs for one day', () => {
    const oneDay = { year: 2025, month: 6, day: 1 };
    expect(expectOk(makeOrder({ ...ORDER, from: oneDay, to: oneDay })).spots).toBe(60);
  });

  it('rejects an order that sold no spots', () => {
    expect(expectErr(makeOrder({ ...ORDER, spots: 0 }))[0]?.code).toBe('TRF-004');
    expect(expectErr(makeOrder({ ...ORDER, spots: 2.5 }))[0]?.code).toBe('TRF-004');
  });

  it('rejects a rate that is not whole cents', () => {
    expect(expectErr(makeOrder({ ...ORDER, rateCents: 45.5 }))[0]?.code).toBe('TRF-005');
    expect(expectErr(makeOrder({ ...ORDER, rateCents: -1 }))[0]?.code).toBe('TRF-005');
  });

  it('accepts a rate of nothing, which is a trade or a make good', () => {
    expect(expectOk(makeOrder({ ...ORDER, rateCents: 0 })).rateCents).toBe(0);
  });

  it('values the order at rate times spots', () => {
    expect(orderValueCents(expectOk(makeOrder(ORDER)))).toBe(60 * 4500);
  });
});

describe('when an order runs', () => {
  const order = () => expectOk(makeOrder({ ...ORDER, dayparts: ['AMD'] }));

  it('runs on both bounds of its dates', () => {
    expect(runsOn(order(), { year: 2025, month: 6, day: 1 })).toBe(true);
    expect(runsOn(order(), { year: 2025, month: 6, day: 30 })).toBe(true);
  });

  it('does not run outside them', () => {
    expect(runsOn(order(), { year: 2025, month: 5, day: 31 })).toBe(false);
    expect(runsOn(order(), { year: 2025, month: 7, day: 1 })).toBe(false);
  });

  it('runs only in the dayparts it was sold into', () => {
    expect(runsIn(order(), 'AMD')).toBe(true);
    expect(runsIn(order(), 'PMD')).toBe(false);
  });

  it('runs anywhere when no daypart was named', () => {
    const anywhere = expectOk(makeOrder(ORDER));
    expect(runsIn(anywhere, 'AMD')).toBe(true);
    expect(runsIn(anywhere, 'OVN')).toBe(true);
  });
});

describe('makeSpot', () => {
  it('builds a spot with its cart and length', () => {
    const spot = expectOk(makeSpot(SPOT));
    expect(spot.cart).toBe('C0455');
    expect(spot.length).toBe(300);
    expect(spot.priority).toBe(50);
  });

  it('takes a priority when one is given', () => {
    expect(expectOk(makeSpot({ ...SPOT, priority: 10 })).priority).toBe(10);
  });

  it('rejects a spot with no number or no order', () => {
    expect(expectErr(makeSpot({ ...SPOT, id: '' }))[0]?.code).toBe('TRF-010');
    expect(expectErr(makeSpot({ ...SPOT, orderId: ' ' }))[0]?.code).toBe('TRF-011');
  });

  it('rejects a bad cart number and a bad length', () => {
    expect(expectErr(makeSpot({ ...SPOT, cart: 'nope' }))[0]?.code).toBe('TRF-012');
    expect(expectErr(makeSpot({ ...SPOT, length: '30' }))[0]?.code).toBe('TRF-013');
  });

  it('reports every problem at once', () => {
    const problems = expectErr(makeSpot({ id: '', orderId: '', cart: 'nope', length: 'x' }));
    expect(problems.map((each) => each.code)).toEqual(['TRF-010', 'TRF-011', 'TRF-012', 'TRF-013']);
  });
});

describe('a break of spots', () => {
  const spots = () => [
    expectOk(makeSpot({ ...SPOT, id: 'SPT-3', priority: 90 })),
    expectOk(makeSpot({ ...SPOT, id: 'SPT-1', length: '1:00', priority: 10 })),
    expectOk(makeSpot({ ...SPOT, id: 'SPT-2', priority: 10 })),
  ];

  it('totals the length', () => {
    expect(totalLength(spots())).toBe(600 + 300 + 300);
    expect(totalLength([])).toBe(0);
  });

  it('runs the highest priority first', () => {
    expect(inRunOrder(spots()).map((each) => each.id)).toEqual(['SPT-1', 'SPT-2', 'SPT-3']);
  });

  it('breaks a priority tie on the spot number', () => {
    expect(inRunOrder(spots())[0]?.id).toBe('SPT-1');
  });

  it('does not reorder the list it was given', () => {
    const list = spots();
    inRunOrder(list);
    expect(list.map((each) => each.id)).toEqual(['SPT-3', 'SPT-1', 'SPT-2']);
  });
});
