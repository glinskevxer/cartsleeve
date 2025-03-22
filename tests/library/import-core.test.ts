import { describe, expect, it } from 'vitest';
import { entryFrom, importRows, splitSounds } from '../../src/library/import-core.js';
import type { SourceRow } from '../../src/library/import-core.js';
import type { Problem } from '../../src/util/problem.js';
import { size } from '../../src/library/library.js';

const YEAR = 2025;

function row(fields: Readonly<Record<string, string>>, where = 'line 1'): SourceRow {
  return {
    where,
    has: (field) => field in fields,
    read: (field) => fields[field] ?? '',
  };
}

const GOOD = {
  cart: 'M0001',
  title: 'Jolene',
  artist: 'Dolly Parton',
  runtime: '2:42',
};

describe('splitSounds', () => {
  it('splits on any of the three separators exports use', () => {
    expect(splitSounds('fiddle;steel gtr')).toEqual(['fiddle', 'steel gtr']);
    expect(splitSounds('fiddle,steel')).toEqual(['fiddle', 'steel']);
    expect(splitSounds('fiddle|steel')).toEqual(['fiddle', 'steel']);
  });

  it('drops empty pieces and trims', () => {
    expect(splitSounds(' fiddle ; ; steel ')).toEqual(['fiddle', 'steel']);
    expect(splitSounds('')).toEqual([]);
  });
});

describe('entryFrom', () => {
  it('builds a cart from the fields it needs', () => {
    const problems: Problem[] = [];
    const entry = entryFrom(row(GOOD), { currentYear: YEAR }, problems);
    expect(entry?.cart.number).toBe('M0001');
    expect(problems).toEqual([]);
  });

  it('returns nothing and attributes the problem to the row', () => {
    const problems: Problem[] = [];
    const entry = entryFrom(
      row({ ...GOOD, cart: 'nope' }, 'line 9'),
      { currentYear: YEAR },
      problems,
    );
    expect(entry).toBeUndefined();
    expect(problems[0]?.subject).toBe('line 9');
  });

  it('treats a field the source does not carry as absent, not as blank', () => {
    const problems: Problem[] = [];
    const entry = entryFrom(row(GOOD), { currentYear: YEAR }, problems);
    expect(entry?.cart.category).toBe('A');
    expect(entry?.cart.timing.endType).toBe('cold');
  });

  it('treats a blank optional field the same as an absent one', () => {
    const problems: Problem[] = [];
    const entry = entryFrom(
      row({ ...GOOD, intro: '', endtype: '' }),
      { currentYear: YEAR },
      problems,
    );
    expect(problems).toEqual([]);
    expect(entry?.cart.timing.intro).toBe(0);
  });

  it('keeps the coded attributes when the row has no recording', () => {
    const problems: Problem[] = [];
    const entry = entryFrom(
      row({ ...GOOD, tempo: 'up', sounds: 'fiddle' }),
      { currentYear: YEAR },
      problems,
    );
    expect(entry?.attributes?.tempo).toBe('up');
    expect(entry?.recording).toBeUndefined();
  });

  it('keeps the coded attributes when the row also has a recording', () => {
    const problems: Problem[] = [];
    const entry = entryFrom(
      row({
        ...GOOD,
        tempo: 'up',
        sounds: 'fiddle',
        isrc: 'USRC17607839',
        label: 'RCA',
        year: '1973',
      }),
      { currentYear: YEAR },
      problems,
    );
    expect(entry?.attributes?.tempo).toBe('up');
    expect(entry?.recording?.isrc).toBe('USRC17607839');
  });

  it('keeps the coded attributes even when the recording is rejected', () => {
    const problems: Problem[] = [];
    const entry = entryFrom(
      row({ ...GOOD, tempo: 'up', isrc: 'nope', label: 'RCA', year: '1973' }),
      { currentYear: YEAR },
      problems,
    );
    expect(entry?.attributes?.tempo).toBe('up');
    expect(entry?.recording).toBeUndefined();
    expect(problems[0]?.code).toBe('ROY-001');
  });

  it('keeps the cart when only the attributes are bad', () => {
    const problems: Problem[] = [];
    const entry = entryFrom(row({ ...GOOD, tempo: 'brisk' }), { currentYear: YEAR }, problems);
    expect(entry?.cart.number).toBe('M0001');
    expect(entry?.attributes).toBeUndefined();
    expect(problems[0]?.code).toBe('LIB-050');
  });
});

describe('importRows', () => {
  it('keeps every good row and reports every bad one', () => {
    const outcome = importRows(
      [
        row(GOOD, 'line 2'),
        row({ ...GOOD, cart: 'nope' }, 'line 3'),
        row({ ...GOOD, cart: 'M0004' }, 'line 4'),
      ],
      { currentYear: YEAR },
    );
    expect(outcome.rowsRead).toBe(3);
    expect(outcome.rowsKept).toBe(2);
    expect(size(outcome.library)).toBe(2);
    expect(outcome.problems.map((p) => p.subject)).toEqual(['line 3']);
  });

  it('reads no rows as an empty library', () => {
    const outcome = importRows([], { currentYear: YEAR });
    expect(outcome.rowsRead).toBe(0);
    expect(outcome.problems).toEqual([]);
  });
});
