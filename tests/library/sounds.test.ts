import { describe, expect, it } from 'vitest';
import {
  EMPTY_SOUND_INDEX,
  STANDARD_FAMILIES,
  clash,
  familiesFor,
  familyFor,
  makeSoundIndex,
  sharedFamilies,
  unfamilied,
} from '../../src/library/sounds.js';
import { expectErr, expectOk } from '../support/result.js';

const index = () => expectOk(makeSoundIndex(STANDARD_FAMILIES));

describe('makeSoundIndex', () => {
  it('builds a family per definition and normalises every code', () => {
    const built = index();
    expect(built.families).toHaveLength(5);
    expect(built.familyOf.get('PEDALSTEEL')).toBe('STEEL');
    expect(built.familyOf.get('STEELGTR')).toBe('STEEL');
    expect(built.familyOf.get('DRUMMACHINE')).toBe('MACHINE');
  });

  it('upper cases the family name', () => {
    expect(expectOk(makeSoundIndex({ steel: ['dobro'] })).families[0]?.name).toBe('STEEL');
  });

  it('accepts an empty definition set', () => {
    expect(expectOk(makeSoundIndex({})).families).toEqual([]);
  });

  it('rejects a family with no name or no codes', () => {
    expect(expectErr(makeSoundIndex({ '  ': ['fiddle'] }))[0]?.code).toBe('LIB-060');
    expect(expectErr(makeSoundIndex({ steel: [] }))[0]?.code).toBe('LIB-063');
  });

  it('rejects an empty code', () => {
    expect(expectErr(makeSoundIndex({ steel: ['dobro', ' '] }))[0]?.code).toBe('LIB-061');
  });

  it('rejects one code claimed by two families and names both', () => {
    const problems = expectErr(makeSoundIndex({ steel: ['dobro'], strings: ['dobro', 'fiddle'] }));
    expect(problems[0]?.code).toBe('LIB-062');
    expect(problems[0]?.detail?.['first']).toBe('STEEL');
    expect(problems[0]?.detail?.['second']).toBe('STRINGS');
  });

  it('accepts the same code listed twice inside one family', () => {
    const built = expectOk(makeSoundIndex({ steel: ['dobro', 'DOBRO', 'dobro'] }));
    expect(built.families[0]?.codes.size).toBe(1);
  });
});

describe('familyFor', () => {
  it('finds the family of a coded sound', () => {
    expect(familyFor(index(), 'pedal steel')).toBe('STEEL');
    expect(familyFor(index(), 'FIDDLE')).toBe('FIDDLE');
  });

  it('makes an uncoded sound its own family rather than nothing', () => {
    expect(familyFor(index(), 'accordion')).toBe('ACCORDION');
    expect(familyFor(EMPTY_SOUND_INDEX, 'fiddle')).toBe('FIDDLE');
  });

  it('collapses a list to distinct families, in order', () => {
    expect(familiesFor(index(), ['fiddle', 'strings', 'banjo', 'violin'])).toEqual([
      'FIDDLE',
      'BANJO',
    ]);
    expect(familiesFor(index(), [])).toEqual([]);
    expect(familiesFor(index(), ['  '])).toEqual([]);
  });
});

describe('the clash the separation rule fires on', () => {
  it('sees two spellings of one sound as the same family', () => {
    expect(clash(index(), ['steel gtr'], ['pedal steel'])).toBe(true);
    expect(sharedFamilies(index(), ['steel gtr'], ['pedal steel'])).toEqual(['STEEL']);
  });

  it('does not see two genuinely different sounds as clashing', () => {
    expect(clash(index(), ['steel gtr'], ['banjo'])).toBe(false);
    expect(sharedFamilies(index(), ['steel gtr'], ['banjo'])).toEqual([]);
  });

  it('degrades to exact matching for uncoded sounds', () => {
    expect(clash(index(), ['accordion'], ['accordion'])).toBe(true);
    expect(clash(index(), ['accordion'], ['harmonica'])).toBe(false);
  });

  it('would miss the clash if there were no families at all', () => {
    expect(clash(EMPTY_SOUND_INDEX, ['steel gtr'], ['pedal steel'])).toBe(false);
    expect(clash(index(), ['steel gtr'], ['pedal steel'])).toBe(true);
  });

  it('reports every shared family when carts share more than one', () => {
    expect(sharedFamilies(index(), ['fiddle', 'dobro'], ['violin', 'lap steel'])).toEqual([
      'FIDDLE',
      'STEEL',
    ]);
  });

  it('never clashes when either side has no codes', () => {
    expect(clash(index(), [], ['fiddle'])).toBe(false);
    expect(clash(index(), ['fiddle'], [])).toBe(false);
    expect(clash(index(), [], [])).toBe(false);
  });
});

describe('unfamilied', () => {
  it('lists the codes nobody placed in a family', () => {
    expect(unfamilied(index(), ['fiddle', 'accordion', 'harmonica'])).toEqual([
      'ACCORDION',
      'HARMONICA',
    ]);
  });

  it('reports each one once and skips blanks', () => {
    expect(unfamilied(index(), ['accordion', 'ACCORDION', ' '])).toEqual(['ACCORDION']);
  });

  it('reports nothing when every code is placed', () => {
    expect(unfamilied(index(), ['fiddle', 'banjo', 'dobro'])).toEqual([]);
  });

  it('reports everything when no families are defined', () => {
    expect(unfamilied(EMPTY_SOUND_INDEX, ['fiddle', 'banjo'])).toEqual(['FIDDLE', 'BANJO']);
  });
});
