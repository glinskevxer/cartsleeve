import { describe, expect, it } from 'vitest';
import { importDelimited, resolveColumns } from '../../src/library/import-delimited.js';
import { PIPE } from '../../src/util/delimited.js';
import { lookup, size } from '../../src/library/library.js';
import type { CartNumber } from '../../src/util/ids.js';
import { expectErr, expectOk } from '../support/result.js';

const YEAR = 2025;
const cart = (value: string): CartNumber => value as CartNumber;

const FULL = [
  'Cart #,Song Title,Artist,Length,Cat,Intro,Ending,Fade,ISRC,Label,Released,Tempo,Sounds',
  'M0001,Jolene,Dolly Parton,2:42,A,0:12,fade,0:06,USRC17607839,RCA Victor,1973,bright,fiddle;steel gtr',
  'M0002,Ring of Fire,Johnny Cash,2:37,G,0:08,cold,,USRC17600001,Columbia,1963,medium,',
].join('\n');

describe('resolveColumns', () => {
  it('matches a column whatever it is spelled', () => {
    const resolved = resolveColumns(['Cart #', 'cart_no', 'Song Title', 'Length']);
    expect(resolved.get('cart')).toBe('Cart #');
    expect(resolved.get('title')).toBe('Song Title');
    expect(resolved.get('runtime')).toBe('Length');
  });

  it('ignores case, spaces and punctuation', () => {
    expect(resolveColumns(['  RUNTIME  ']).get('runtime')).toBe('  RUNTIME  ');
    expect(resolveColumns(['release_year']).get('year')).toBe('release_year');
  });

  it('leaves out a field the file does not carry', () => {
    expect(resolveColumns(['cart', 'title']).has('isrc')).toBe(false);
  });
});

describe('importDelimited', () => {
  it('reads every row into a library entry', () => {
    const outcome = expectOk(importDelimited(FULL, { currentYear: YEAR }));
    expect(outcome.rowsRead).toBe(2);
    expect(outcome.rowsKept).toBe(2);
    expect(outcome.problems).toEqual([]);
    expect(size(outcome.library)).toBe(2);
  });

  it('reads the cart, its timing and its category', () => {
    const outcome = expectOk(importDelimited(FULL, { currentYear: YEAR }));
    const entry = lookup(outcome.library, cart('M0001'));
    expect(entry?.cart.title).toBe('Jolene');
    expect(entry?.cart.category).toBe('A');
    expect(entry?.cart.runtime).toBe(1620);
    expect(entry?.cart.timing.intro).toBe(120);
    expect(entry?.cart.timing.endType).toBe('fade');
    expect(entry?.cart.timing.tail).toBe(60);
  });

  it('reads the recording and its label', () => {
    const outcome = expectOk(importDelimited(FULL, { currentYear: YEAR }));
    const entry = lookup(outcome.library, cart('M0001'));
    expect(entry?.recording?.isrc).toBe('USRC17607839');
    expect(entry?.recording?.label).toBe('RCA Victor');
    expect(entry?.recording?.releaseYear).toBe(1973);
  });

  it('reads the coded attributes and splits the sound codes', () => {
    const outcome = expectOk(importDelimited(FULL, { currentYear: YEAR }));
    const entry = lookup(outcome.library, cart('M0001'));
    expect(entry?.attributes?.tempo).toBe('bright');
    expect(entry?.attributes?.sounds).toEqual(['FIDDLE', 'STEELGTR']);
    expect(lookup(outcome.library, cart('M0002'))?.attributes?.sounds).toEqual([]);
  });

  it('leaves a blank optional column alone rather than failing on it', () => {
    const outcome = expectOk(importDelimited(FULL, { currentYear: YEAR }));
    expect(lookup(outcome.library, cart('M0002'))?.cart.timing.tail).toBe(0);
  });

  it('reads a pipe delimited export', () => {
    const piped = FULL.split('\n')
      .map((line) => line.split(',').join('|'))
      .join('\n');
    const outcome = expectOk(importDelimited(piped, { currentYear: YEAR, delimiter: PIPE }));
    expect(outcome.rowsKept).toBe(2);
  });

  it('rejects a file the reader cannot parse at all', () => {
    const problems = expectErr(importDelimited('a\n"unterminated\n', { currentYear: YEAR }));
    expect(problems[0]?.code).toBe('LIB-090');
  });

  it('rejects a header missing a field nothing can be built without', () => {
    const problems = expectErr(importDelimited('title,artist\nx,y\n', { currentYear: YEAR }));
    expect(problems.map((p) => p.message)).toEqual([
      'has no column for cart',
      'has no column for runtime',
    ]);
  });

  it('keeps going past a bad row and names the line it was on', () => {
    const withBad = [
      'cart,title,artist,length',
      'M0001,Jolene,Dolly Parton,2:42',
      'nope,Bad Row,Someone,2:00',
      'M0003,Coat of Many Colors,Dolly Parton,3:03',
    ].join('\n');
    const outcome = expectOk(importDelimited(withBad, { currentYear: YEAR }));
    expect(outcome.rowsRead).toBe(3);
    expect(outcome.rowsKept).toBe(2);
    expect(outcome.problems[0]?.subject).toBe('line 3');
    expect(outcome.problems[0]?.code).toBe('LIB-020');
  });

  it('reports every bad row rather than the first', () => {
    const withBad = [
      'cart,title,artist,length',
      'nope,A,Someone,2:00',
      'alsonope,B,Someone,2:00',
    ].join('\n');
    const outcome = expectOk(importDelimited(withBad, { currentYear: YEAR }));
    expect(outcome.problems.map((p) => p.subject)).toEqual(['line 2', 'line 3']);
    expect(outcome.rowsKept).toBe(0);
  });

  it('keeps a cart whose recording is bad, and reports the recording', () => {
    const badIsrc = [
      'cart,title,artist,length,isrc,label,released',
      'M0001,Jolene,Dolly Parton,2:42,nope,RCA,1973',
    ].join('\n');
    const outcome = expectOk(importDelimited(badIsrc, { currentYear: YEAR }));
    expect(outcome.rowsKept).toBe(1);
    expect(lookup(outcome.library, cart('M0001'))?.recording).toBeUndefined();
    expect(outcome.problems[0]?.code).toBe('ROY-001');
  });

  it('imports a cart with no recording column at all', () => {
    const noIsrc = ['cart,title,artist,length', 'M0001,Jolene,Dolly Parton,2:42'].join('\n');
    const outcome = expectOk(importDelimited(noIsrc, { currentYear: YEAR }));
    expect(outcome.problems).toEqual([]);
    expect(lookup(outcome.library, cart('M0001'))?.recording).toBeUndefined();
  });

  it('reads a header with no rows as an empty library', () => {
    const outcome = expectOk(importDelimited('cart,title,length\n', { currentYear: YEAR }));
    expect(outcome.rowsRead).toBe(0);
    expect(size(outcome.library)).toBe(0);
  });
});
