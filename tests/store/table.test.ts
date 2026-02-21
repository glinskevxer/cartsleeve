import { describe, expect, it } from 'vitest';
import { Table } from '../../src/store/table.js';
import type { TableRow } from '../../src/store/table.js';

const BASE = 1_700_000_000_000;

interface Play {
  readonly cart: string;
  readonly category: string;
}

const row = (sequence: number, cart: string, category = 'A'): TableRow<Play> => ({
  sequence,
  at: BASE + sequence * 1000,
  value: { cart, category },
});

function table(): Table<Play> {
  return new Table<Play>({
    indexes: {
      cart: (play) => play.cart,
      category: (play) => play.category,
    },
  });
}

function filled(): Table<Play> {
  const built = table();
  built.addAll([
    row(1, 'M0001', 'A'),
    row(2, 'M0002', 'A'),
    row(3, 'M0001', 'G'),
    row(4, 'M0003', 'G'),
  ]);
  return built;
}

describe('adding rows', () => {
  it('counts what it holds', () => {
    expect(filled().size).toBe(4);
    expect(table().size).toBe(0);
  });

  it('keeps the rows in sequence order when they arrive in order', () => {
    expect(
      filled()
        .all()
        .map((each) => each.sequence),
    ).toEqual([1, 2, 3, 4]);
    expect(filled().isOrdered()).toBe(true);
  });

  it('inserts a row that arrives out of order into its place', () => {
    const built = table();
    built.addAll([row(3, 'M0003'), row(1, 'M0001'), row(2, 'M0002')]);
    expect(built.all().map((each) => each.sequence)).toEqual([1, 2, 3]);
    expect(built.isOrdered()).toBe(true);
  });

  it('reports the highest sequence it holds', () => {
    expect(filled().highestSequence).toBe(4);
    expect(table().highestSequence).toBe(0);
  });
});

describe('indexes', () => {
  it('finds rows by an indexed key without walking', () => {
    expect(
      filled()
        .by('cart', 'M0001')
        .map((each) => each.sequence),
    ).toEqual([1, 3]);
    expect(filled().by('category', 'G')).toHaveLength(2);
  });

  it('finds nothing for a key nothing has', () => {
    expect(filled().by('cart', 'M9999')).toEqual([]);
  });

  it('finds nothing for an index that was never declared', () => {
    expect(filled().by('nothing', 'M0001')).toEqual([]);
  });

  it('lists the distinct keys of an index', () => {
    expect(filled().keys('cart')).toEqual(['M0001', 'M0002', 'M0003']);
    expect(filled().keys('category')).toEqual(['A', 'G']);
    expect(filled().keys('nothing')).toEqual([]);
  });

  it('hands back a copy, so a caller cannot corrupt the index', () => {
    const built = filled();
    built.by('cart', 'M0001').push(row(9, 'M9999'));
    expect(built.by('cart', 'M0001')).toHaveLength(2);
  });
});

describe('sequence ranges', () => {
  it('takes both bounds inclusively', () => {
    expect(
      filled()
        .range(2, 3)
        .map((each) => each.sequence),
    ).toEqual([2, 3]);
    expect(filled().range(1, 4)).toHaveLength(4);
  });

  it('takes a single sequence', () => {
    expect(
      filled()
        .range(2, 2)
        .map((each) => each.sequence),
    ).toEqual([2]);
  });

  it('takes nothing from a backwards range', () => {
    expect(filled().range(3, 2)).toEqual([]);
  });

  it('takes nothing outside what it holds', () => {
    expect(filled().range(9, 12)).toEqual([]);
  });

  it('takes everything from a sequence onward', () => {
    expect(
      filled()
        .from(3)
        .map((each) => each.sequence),
    ).toEqual([3, 4]);
    expect(filled().from(1)).toHaveLength(4);
    expect(filled().from(99)).toEqual([]);
  });

  it('finds a range that is not present as bounds', () => {
    const built = table();
    built.addAll([row(1, 'a'), row(5, 'b'), row(9, 'c')]);
    expect(built.range(2, 8).map((each) => each.sequence)).toEqual([5]);
  });
});

describe('tail and time', () => {
  it('takes the last few rows', () => {
    expect(
      filled()
        .tail(2)
        .map((each) => each.sequence),
    ).toEqual([3, 4]);
    expect(filled().tail(99)).toHaveLength(4);
    expect(filled().tail(0)).toEqual([]);
    expect(filled().tail(-3)).toEqual([]);
  });

  it('takes rows in a time range, inclusive', () => {
    expect(filled().between(BASE + 2000, BASE + 3000)).toHaveLength(2);
    expect(filled().between(BASE + 9000, BASE + 9999)).toEqual([]);
  });
});

describe('the binary search agrees with a filter', () => {
  it('gives the same rows as walking them would', () => {
    const built = table();
    for (let sequence = 1; sequence <= 200; sequence += 1) {
      built.add(row(sequence, `M${sequence}`));
    }
    for (const [from, to] of [
      [1, 200],
      [50, 150],
      [7, 7],
      [199, 400],
      [0, 3],
    ]) {
      const searched = built.range(from ?? 0, to ?? 0).map((each) => each.sequence);
      const walked = built
        .all()
        .filter((each) => each.sequence >= (from ?? 0) && each.sequence <= (to ?? 0))
        .map((each) => each.sequence);
      expect(searched).toEqual(walked);
    }
  });
});
