/**
 * An indexed table over journal records.
 *
 * Every read on the journal so far walks the whole file: records of a kind,
 * records since a time, the last few. That is fine at a thousand records and
 * unusable at a million, which is where a station lands after a couple of years.
 *
 * A table is a list of rows plus indexes built once as rows are added. It knows
 * nothing about music; it holds whatever the caller extracts from a record, and
 * indexes it by whatever keys the caller names. Two projections wanting different
 * indexes over the same journal build two tables rather than one table trying to
 * satisfy both.
 *
 * Insertion keeps the rows in sequence order, which lets the time range query
 * binary search rather than filter. That is the one thing here that is not
 * obvious from the shape and it is the only reason the table is worth having.
 */

import { ascending } from '../util/ordering.js';

export interface TableRow<T> {
  /** The journal sequence this row came from, unique and ascending. */
  readonly sequence: number;
  readonly at: number;
  readonly value: T;
}

export type KeyOf<T> = (value: T) => string;

export interface TableSpec<T> {
  /** Named indexes, each extracting one key from a row. */
  readonly indexes: Readonly<Record<string, KeyOf<T>>>;
}

export class Table<T> {
  private readonly rows: TableRow<T>[] = [];
  private readonly indexes = new Map<string, Map<string, TableRow<T>[]>>();

  constructor(private readonly spec: TableSpec<T>) {
    for (const name of Object.keys(spec.indexes)) {
      this.indexes.set(name, new Map<string, TableRow<T>[]>());
    }
  }

  get size(): number {
    return this.rows.length;
  }

  /**
   * Add a row. Appends when the sequence is the highest so far, which is the
   * ordinary case, and inserts otherwise so the rows stay ordered whatever order
   * they arrive in.
   */
  add(row: TableRow<T>): void {
    const last = this.rows[this.rows.length - 1];
    if (last === undefined || row.sequence > last.sequence) {
      this.rows.push(row);
    } else {
      this.rows.splice(this.upperBound(row.sequence), 0, row);
    }
    for (const [name, key] of Object.entries(this.spec.indexes)) {
      const index = this.indexes.get(name);
      if (index === undefined) {
        continue;
      }
      const value = key(row.value);
      const bucket = index.get(value);
      if (bucket === undefined) {
        index.set(value, [row]);
      } else {
        bucket.push(row);
      }
    }
  }

  addAll(rows: readonly TableRow<T>[]): void {
    for (const row of rows) {
      this.add(row);
    }
  }

  /** Rows matching an indexed key, without walking the table. */
  by(index: string, key: string): TableRow<T>[] {
    return [...(this.indexes.get(index)?.get(key) ?? [])];
  }

  /** The distinct keys an index holds. */
  keys(index: string): string[] {
    return [...(this.indexes.get(index)?.keys() ?? [])].sort();
  }

  /** First row whose sequence is at least this, by binary search. */
  private lowerBound(sequence: number): number {
    let low = 0;
    let high = this.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.rows[middle]?.sequence ?? 0) < sequence) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  /** First row whose sequence is greater than this. */
  private upperBound(sequence: number): number {
    let low = 0;
    let high = this.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.rows[middle]?.sequence ?? 0) <= sequence) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  /** Rows in a sequence range, both bounds inclusive. */
  range(fromSequence: number, toSequence: number): TableRow<T>[] {
    if (toSequence < fromSequence) {
      return [];
    }
    return this.rows.slice(this.lowerBound(fromSequence), this.upperBound(toSequence));
  }

  /** Rows from a sequence onward. */
  from(sequence: number): TableRow<T>[] {
    return this.rows.slice(this.lowerBound(sequence));
  }

  /** The last few rows, which is what an operator looks at. */
  tail(count: number): TableRow<T>[] {
    return this.rows.slice(Math.max(0, this.rows.length - Math.max(0, count)));
  }

  all(): TableRow<T>[] {
    return [...this.rows];
  }

  /** Rows in a time range. Times are not indexed, so this walks. */
  between(from: number, to: number): TableRow<T>[] {
    return this.rows.filter((row) => row.at >= from && row.at <= to);
  }

  get highestSequence(): number {
    return this.rows.reduce((max, row) => Math.max(max, row.sequence), 0);
  }

  /** Whether the rows are in ascending sequence order, which they must be. */
  isOrdered(): boolean {
    for (let index = 1; index < this.rows.length; index += 1) {
      if (ascending(this.rows[index - 1]?.sequence ?? 0, this.rows[index]?.sequence ?? 0) > 0) {
        return false;
      }
    }
    return true;
  }
}
