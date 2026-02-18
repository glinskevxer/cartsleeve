/**
 * Rebuilding state from a snapshot and the records after it.
 *
 * The reader knows nothing about what the state is. It is given a starting value
 * and a function that applies one record, which keeps the store from having an
 * opinion about the library, the schedule or anything else. Every projection in
 * the system is built by handing this a different apply function.
 *
 * Two properties matter and both are tested rather than assumed. Replaying from
 * a snapshot must give the same state as replaying the whole journal, or a
 * snapshot is a corruption rather than an optimisation. And an unknown record
 * kind must be skipped rather than failing the replay, because a journal written
 * by a newer version of the software has to remain readable by an older one for
 * as long as it takes somebody to notice and roll forward.
 */

import { codeFor, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { JournalRecord } from './journal.js';
import { latestSnapshot, checkAgainstJournal } from './snapshot.js';
import type { Snapshot } from './snapshot.js';
import type { Storage } from './storage.js';

const RPL = (n: number): string => codeFor('store', n);

export const UNKNOWN_KIND = RPL(20);
export const APPLY_FAILED = RPL(21);

/** Apply one record. Returning undefined means the kind is not understood. */
export type Apply<T> = (state: T, record: JournalRecord) => T | undefined;

export interface ReplayOutcome<T> {
  readonly state: T;
  /** How many records were applied on top of whatever it started from. */
  readonly applied: number;
  readonly skipped: number;
  /** Where the state now stands, as a journal sequence. */
  readonly throughSequence: number;
  readonly problems: readonly Problem[];
  /** True when it started from a snapshot rather than from the beginning. */
  readonly fromSnapshot: boolean;
}

/** Apply a run of records to a starting state. */
export function replayRecords<T>(
  initial: T,
  records: readonly JournalRecord[],
  apply: Apply<T>,
): ReplayOutcome<T> {
  let state = initial;
  let applied = 0;
  let skipped = 0;
  let through = 0;
  const problems: Problem[] = [];
  const unknown = new Set<string>();

  for (const record of records) {
    let next: T | undefined;
    try {
      next = apply(state, record);
    } catch (thrown) {
      problems.push(
        warning(APPLY_FAILED, String(record.sequence), 'could not be applied', {
          kind: record.kind,
          reason: thrown instanceof Error ? thrown.message : 'unknown',
        }),
      );
      skipped += 1;
      through = record.sequence;
      continue;
    }
    if (next === undefined) {
      skipped += 1;
      if (!unknown.has(record.kind)) {
        unknown.add(record.kind);
        problems.push(
          info(UNKNOWN_KIND, record.kind, 'is a record kind this version does not understand'),
        );
      }
      through = record.sequence;
      continue;
    }
    state = next;
    applied += 1;
    through = record.sequence;
  }

  return {
    state,
    applied,
    skipped,
    throughSequence: through,
    problems,
    fromSnapshot: false,
  };
}

export interface ReplayInput<T> {
  readonly storage: Storage;
  readonly records: readonly JournalRecord[];
  readonly empty: T;
  readonly apply: Apply<T>;
  /** Skip the snapshot and replay everything. Used to verify the two agree. */
  readonly ignoreSnapshots?: boolean;
}

/**
 * Load the newest snapshot and apply everything after it.
 *
 * Falls back to a full replay whenever there is no usable snapshot, which makes
 * a corrupt snapshot a slow start rather than an outage.
 */
export function replay<T>(input: ReplayInput<T>): ReplayOutcome<T> {
  if (input.ignoreSnapshots === true) {
    return replayRecords(input.empty, input.records, input.apply);
  }
  const found = latestSnapshot<T>(input.storage);
  const snapshot = found.snapshot;
  if (snapshot === undefined) {
    const outcome = replayRecords(input.empty, input.records, input.apply);
    return { ...outcome, problems: [...found.problems, ...outcome.problems] };
  }
  const highest = input.records.reduce((max, record) => Math.max(max, record.sequence), 0);
  const ahead = checkAgainstJournal(snapshot, highest);
  const after = input.records.filter((record) => record.sequence > snapshot.throughSequence);
  const outcome = replayRecords(snapshot.state, after, input.apply);
  return {
    ...outcome,
    throughSequence: Math.max(snapshot.throughSequence, outcome.throughSequence),
    fromSnapshot: true,
    problems: [...found.problems, ...(ahead === undefined ? [] : [ahead]), ...outcome.problems],
  };
}

/** Build a snapshot of whatever a replay produced. */
export function snapshotOf<T>(outcome: ReplayOutcome<T>, at: number): Snapshot<T> {
  return { throughSequence: outcome.throughSequence, at, state: outcome.state };
}
