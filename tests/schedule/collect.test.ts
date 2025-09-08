import { beforeEach, describe, expect, it } from 'vitest';
import { RELAXED_CODE, collectFrom, merge, relaxedFailures } from '../../src/schedule/collect.js';
import type { FilledSlot } from '../../src/schedule/hour.js';
import { tenths } from '../../src/util/duration.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { entry, resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const musicElement = (position: number) =>
  ({ kind: 'music', position, category: 'A' as CategoryCode, target: tenths(0) }) as const;

const stopsetElement = (position: number) =>
  ({ kind: 'stopset', position, name: 'break', target: tenths(0), budget: tenths(1200) }) as const;

function cleanSlot(position: number): FilledSlot {
  return {
    element: musicElement(position),
    at: tenths(0),
    length: tenths(1800),
    cart: 'M0001' as CartNumber,
    placement: {
      entry: entry({ number: 'M0001' }),
      score: { artist: 1, title: 1, recording: 1, sound: 1, flow: 1, staleness: 1, total: 11 },
      tier: 6,
      relaxedBy: 0,
      breached: [],
      considered: 1,
    },
  };
}

function breachedSlot(position: number): FilledSlot {
  const clean = cleanSlot(position);
  const placement = clean.placement;
  if (placement === undefined) {
    throw new Error('fixture has no placement');
  }
  return {
    ...clean,
    placement: { ...placement, tier: 3, relaxedBy: 3, breached: ['tempo flow', 'era spread'] },
  };
}

function holedSlot(position: number): FilledSlot {
  return {
    element: musicElement(position),
    at: tenths(0),
    length: tenths(0),
    hole: { reason: 'no candidates', rejections: [], considered: 0 },
  };
}

describe('relaxedFailures', () => {
  it('turns each given up rule into a failure above the settled tier', () => {
    const failures = relaxedFailures(['tempo flow', 'era spread'], 3);
    expect(failures).toHaveLength(2);
    expect(failures[0]?.rule).toBe('tempo flow');
    expect(failures[0]?.tier).toBe(4);
    expect(failures[0]?.code).toBe(RELAXED_CODE);
    expect(failures[0]?.shortfall).toBe(0);
  });

  it('produces nothing from no rules', () => {
    expect(relaxedFailures([], 3)).toEqual([]);
  });
});

describe('collectFrom', () => {
  it('finds nothing in a clean pass', () => {
    const collected = collectFrom([cleanSlot(0), cleanSlot(1)]);
    expect(collected.breaches).toEqual([]);
    expect(collected.holes).toEqual([]);
  });

  it('records a breach per rule given up', () => {
    const collected = collectFrom([breachedSlot(4)]);
    expect(collected.breaches).toHaveLength(2);
    expect(collected.breaches.map((each) => each.rule)).toEqual(['tempo flow', 'era spread']);
    expect(collected.breaches[0]?.position).toBe(4);
    expect(collected.breaches[0]?.cart).toBe('M0001');
  });

  it('records a hole with its diagnosis and category', () => {
    const collected = collectFrom([holedSlot(2)]);
    expect(collected.holes).toHaveLength(1);
    expect(collected.holes[0]?.position).toBe(2);
    expect(collected.holes[0]?.category).toBe('A');
    expect(collected.holes[0]?.diagnosis.cause).toBe('category empty');
  });

  it('names a non music element by its kind rather than a category', () => {
    const collected = collectFrom([
      {
        element: stopsetElement(3),
        at: tenths(0),
        length: tenths(0),
        hole: { reason: 'no candidates', rejections: [], considered: 0 },
      },
    ]);
    expect(collected.holes[0]?.category).toBe('stopset');
  });

  it('treats a hole as authoritative over a placement on the same slot', () => {
    const gap = holedSlot(1).hole;
    if (gap === undefined) {
      throw new Error('fixture has no hole');
    }
    const both: FilledSlot = { ...cleanSlot(1), hole: gap };
    const collected = collectFrom([both]);
    expect(collected.holes).toHaveLength(1);
    expect(collected.breaches).toEqual([]);
  });

  it('skips a slot with neither a placement nor a hole', () => {
    const bare: FilledSlot = { element: stopsetElement(5), at: tenths(0), length: tenths(1200) };
    expect(collectFrom([bare])).toEqual({ breaches: [], holes: [] });
  });

  it('collects across a mixed pass', () => {
    const collected = collectFrom([cleanSlot(0), breachedSlot(1), holedSlot(2)]);
    expect(collected.breaches).toHaveLength(2);
    expect(collected.holes).toHaveLength(1);
  });

  it('collects nothing from nothing', () => {
    expect(collectFrom([])).toEqual({ breaches: [], holes: [] });
  });
});

describe('merge', () => {
  it('folds several collections into one', () => {
    const merged = merge([collectFrom([breachedSlot(1)]), collectFrom([holedSlot(2)])]);
    expect(merged.breaches).toHaveLength(2);
    expect(merged.holes).toHaveLength(1);
  });

  it('folds nothing into an empty collection', () => {
    expect(merge([])).toEqual({ breaches: [], holes: [] });
  });
});
