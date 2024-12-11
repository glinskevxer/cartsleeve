/**
 * Ordering and grouping.
 *
 * Rotation is an ordering problem, and the ordering has to be stable and total.
 * Two carts that tie on rest must come out in the same order on every run of
 * the scheduler, or a rerun of the same day produces a different log and the
 * breach report stops being reproducible. Every comparator here is total, and
 * every sort is stable.
 */

export type Comparator<T> = (a: T, b: T) => number;

export function ascending(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function descending(a: number, b: number): number {
  return ascending(b, a);
}

/** Case insensitive first, then case sensitive, so the order is still total. */
export function compareText(a: string, b: string): number {
  const left = a.toUpperCase();
  const right = b.toUpperCase();
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function by<T>(key: (item: T) => number, direction: 'asc' | 'desc' = 'asc'): Comparator<T> {
  return (a, b) => (direction === 'asc' ? ascending(key(a), key(b)) : descending(key(a), key(b)));
}

export function byText<T>(key: (item: T) => string): Comparator<T> {
  return (a, b) => compareText(key(a), key(b));
}

/** Run comparators in order and take the first that separates the two items. */
export function thenBy<T>(...comparators: readonly Comparator<T>[]): Comparator<T> {
  return (a, b) => {
    for (const comparator of comparators) {
      const verdict = comparator(a, b);
      if (verdict !== 0) {
        return verdict;
      }
    }
    return 0;
  };
}

/** Sort a copy. The input is never reordered, because callers share lists. */
export function sorted<T>(items: readonly T[], comparator: Comparator<T>): T[] {
  return [...items].sort(comparator);
}

export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const bucket = groups.get(key(item));
    if (bucket === undefined) {
      groups.set(key(item), [item]);
    } else {
      bucket.push(item);
    }
  }
  return groups;
}

export function countBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) {
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  }
  return counts;
}

export function indexBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T> {
  const index = new Map<K, T>();
  for (const item of items) {
    index.set(key(item), item);
  }
  return index;
}

/** Keep the first of each key, which is what a rotation pass wants on a tie. */
export function distinctBy<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

export function minBy<T>(items: readonly T[], key: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestKey = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const value = key(item);
    if (value < bestKey) {
      bestKey = value;
      best = item;
    }
  }
  return best;
}

export function maxBy<T>(items: readonly T[], key: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestKey = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const value = key(item);
    if (value > bestKey) {
      bestKey = value;
      best = item;
    }
  }
  return best;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

/**
 * How evenly a set of counts is spread, from 0 for perfectly even to 1 for
 * everything in one bucket. Rotation balance is reported with this rather than
 * a standard deviation because a programme director reads it as a percentage.
 */
export function spread(counts: readonly number[]): number {
  if (counts.length <= 1) {
    return 0;
  }
  const total = sum(counts);
  if (total === 0) {
    return 0;
  }
  const even = total / counts.length;
  const deviation = sum(counts.map((count) => Math.abs(count - even)));
  return deviation / (2 * total * (1 - 1 / counts.length));
}
