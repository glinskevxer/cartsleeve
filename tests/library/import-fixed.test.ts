import { describe, expect, it } from 'vitest';
import {
  LEGACY_LAYOUT,
  importFixed,
  readFixedLine,
  sliceField,
} from '../../src/library/import-fixed.js';
import { lookup, size } from '../../src/library/library.js';
import type { CartNumber } from '../../src/util/ids.js';
import { expectErr, expectOk } from '../support/result.js';

const YEAR = 2025;
const cart = (value: string): CartNumber => value as CartNumber;

/** Build a card image by laying each value at its offset. */
function card(values: Readonly<Record<string, string>>): string {
  let line = '';
  for (const field of LEGACY_LAYOUT) {
    const value = values[field.name] ?? '';
    line = line.padEnd(field.at, ' ') + value.padEnd(field.width, ' ').slice(0, field.width);
  }
  return line.trimEnd();
}

const JOLENE = card({
  cart: 'M0001',
  category: 'A',
  runtime: '2:42',
  intro: '0:12',
  endtype: 'F',
  title: 'Jolene',
  artist: 'Dolly Parton',
  year: '1973',
  isrc: 'USRC17607839',
  label: 'RCA Victor',
});

describe('sliceField', () => {
  it('takes the field at its offset and trims the padding', () => {
    expect(sliceField('M0001A  2:42', { name: 'cart', at: 0, width: 5 })).toBe('M0001');
    expect(sliceField('M0001A  2:42', { name: 'category', at: 5, width: 2 })).toBe('A');
  });

  it('reads a field past the end of a short line as absent', () => {
    expect(sliceField('M0001', { name: 'title', at: 20, width: 30 })).toBe('');
    expect(sliceField('', { name: 'cart', at: 0, width: 5 })).toBe('');
  });

  it('reads a field that runs past the end as far as it goes', () => {
    expect(sliceField('M0001A', { name: 'category', at: 5, width: 2 })).toBe('A');
  });

  it('keeps a value that exactly fills its column with no space after it', () => {
    const exact = 'A Title Filling Thirty Columns';
    expect(exact).toHaveLength(30);
    const line = card({ cart: 'M0001', runtime: '2:42', title: exact, artist: 'Someone' });
    expect(readFixedLine(line).get('title')).toBe(exact);
    expect(readFixedLine(line).get('artist')).toBe('Someone');
  });
});

describe('importFixed', () => {
  it('reads a card image into a library entry', () => {
    const outcome = expectOk(importFixed(JOLENE, { currentYear: YEAR }));
    expect(outcome.linesRead).toBe(1);
    expect(outcome.linesKept).toBe(1);
    expect(outcome.problems).toEqual([]);
    const entry = lookup(outcome.library, cart('M0001'));
    expect(entry?.cart.title).toBe('Jolene');
    expect(entry?.cart.billed).toBe('Dolly Parton');
    expect(entry?.cart.category).toBe('A');
    expect(entry?.cart.runtime).toBe(1620);
    expect(entry?.cart.timing.intro).toBe(120);
    expect(entry?.cart.timing.endType).toBe('fade');
  });

  it('reads the recording off the tail of the card', () => {
    const entry = lookup(
      expectOk(importFixed(JOLENE, { currentYear: YEAR })).library,
      cart('M0001'),
    );
    expect(entry?.recording?.isrc).toBe('USRC17607839');
    expect(entry?.recording?.label).toBe('RCA Victor');
    expect(entry?.recording?.releaseYear).toBe(1973);
  });

  it('reads a short card that stops before the recording fields', () => {
    const short = card({
      cart: 'M0002',
      category: 'G',
      runtime: '2:37',
      title: 'Ring of Fire',
      artist: 'Johnny Cash',
    });
    const outcome = expectOk(importFixed(short, { currentYear: YEAR }));
    expect(outcome.linesKept).toBe(1);
    expect(lookup(outcome.library, cart('M0002'))?.recording).toBeUndefined();
    expect(outcome.problems).toEqual([]);
  });

  it('skips blank lines and comments the old system wrote', () => {
    const file = ['* KHRT library export', '', JOLENE, '# end of file'].join('\n');
    const outcome = expectOk(importFixed(file, { currentYear: YEAR }));
    expect(outcome.linesRead).toBe(1);
    expect(size(outcome.library)).toBe(1);
  });

  it('tolerates carriage returns from the old machine', () => {
    const outcome = expectOk(importFixed(`${JOLENE}\r\n`, { currentYear: YEAR }));
    expect(outcome.linesKept).toBe(1);
  });

  it('keeps going past a bad card and names the line', () => {
    const bad = card({ cart: 'nope', runtime: '2:00', title: 'Bad', artist: 'Someone' });
    const outcome = expectOk(importFixed([JOLENE, bad].join('\n'), { currentYear: YEAR }));
    expect(outcome.linesRead).toBe(2);
    expect(outcome.linesKept).toBe(1);
    expect(outcome.problems[0]?.subject).toBe('line 2');
  });

  it('keeps the cart when only its recording is bad', () => {
    const bad = card({
      cart: 'M0003',
      runtime: '2:00',
      title: 'Song',
      artist: 'Someone',
      isrc: 'nope',
      label: 'A Label',
      year: '1999',
    });
    const outcome = expectOk(importFixed(bad, { currentYear: YEAR }));
    expect(outcome.linesKept).toBe(1);
    expect(lookup(outcome.library, cart('M0003'))?.recording).toBeUndefined();
    expect(outcome.problems[0]?.code).toBe('ROY-001');
  });

  it('rejects a layout with no field for something it cannot build without', () => {
    const problems = expectErr(
      importFixed(JOLENE, {
        currentYear: YEAR,
        layout: [{ name: 'cart', at: 0, width: 5 }],
      }),
    );
    expect(problems.map((p) => p.message)).toEqual([
      'has no field for runtime',
      'has no field for title',
    ]);
  });

  it('reads a custom layout', () => {
    const outcome = expectOk(
      importFixed('M0001Jolene              2:42', {
        currentYear: YEAR,
        layout: [
          { name: 'cart', at: 0, width: 5 },
          { name: 'title', at: 5, width: 20 },
          { name: 'runtime', at: 25, width: 5 },
          { name: 'artist', at: 30, width: 20 },
        ],
      }),
    );
    expect(outcome.problems[0]?.code).toBe('LIB-023');
    expect(outcome.linesRead).toBe(1);
  });

  it('reads an empty file as an empty library', () => {
    const outcome = expectOk(importFixed('', { currentYear: YEAR }));
    expect(outcome.linesRead).toBe(0);
    expect(size(outcome.library)).toBe(0);
  });

  it('honours a custom comment prefix', () => {
    const outcome = expectOk(
      importFixed(['// note', JOLENE].join('\n'), {
        currentYear: YEAR,
        commentPrefixes: ['//'],
      }),
    );
    expect(outcome.linesRead).toBe(1);
  });
});
