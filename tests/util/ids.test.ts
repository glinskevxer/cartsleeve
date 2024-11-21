import { describe, expect, it } from 'vitest';
import {
  CART_FAMILIES,
  cartFamily,
  cartSequence,
  categoryFamily,
  formatIsrc,
  isMusicCart,
  isSubcategory,
  isrcParts,
  parseCallSign,
  parseCartNumber,
  parseCategoryCode,
  parseIsrc,
} from '../../src/util/ids.js';
import { isErr, isOk } from '../../src/util/result.js';
import { expectErr, expectOk } from '../support/result.js';

describe('parseCartNumber', () => {
  it('accepts a family letter and four digits', () => {
    const parsed = parseCartNumber('M1234');
    expect(isOk(parsed)).toBe(true);
    expect(expectOk(parsed)).toBe('M1234');
  });

  it('upper cases and trims what the operator typed', () => {
    expect(expectOk(parseCartNumber('  m0042 '))).toBe('M0042');
  });

  it('rejects an empty entry by name', () => {
    const problem = expectErr(parseCartNumber('   '));
    expect(problem.field).toBe('cart');
    expect(problem.reason).toContain('empty');
  });

  it('rejects the wrong digit count', () => {
    expect(isErr(parseCartNumber('M123'))).toBe(true);
    expect(isErr(parseCartNumber('M12345'))).toBe(true);
    expect(isErr(parseCartNumber('MM123'))).toBe(true);
  });

  it('names an unknown family letter in the reason', () => {
    expect(expectErr(parseCartNumber('Z0001')).reason).toContain('Z');
  });

  it('knows every family it lists', () => {
    for (const letter of Object.keys(CART_FAMILIES)) {
      expect(isOk(parseCartNumber(`${letter}0001`))).toBe(true);
    }
  });

  it('reads the family and the sequence back out', () => {
    const cart = expectOk(parseCartNumber('C0455'));
    expect(cartFamily(cart)).toBe('C');
    expect(cartSequence(cart)).toBe(455);
    expect(isMusicCart(cart)).toBe(false);
    expect(isMusicCart(expectOk(parseCartNumber('M0455')))).toBe(true);
  });

  it('keeps a leading zero sequence numeric', () => {
    expect(cartSequence(expectOk(parseCartNumber('M0007')))).toBe(7);
  });
});

describe('parseCallSign', () => {
  it('accepts three and four letter signs on both sides of the river', () => {
    expect(expectOk(parseCallSign('KHRT'))).toBe('KHRT');
    expect(expectOk(parseCallSign('WBZ'))).toBe('WBZ');
  });

  it('drops the band suffix operators keep typing', () => {
    expect(expectOk(parseCallSign('KHRT-FM'))).toBe('KHRT');
    expect(expectOk(parseCallSign('wbz-am'))).toBe('WBZ');
  });

  it('rejects a sign that does not start K or W', () => {
    expect(isErr(parseCallSign('XHRT'))).toBe(true);
  });

  it('rejects a sign of the wrong length', () => {
    expect(isErr(parseCallSign('KH'))).toBe(true);
    expect(isErr(parseCallSign('KHRTX'))).toBe(true);
  });
});

describe('parseCategoryCode', () => {
  it('accepts a bare letter and a subcategory', () => {
    expect(expectOk(parseCategoryCode('A'))).toBe('A');
    expect(expectOk(parseCategoryCode('g3'))).toBe('G3');
  });

  it('rejects two letters or two digits', () => {
    expect(isErr(parseCategoryCode('AA'))).toBe(true);
    expect(isErr(parseCategoryCode('A12'))).toBe(true);
    expect(isErr(parseCategoryCode('1'))).toBe(true);
  });

  it('reads the family and whether it is split', () => {
    const plain = expectOk(parseCategoryCode('A'));
    const split = expectOk(parseCategoryCode('A2'));
    expect(categoryFamily(plain)).toBe('A');
    expect(categoryFamily(split)).toBe('A');
    expect(isSubcategory(plain)).toBe(false);
    expect(isSubcategory(split)).toBe(true);
  });
});

describe('parseIsrc', () => {
  it('accepts the plain and the hyphenated form', () => {
    expect(expectOk(parseIsrc('USRC17607839'))).toBe('USRC17607839');
    expect(expectOk(parseIsrc('US-RC1-76-07839'))).toBe('USRC17607839');
  });

  it('rejects a short code and an empty one', () => {
    expect(isErr(parseIsrc('USRC1760783'))).toBe(true);
    expect(isErr(parseIsrc(''))).toBe(true);
  });

  it('rejects letters where the digits belong', () => {
    expect(isErr(parseIsrc('USRC1AB07839'))).toBe(true);
  });

  it('splits the code into its four parts', () => {
    const isrc = expectOk(parseIsrc('USRC17607839'));
    expect(isrcParts(isrc)).toEqual({
      country: 'US',
      registrant: 'RC1',
      year: 1976,
      designation: '07839',
    });
  });

  it('reads a two digit year under 40 as this century', () => {
    const isrc = expectOk(parseIsrc('GBAYE0601498'));
    expect(isrcParts(isrc).year).toBe(2006);
  });

  it('hyphenates for the filing format', () => {
    const isrc = expectOk(parseIsrc('USRC17607839'));
    expect(formatIsrc(isrc)).toBe('US-RC1-76-07839');
  });
});
