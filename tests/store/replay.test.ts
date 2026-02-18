import { describe, expect, it } from 'vitest';
import {
  APPLY_FAILED,
  UNKNOWN_KIND,
  replay,
  replayRecords,
  snapshotOf,
} from '../../src/store/replay.js';
import type { Apply } from '../../src/store/replay.js';
import { writeSnapshot } from '../../src/store/snapshot.js';
import { snapshotName } from '../../src/store/snapshot.js';
import { MemoryStorage } from '../../src/store/storage.js';
import type { JournalRecord } from '../../src/store/journal.js';

const BASE = 1_700_000_000_000;

/** A counter, so the projection under test is not itself interesting. */
interface Counter {
  readonly added: number;
  readonly removed: number;
}

const EMPTY: Counter = { added: 0, removed: 0 };

const apply: Apply<Counter> = (state, record) => {
  if (record.kind === 'added') {
    return { ...state, added: state.added + 1 };
  }
  if (record.kind === 'removed') {
    return { ...state, removed: state.removed + 1 };
  }
  if (record.kind === 'explodes') {
    throw new Error('this record cannot be applied');
  }
  return undefined;
};

const record = (sequence: number, kind: string): JournalRecord => ({
  sequence,
  at: BASE + sequence,
  kind,
  payload: {},
});

const RECORDS = [record(1, 'added'), record(2, 'added'), record(3, 'removed'), record(4, 'added')];

describe('replayRecords', () => {
  it('applies every record it understands', () => {
    const outcome = replayRecords(EMPTY, RECORDS, apply);
    expect(outcome.state).toEqual({ added: 3, removed: 1 });
    expect(outcome.applied).toBe(4);
    expect(outcome.skipped).toBe(0);
    expect(outcome.throughSequence).toBe(4);
  });

  it('skips a kind it does not understand rather than failing', () => {
    const outcome = replayRecords(EMPTY, [...RECORDS, record(5, 'from the future')], apply);
    expect(outcome.applied).toBe(4);
    expect(outcome.skipped).toBe(1);
    expect(outcome.throughSequence).toBe(5);
    expect(outcome.problems[0]?.code).toBe(UNKNOWN_KIND);
  });

  it('reports an unknown kind once however often it appears', () => {
    const outcome = replayRecords(
      EMPTY,
      [record(1, 'from the future'), record(2, 'from the future')],
      apply,
    );
    expect(outcome.problems).toHaveLength(1);
    expect(outcome.skipped).toBe(2);
  });

  it('survives an apply that throws', () => {
    const outcome = replayRecords(EMPTY, [record(1, 'added'), record(2, 'explodes')], apply);
    expect(outcome.state).toEqual({ added: 1, removed: 0 });
    expect(outcome.problems[0]?.code).toBe(APPLY_FAILED);
    expect(outcome.skipped).toBe(1);
  });

  it('replays nothing onto the starting state', () => {
    const outcome = replayRecords(EMPTY, [], apply);
    expect(outcome.state).toBe(EMPTY);
    expect(outcome.throughSequence).toBe(0);
  });
});

describe('replay against a store', () => {
  it('replays the whole journal when there is no snapshot', () => {
    const outcome = replay({
      storage: new MemoryStorage(),
      records: RECORDS,
      empty: EMPTY,
      apply,
    });
    expect(outcome.state).toEqual({ added: 3, removed: 1 });
    expect(outcome.fromSnapshot).toBe(false);
  });

  it('starts from the snapshot and applies only what follows', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, { throughSequence: 2, at: BASE, state: { added: 2, removed: 0 } });
    const outcome = replay({ storage: store, records: RECORDS, empty: EMPTY, apply });
    expect(outcome.state).toEqual({ added: 3, removed: 1 });
    expect(outcome.applied).toBe(2);
    expect(outcome.fromSnapshot).toBe(true);
    expect(outcome.throughSequence).toBe(4);
  });

  it('agrees with a full replay, which is what makes a snapshot safe', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, { throughSequence: 2, at: BASE, state: { added: 2, removed: 0 } });
    const fromSnapshot = replay({ storage: store, records: RECORDS, empty: EMPTY, apply });
    const fromScratch = replay({
      storage: store,
      records: RECORDS,
      empty: EMPTY,
      apply,
      ignoreSnapshots: true,
    });
    expect(fromSnapshot.state).toEqual(fromScratch.state);
    expect(fromSnapshot.throughSequence).toBe(fromScratch.throughSequence);
  });

  it('falls back to a full replay past a corrupt snapshot', () => {
    const store = new MemoryStorage();
    store.write(snapshotName(2), '{corrupt');
    const outcome = replay({ storage: store, records: RECORDS, empty: EMPTY, apply });
    expect(outcome.state).toEqual({ added: 3, removed: 1 });
    expect(outcome.fromSnapshot).toBe(false);
    expect(outcome.problems.length).toBeGreaterThan(0);
  });

  it('warns when the snapshot is ahead of the journal', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, { throughSequence: 99, at: BASE, state: { added: 9, removed: 0 } });
    const outcome = replay({ storage: store, records: RECORDS, empty: EMPTY, apply });
    expect(outcome.problems.length).toBeGreaterThan(0);
    expect(outcome.state).toEqual({ added: 9, removed: 0 });
  });

  it('replays an empty journal from a snapshot without moving', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, { throughSequence: 4, at: BASE, state: { added: 3, removed: 1 } });
    const outcome = replay({ storage: store, records: [], empty: EMPTY, apply });
    expect(outcome.state).toEqual({ added: 3, removed: 1 });
    expect(outcome.applied).toBe(0);
    expect(outcome.throughSequence).toBe(4);
  });
});

describe('snapshotOf', () => {
  it('captures where the replay got to', () => {
    const outcome = replayRecords(EMPTY, RECORDS, apply);
    const snapshot = snapshotOf(outcome, BASE);
    expect(snapshot.throughSequence).toBe(4);
    expect(snapshot.state).toEqual({ added: 3, removed: 1 });
    expect(snapshot.at).toBe(BASE);
  });

  it('round trips through a store into another replay', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, snapshotOf(replayRecords(EMPTY, RECORDS, apply), BASE));
    const again = replay({ storage: store, records: RECORDS, empty: EMPTY, apply });
    expect(again.state).toEqual({ added: 3, removed: 1 });
    expect(again.applied).toBe(0);
  });
});
