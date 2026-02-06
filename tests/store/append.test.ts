import { describe, expect, it } from 'vitest';
import { JOURNAL_NAME, Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { decodeJournal, encodeRecord } from '../../src/store/journal.js';

const BASE = 1_700_000_000_000;

function opened(): { store: MemoryStorage; journal: Journal } {
  const store = new MemoryStorage();
  return { store, journal: Journal.open(store) };
}

describe('opening a journal', () => {
  it('starts at sequence one on an empty store', () => {
    expect(opened().journal.nextSequence).toBe(1);
  });

  it('continues from where an existing journal left off', () => {
    const store = new MemoryStorage();
    store.append(
      JOURNAL_NAME,
      `${encodeRecord({ sequence: 4, at: BASE, kind: 'x', payload: {} })}\n`,
    );
    expect(Journal.open(store).nextSequence).toBe(5);
  });

  it('continues past a truncated tail rather than reusing a number', () => {
    const store = new MemoryStorage();
    store.append(
      JOURNAL_NAME,
      `${encodeRecord({ sequence: 1, at: BASE, kind: 'x', payload: {} })}\n`,
    );
    store.append(JOURNAL_NAME, 'partial');
    expect(Journal.open(store).nextSequence).toBe(2);
  });

  it('opens a journal under any name', () => {
    const store = new MemoryStorage();
    const journal = Journal.open(store, 'other.tsv');
    journal.append('x', {}, BASE);
    expect(store.read('other.tsv').length).toBeGreaterThan(0);
    expect(store.read(JOURNAL_NAME)).toBe('');
  });
});

describe('appending', () => {
  it('writes one complete line per record', () => {
    const { store, journal } = opened();
    journal.append('cart.carded', { cart: 'M0001' }, BASE);
    expect(store.read(JOURNAL_NAME).endsWith('\n')).toBe(true);
    expect(store.read(JOURNAL_NAME).split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('numbers the records in order', () => {
    const { journal } = opened();
    journal.append('a', {}, BASE);
    journal.append('b', {}, BASE + 1);
    expect(journal.readAll().records.map((each) => each.sequence)).toEqual([1, 2]);
  });

  it('returns the record it wrote', () => {
    const { journal } = opened();
    const written = journal.append('cart.carded', { cart: 'M0001' }, BASE);
    expect(written.sequence).toBe(1);
    expect(written.payload).toEqual({ cart: 'M0001' });
  });

  it('appends several at once', () => {
    const { journal } = opened();
    const written = journal.appendMany(
      [
        { kind: 'a', payload: {} },
        { kind: 'b', payload: {} },
      ],
      BASE,
    );
    expect(written.map((each) => each.sequence)).toEqual([1, 2]);
    expect(journal.length).toBe(2);
  });

  it('survives a reopen and keeps numbering forward', () => {
    const store = new MemoryStorage();
    Journal.open(store).append('a', {}, BASE);
    Journal.open(store).append('b', {}, BASE + 1);
    expect(decodeJournal(store.read(JOURNAL_NAME)).records.map((each) => each.sequence)).toEqual([
      1, 2,
    ]);
  });
});

describe('reading back', () => {
  function filled(): Journal {
    const { journal } = opened();
    journal.append('cart.carded', { cart: 'M0001' }, BASE);
    journal.append('cart.carded', { cart: 'M0002' }, BASE + 1000);
    journal.append('clock.changed', { clock: 'AMD' }, BASE + 2000);
    return journal;
  }

  it('reads everything in order', () => {
    expect(
      filled()
        .readAll()
        .records.map((each) => each.kind),
    ).toEqual(['cart.carded', 'cart.carded', 'clock.changed']);
  });

  it('reads the tail', () => {
    expect(
      filled()
        .tail(2)
        .map((each) => each.sequence),
    ).toEqual([2, 3]);
    expect(filled().tail(99)).toHaveLength(3);
    expect(filled().tail(0)).toEqual([]);
  });

  it('filters by kind', () => {
    expect(filled().ofKind('cart.carded')).toHaveLength(2);
    expect(filled().ofKind('nothing')).toEqual([]);
  });

  it('filters by time, inclusive', () => {
    expect(filled().since(BASE + 1000)).toHaveLength(2);
    expect(filled().since(BASE + 9999)).toEqual([]);
  });

  it('counts what it holds', () => {
    expect(filled().length).toBe(3);
    expect(opened().journal.length).toBe(0);
  });

  it('reports the problems the reader found', () => {
    const store = new MemoryStorage();
    store.append(JOURNAL_NAME, 'nonsense\n');
    expect(Journal.open(store).readAll().problems.length).toBeGreaterThan(0);
  });
});
