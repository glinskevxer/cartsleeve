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
 */

import type { Problem } from '../util/problem.js';
import { decodeJournal, encodeRecord, nextSequence } from './journal.js';
import type { JournalRecord } from './journal.js';
import type { Storage } from './storage.js';

export const JOURNAL_NAME = 'journal.tsv';

export interface AppendOutcome {
  readonly record: JournalRecord;
}

export class Journal {
  private sequence: number;

  private constructor(
    private readonly storage: Storage,
    private readonly name: string,
    sequence: number,
  ) {
    this.sequence = sequence;
  }

  /** Open a journal, reading only far enough to know where to continue. */
  static open(storage: Storage, name: string = JOURNAL_NAME): Journal {
    const read = decodeJournal(storage.read(name));
    return new Journal(storage, name, nextSequence(read.records));
  }

  get nextSequence(): number {
    return this.sequence;
  }

  append(kind: string, payload: Readonly<Record<string, unknown>>, at: number): JournalRecord {
    const record: JournalRecord = { sequence: this.sequence, at, kind, payload };
    this.storage.append(this.name, `${encodeRecord(record)}\n`);
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
    const read = decodeJournal(this.storage.read(this.name));
    return { records: read.records, problems: read.problems };
  }

  /** The last few records, which is what an operator actually looks at. */
  tail(count: number): JournalRecord[] {
    const { records } = this.readAll();
    return records.slice(Math.max(0, records.length - count));
  }

  /** Records of one kind, for replaying a single projection. */
  ofKind(kind: string): JournalRecord[] {
    return this.readAll().records.filter((record) => record.kind === kind);
  }

  /** Records written at or after a moment. */
  since(at: number): JournalRecord[] {
    return this.readAll().records.filter((record) => record.at >= at);
  }

  get length(): number {
    return this.readAll().records.length;
  }
}
