import { describe, expect, it } from 'vitest';
import {
  MAX_MUSIC_RUNTIME,
  MIN_MUSIC_RUNTIME,
  auditCart,
  describeCart,
  familyOf,
  makeCart,
} from '../../src/domain/cart.js';
import type { CartInput } from '../../src/domain/cart.js';
import { expectErr, expectOk } from '../support/result.js';

const SONG: CartInput = {
  number: 'M0142',
  title: 'Pancho and Lefty',
  billed: 'Willie Nelson feat. Merle Haggard',
  runtime: '4:47',
};

describe('makeCart', () => {
  it('builds a music cart and parses its credits', () => {
    const cart = expectOk(makeCart(SONG));
    expect(cart.number).toBe('M0142');
    expect(cart.title).toBe('Pancho and Lefty');
    expect(cart.runtime).toBe(2870);
    expect(cart.music).toBe(true);
    expect(cart.credits.map((c) => c.name)).toEqual(['Willie Nelson', 'Merle Haggard']);
  });

  it('defaults a music cart into A and a non music cart into X', () => {
    expect(expectOk(makeCart(SONG)).category).toBe('A');
    expect(
      expectOk(makeCart({ number: 'J0007', title: 'Legal ID', runtime: '0:08' })).category,
    ).toBe('X');
  });

  it('takes the category it is given', () => {
    expect(expectOk(makeCart({ ...SONG, category: 'g2' })).category).toBe('G2');
  });

  it('does not require an artist on a non music cart', () => {
    const jingle = expectOk(makeCart({ number: 'J0007', title: 'Legal ID', runtime: '0:08' }));
    expect(jingle.music).toBe(false);
    expect(jingle.billed).toBe('');
    expect(jingle.credits).toEqual([]);
  });

  it('trims the title', () => {
    expect(expectOk(makeCart({ ...SONG, title: '  Pancho  ' })).title).toBe('Pancho');
  });

  it('rejects a bad cart number', () => {
    expect(expectErr(makeCart({ ...SONG, number: 'nope' }))[0]?.code).toBe('LIB-020');
  });

  it('rejects an empty title', () => {
    expect(expectErr(makeCart({ ...SONG, title: ' ' }))[0]?.code).toBe('LIB-021');
  });

  it('rejects a runtime that is not written as a clock time', () => {
    const problems = expectErr(makeCart({ ...SONG, runtime: '287' }));
    expect(problems[0]?.code).toBe('LIB-022');
    expect(problems[0]?.message).toContain('runtime');
  });

  it('rejects a music cart with no artist', () => {
    expect(expectErr(makeCart({ ...SONG, billed: '  ' }))[0]?.code).toBe('LIB-023');
  });

  it('rejects a category that is not one', () => {
    expect(expectErr(makeCart({ ...SONG, category: 'AB' }))[0]?.code).toBe('LIB-024');
  });

  it('reports every problem at once', () => {
    const problems = expectErr(
      makeCart({ number: 'nope', title: '', runtime: 'x', billed: '', category: 'AB' }),
    );
    expect(problems.map((p) => p.code)).toEqual(['LIB-020', 'LIB-021', 'LIB-022', 'LIB-024']);
  });

  it('reads the family off the number', () => {
    expect(familyOf(expectOk(makeCart(SONG)))).toBe('M');
    expect(
      familyOf(expectOk(makeCart({ number: 'C0455', title: 'Ford spot', runtime: '0:30' }))),
    ).toBe('C');
  });
});

describe('auditCart', () => {
  it('passes an ordinary song', () => {
    expect(auditCart(expectOk(makeCart(SONG)))).toEqual([]);
  });

  it('flags a music cart shorter than any real song', () => {
    const cart = expectOk(makeCart({ ...SONG, runtime: '0:04' }));
    const problems = auditCart(cart);
    expect(problems[0]?.code).toBe('LIB-025');
    expect(problems[0]?.severity).toBe('warning');
    expect(cart.runtime).toBeLessThan(MIN_MUSIC_RUNTIME);
  });

  it('flags a music cart longer than any clock element', () => {
    const cart = expectOk(makeCart({ ...SONG, runtime: '16:00' }));
    expect(auditCart(cart)[0]?.code).toBe('LIB-026');
    expect(cart.runtime).toBeGreaterThan(MAX_MUSIC_RUNTIME);
  });

  it('accepts a runtime exactly on either bound', () => {
    expect(auditCart(expectOk(makeCart({ ...SONG, runtime: '0:30' })))).toEqual([]);
    expect(auditCart(expectOk(makeCart({ ...SONG, runtime: '15:00' })))).toEqual([]);
  });

  it('flags an artist string that parsed to nothing', () => {
    const cart = expectOk(makeCart({ ...SONG, billed: '...' }));
    expect(auditCart(cart).map((p) => p.code)).toContain('LIB-027');
  });

  it('flags a non music cart carded into a rotating category', () => {
    const cart = expectOk(
      makeCart({ number: 'J0007', title: 'ID', runtime: '0:08', category: 'A' }),
    );
    const problems = auditCart(cart);
    expect(problems[0]?.code).toBe('LIB-028');
    expect(problems[0]?.detail?.['category']).toBe('A');
  });

  it('leaves a non music cart in X alone', () => {
    expect(
      auditCart(expectOk(makeCart({ number: 'C0455', title: 'Ford spot', runtime: '0:30' }))),
    ).toEqual([]);
  });
});

describe('describeCart', () => {
  it('names the cart, the title and the artist', () => {
    expect(describeCart(expectOk(makeCart(SONG)))).toBe(
      'M0142 Pancho and Lefty / Willie Nelson feat. Merle Haggard',
    );
  });

  it('leaves the artist off a cart that has none', () => {
    expect(
      describeCart(expectOk(makeCart({ number: 'J0007', title: 'Legal ID', runtime: '0:08' }))),
    ).toBe('J0007 Legal ID');
  });
});
