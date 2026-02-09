import { describe, expect, it } from 'vitest';
import {
  AHEAD_OF_JOURNAL,
  BAD_SNAPSHOT,
  checkAgainstJournal,
  decodeSnapshot,
  encodeSnapshot,
  latestSnapshot,
  sequenceOfName,
  snapshotName,
  snapshotNames,
  supersededNames,
  writeSnapshot,
} from '../../src/store/snapshot.js';
import type { Snapshot } from '../../src/store/snapshot.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { expectErr, expectOk } from '../support/result.js';

const BASE = 1_700_000_000_000;

interface State {
  readonly carts: number;
}

const snapshot = (sequence: number, carts = 40): Snapshot<State> => ({
  throughSequence: sequence,
  at: BASE,
  state: { carts },
});

describe('snapshot names', () => {
  it('pads the sequence so names sort in order', () => {
    expect(snapshotName(7)).toBe('snapshot-000000000007.json');
    expect(snapshotName(70) > snapshotName(7)).toBe(true);
  });

  it('reads the sequence back off a name', () => {
    expect(sequenceOfName(snapshotName(7))).toBe(7);
    expect(sequenceOfName(snapshotName(0))).toBe(0);
  });

  it('does not read a sequence off anything else', () => {
    expect(sequenceOfName('journal.tsv')).toBeUndefined();
    expect(sequenceOfName('snapshot-abc.json')).toBeUndefined();
    expect(sequenceOfName('snapshot-7.txt')).toBeUndefined();
  });
});

describe('encoding', () => {
  it('round trips', () => {
    expect(expectOk(decodeSnapshot<State>(encodeSnapshot(snapshot(7))))).toEqual(snapshot(7));
  });

  it('rejects an empty file', () => {
    expect(expectErr(decodeSnapshot('')).code).toBe(BAD_SNAPSHOT);
  });

  it('rejects unreadable json', () => {
    expect(expectErr(decodeSnapshot('{not json')).message).toContain('json');
  });

  it('rejects something that is not an object', () => {
    expect(expectErr(decodeSnapshot('42')).message).toContain('not an object');
  });

  it('rejects one with no sequence or timestamp', () => {
    expect(expectErr(decodeSnapshot('{"state":{}}')).message).toContain('sequence');
  });

  it('rejects one carrying no state', () => {
    expect(expectErr(decodeSnapshot('{"throughSequence":1,"at":1}')).message).toContain('no state');
  });
});

describe('writing and finding snapshots', () => {
  it('writes under a name derived from the sequence', () => {
    const store = new MemoryStorage();
    expect(writeSnapshot(store, snapshot(7))).toBe(snapshotName(7));
    expect(store.exists(snapshotName(7))).toBe(true);
  });

  it('never writes over an earlier snapshot', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, snapshot(7, 40));
    writeSnapshot(store, snapshot(9, 50));
    expect(store.exists(snapshotName(7))).toBe(true);
    expect(store.exists(snapshotName(9))).toBe(true);
  });

  it('lists the snapshots oldest first, ignoring other files', () => {
    const store = new MemoryStorage();
    store.write('journal.tsv', 'x');
    writeSnapshot(store, snapshot(9));
    writeSnapshot(store, snapshot(7));
    expect(snapshotNames(store)).toEqual([snapshotName(7), snapshotName(9)]);
  });

  it('finds the newest snapshot', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, snapshot(7, 40));
    writeSnapshot(store, snapshot(9, 50));
    const found = latestSnapshot<State>(store);
    expect(found.snapshot?.throughSequence).toBe(9);
    expect(found.problems).toEqual([]);
  });

  it('falls back past a corrupt newest snapshot and says so', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, snapshot(7, 40));
    store.write(snapshotName(9), '{corrupt');
    const found = latestSnapshot<State>(store);
    expect(found.snapshot?.throughSequence).toBe(7);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]?.subject).toBe(snapshotName(9));
  });

  it('finds nothing in an empty store', () => {
    const found = latestSnapshot<State>(new MemoryStorage());
    expect(found.snapshot).toBeUndefined();
    expect(found.problems).toEqual([]);
  });

  it('reports every corrupt snapshot when none can be read', () => {
    const store = new MemoryStorage();
    store.write(snapshotName(7), 'bad');
    store.write(snapshotName(9), 'also bad');
    const found = latestSnapshot<State>(store);
    expect(found.snapshot).toBeUndefined();
    expect(found.problems).toHaveLength(2);
  });
});

describe('checkAgainstJournal', () => {
  it('says nothing when the journal has at least as much', () => {
    expect(checkAgainstJournal(snapshot(7), 7)).toBeUndefined();
    expect(checkAgainstJournal(snapshot(7), 9)).toBeUndefined();
  });

  it('warns when the snapshot is ahead of the journal', () => {
    const problem = checkAgainstJournal(snapshot(9), 7);
    expect(problem?.code).toBe(AHEAD_OF_JOURNAL);
    expect(problem?.detail?.['journal']).toBe(7);
  });
});

describe('supersededNames', () => {
  it('names everything but the newest few', () => {
    const store = new MemoryStorage();
    for (const sequence of [1, 2, 3, 4]) {
      writeSnapshot(store, snapshot(sequence));
    }
    expect(supersededNames(store, 2)).toEqual([snapshotName(1), snapshotName(2)]);
  });

  it('names nothing when there are fewer than the keep count', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, snapshot(1));
    expect(supersededNames(store, 3)).toEqual([]);
  });

  it('names everything when nothing is kept', () => {
    const store = new MemoryStorage();
    writeSnapshot(store, snapshot(1));
    expect(supersededNames(store, 0)).toHaveLength(1);
  });
});
