/**
 * Appending to a journal and reading it back.
 *
 * The writer holds the next sequence number rather than reading it off disk
 * before every append, because reading a growing file to decide what to write
 * to it makes every append cost the whole history.
 *
 * A record is written as one complete line in one call. That is the entire
 * crash safety story and it is enough: a process killed mid append leaves a
 * partial last line, the reader drops it, and everything before it is intact.
 * Anything more elaborate needs a second file and a fsync ordering guarantee
 * that a plain file store cannot give.
 *
 * Reads go through an index built once when the journal is opened and extended
 * on every append. Before that every read decoded the whole file: asking for the
 * last ten records on a year old journal parsed a million lines to throw away
 * all but ten, and an operator refreshing a tail view did it once a second.
 */

import type { Problem } from '../util/problem.js';
import { decodeJournal, encodeRecord, nextSequence } from './journal.js';
import type { JournalRecord } from './journal.js';
import type { Storage } from './storage.js';
import { Table } from './table.js';

export const JOURNAL_NAME = 'journal.tsv';

export class Journal {
  private sequence: number;

  private constructor(
    private readonly storage: Storage,
    private readonly name: string,
    private readonly table: Table<JournalRecord>,
    private readonly readProblems: readonly Problem[],
    sequence: number,
  ) {
    this.sequence = sequence;
  }

  /** Open a journal, indexing what is already there. */
  static open(storage: Storage, name: string = JOURNAL_NAME): Journal {
    const read = decodeJournal(storage.read(name));
    const table = new Table<JournalRecord>({ indexes: { kind: (record) => record.kind } });
    table.addAll(
      read.records.map((record) => ({ sequence: record.sequence, at: record.at, value: record })),
    );
    return new Journal(storage, name, table, read.problems, nextSequence(read.records));
  }

  get nextSequence(): number {
    return this.sequence;
  }

  append(kind: string, payload: Readonly<Record<string, unknown>>, at: number): JournalRecord {
    const record: JournalRecord = { sequence: this.sequence, at, kind, payload };
    this.storage.append(
      this.name,
      `${encodeRecord(record)}
`,
    );
    this.table.add({ sequence: record.sequence, at: record.at, value: record });
    this.sequence += 1;
    return record;
  }

  appendMany(
    entries: readonly { kind: string; payload: Readonly<Record<string, unknown>> }[],
    at: number,
  ): JournalRecord[] {
    return entries.map((entry) => this.append(entry.kind, entry.payload, at));
  }

  /** Everything in the journal, in order. */
  readAll(): { records: readonly JournalRecord[]; problems: readonly Problem[] } {
    return {
      records: this.table.all().map((row) => row.value),
      problems: this.readProblems,
    };
  }

  /** The last few records, which is what an operator actually looks at. */
  tail(count: number): JournalRecord[] {
    return this.table.tail(count).map((row) => row.value);
  }

  /** Records of one kind, for replaying a single projection. */
  ofKind(kind: string): JournalRecord[] {
    return this.table.by('kind', kind).map((row) => row.value);
  }

  /** Records written at or after a moment. */
  since(at: number): JournalRecord[] {
    return this.table.between(at, Number.MAX_SAFE_INTEGER).map((row) => row.value);
  }

  /** Records in a sequence range, both bounds inclusive. */
  range(fromSequence: number, toSequence: number): JournalRecord[] {
    return this.table.range(fromSequence, toSequence).map((row) => row.value);
  }

  /** The kinds the journal holds, which is what a projection asks first. */
  kinds(): string[] {
    return this.table.keys('kind');
  }

  get length(): number {
    return this.table.size;
  }
}
