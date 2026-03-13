import { describe, expect, it } from 'vitest';
import {
  BAD_RECORD,
  BAD_SEQUENCE,
  FORMAT_VERSION,
  TRUNCATED,
  decodeJournal,
  decodeRecord,
  encodeJournal,
  encodeRecord,
  nextSequence,
  readNumber,
  readString,
} from '../../src/store/journal.js';
import type { JournalRecord } from '../../src/store/journal.js';
import { expectErr, expectOk } from '../support/result.js';

const BASE = 1_700_000_000_000;

const record = (over: Partial<JournalRecord> = {}): JournalRecord => ({
  sequence: 1,
  at: BASE,
  kind: 'cart.carded',
  payload: { cart: 'M0001', to: 'G' },
  ...over,
});

describe('encoding a record', () => {
  it('writes the fixed fields outside the json', () => {
    const line = encodeRecord(record());
    expect(line.split('\t').slice(0, 4)).toEqual([
      String(FORMAT_VERSION),
      '1',
      String(BASE),
      'cart.carded',
    ]);
  });

  it('round trips', () => {
    expect(expectOk(decodeRecord(encodeRecord(record())))).toEqual(record());
  });

  it('round trips a payload containing a tab', () => {
    const tabbed = record({ payload: { note: 'a\tb' } });
    expect(expectOk(decodeRecord(encodeRecord(tabbed)))).toEqual(tabbed);
  });

  it('round trips an empty payload', () => {
    const empty = record({ payload: {} });
    expect(expectOk(decodeRecord(encodeRecord(empty)))).toEqual(empty);
  });
});

describe('decoding a bad record', () => {
  it('rejects a line with too few fields', () => {
    expect(expectErr(decodeRecord('1\t2\t3')).code).toBe(BAD_RECORD);
  });

  it('rejects a different format version', () => {
    const line = encodeRecord(record()).replace(/^1/, '9');
    expect(expectErr(decodeRecord(line)).message).toContain('format version');
  });

  it('rejects a bad sequence number', () => {
    const line = encodeRecord(record()).replace('\t1\t', '\tzero\t');
    expect(expectErr(decodeRecord(line)).message).toContain('sequence');
  });

  it('rejects a bad timestamp', () => {
    const line = encodeRecord(record()).replace(String(BASE), 'never');
    expect(expectErr(decodeRecord(line)).message).toContain('timestamp');
  });

  it('rejects a record with no kind', () => {
    const line = encodeRecord(record()).replace('\tcart.carded\t', '\t\t');
    expect(expectErr(decodeRecord(line)).message).toContain('kind');
  });

  it('rejects a payload that is not readable json', () => {
    const line = `${FORMAT_VERSION}\t1\t${BASE}\tkind\t{not json`;
    expect(expectErr(decodeRecord(line)).message).toContain('json');
  });

  it('rejects a payload that is not an object', () => {
    const line = `${FORMAT_VERSION}\t1\t${BASE}\tkind\t[1,2]`;
    expect(expectErr(decodeRecord(line)).message).toContain('not an object');
  });
});

describe('decoding a journal', () => {
  const three = () => [record({ sequence: 1 }), record({ sequence: 2 }), record({ sequence: 3 })];

  it('reads every record back', () => {
    const read = decodeJournal(encodeJournal(three()));
    expect(read.records).toHaveLength(3);
    expect(read.problems).toEqual([]);
    expect(read.truncated).toBe(false);
  });

  it('reads an empty journal', () => {
    const read = decodeJournal('');
    expect(read.records).toEqual([]);
    expect(read.problems).toEqual([]);
  });

  it('reports a gap in the sequence', () => {
    const gapped = [record({ sequence: 1 }), record({ sequence: 3 })];
    const read = decodeJournal(encodeJournal(gapped));
    expect(read.records).toHaveLength(2);
    expect(read.problems[0]?.code).toBe(BAD_SEQUENCE);
    expect(read.problems[0]?.detail?.['expected']).toBe(2);
  });

  it('keeps going past a corrupt record and reports it', () => {
    const text = `${encodeRecord(record({ sequence: 1 }))}\nnonsense\n${encodeRecord(record({ sequence: 2 }))}\n`;
    const read = decodeJournal(text);
    expect(read.records).toHaveLength(2);
    expect(read.problems.map((each) => each.code)).toContain(BAD_RECORD);
  });

  it('drops a trailing partial line and says the write did not finish', () => {
    const text = `${encodeRecord(record({ sequence: 1 }))}\n${encodeRecord(record({ sequence: 2 })).slice(0, 20)}`;
    const read = decodeJournal(text);
    expect(read.records).toHaveLength(1);
    expect(read.truncated).toBe(true);
    expect(read.problems.map((each) => each.code)).toContain(TRUNCATED);
  });

  it('keeps everything before a truncated tail intact', () => {
    const good = encodeJournal(three());
    const read = decodeJournal(`${good}${encodeRecord(record({ sequence: 4 })).slice(0, 10)}`);
    expect(read.records.map((each) => each.sequence)).toEqual([1, 2, 3]);
  });

  it('ignores a blank line in the middle', () => {
    const text = `${encodeRecord(record({ sequence: 1 }))}\n\n${encodeRecord(record({ sequence: 2 }))}\n`;
    expect(decodeJournal(text).records).toHaveLength(2);
  });
});

describe('nextSequence', () => {
  it('starts at one on an empty journal', () => {
    expect(nextSequence([])).toBe(1);
  });

  it('follows the highest sequence present', () => {
    expect(nextSequence([record({ sequence: 1 }), record({ sequence: 7 })])).toBe(8);
  });

  it('does not care about the order', () => {
    expect(nextSequence([record({ sequence: 7 }), record({ sequence: 1 })])).toBe(8);
  });
});

describe('reading a payload field', () => {
  it('reads a string and a number', () => {
    const payload = { name: 'AMD', count: 4 };
    expect(readString(payload, 'name')).toBe('AMD');
    expect(readNumber(payload, 'count')).toBe(4);
  });

  it('falls back when the field is the wrong type', () => {
    const payload = { name: { nested: true }, count: 'four' };
    expect(readString(payload, 'name')).toBe('');
    expect(readNumber(payload, 'count')).toBe(0);
  });

  it('falls back when the field is absent', () => {
    expect(readString({}, 'name', 'none')).toBe('none');
    expect(readNumber({}, 'count', -1)).toBe(-1);
  });

  it('does not accept a non finite number', () => {
    expect(readNumber({ count: Number.NaN }, 'count', 7)).toBe(7);
    expect(readNumber({ count: Number.POSITIVE_INFINITY }, 'count', 7)).toBe(7);
  });

  it('reads an empty string as itself rather than the fallback', () => {
    expect(readString({ name: '' }, 'name', 'none')).toBe('');
  });
});
