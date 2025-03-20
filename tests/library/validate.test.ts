import { beforeEach, describe, expect, it } from 'vitest';
import { artistCeiling, validateLibrary } from '../../src/library/validate.js';
import type { ValidationOptions, ValidationReport } from '../../src/library/validate.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import type { Category } from '../../src/domain/category.js';
import type { CategoryCode } from '../../src/util/ids.js';
import { STANDARD_FAMILIES, makeSoundIndex } from '../../src/library/sounds.js';
import { library, resetFixtures, station } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

const CATEGORIES = new Map<CategoryCode, Category>(
  STANDARD_CATEGORIES.map((input) => {
    const built = expectOk(makeCategory(input));
    return [built.code, built];
  }),
);

function category(code: string): Category {
  const found = CATEGORIES.get(code as CategoryCode);
  if (found === undefined) {
    throw new Error(`no fixture category ${code}`);
  }
  return found;
}

function only(code: string): Map<CategoryCode, Category> {
  const built = category(code);
  return new Map([[built.code, built]]);
}

const options = (over: Partial<ValidationOptions> = {}): ValidationOptions => ({
  station: station(),
  categories: CATEGORIES,
  sounds: expectOk(makeSoundIndex(STANDARD_FAMILIES)),
  currentYear: 2025,
  minimumCategorySize: 3,
  ...over,
});

const codes = (report: ValidationReport): string[] => report.problems.map((p) => p.code);

beforeEach(() => {
  resetFixtures();
});

describe('artistCeiling', () => {
  it('allows more of one artist in a bigger category', () => {
    expect(artistCeiling(40, 60)).toBeLessThan(artistCeiling(200, 60));
  });

  it('allows fewer as the separation minimum grows', () => {
    expect(artistCeiling(100, 75)).toBeLessThan(artistCeiling(100, 30));
  });

  it('never allows fewer than one', () => {
    expect(artistCeiling(3, 240)).toBe(1);
    expect(artistCeiling(1, 75)).toBe(1);
  });

  it('allows the whole category when there is no minimum', () => {
    expect(artistCeiling(40, 0)).toBe(40);
  });
});

describe('per cart findings', () => {
  it('counts the carts, the music and the coded', () => {
    const built = library([
      { number: 'M0001', category: 'A' },
      { number: 'J0002', billed: '', category: 'X' },
    ]);
    const report = validateLibrary(built, options());
    expect(report.carts).toBe(2);
    expect(report.music).toBe(1);
    expect(report.coded).toBe(0);
  });

  it('flags a music cart with no recording coded', () => {
    const built = library([{ number: 'M0001', category: 'A', noRecording: true }]);
    expect(codes(validateLibrary(built, options()))).toContain('LIB-104');
  });

  it('notes a music cart with no attributes coded, at info', () => {
    const built = library([{ number: 'M0001', category: 'A' }]);
    const report = validateLibrary(built, options());
    expect(report.problems.find((p) => p.code === 'LIB-105')?.severity).toBe('info');
  });

  it('flags a cart carded into a category nothing defines', () => {
    const built = library([{ number: 'M0001', category: 'Z' }]);
    const found = validateLibrary(built, options()).problems.find((p) => p.code === 'LIB-106');
    expect(found?.severity).toBe('error');
    expect(found?.detail?.['category']).toBe('Z');
  });
});

describe('per category findings', () => {
  it('flags a rotating category with nothing in it', () => {
    const built = library([{ number: 'M0001', category: 'A' }]);
    expect(codes(validateLibrary(built, options()))).toContain('LIB-100');
  });

  it('flags a category too small to rotate', () => {
    const built = library([
      { number: 'M0001', category: 'A' },
      { number: 'M0002', category: 'A' },
    ]);
    const found = validateLibrary(built, options({ categories: only('A') })).problems.find(
      (p) => p.code === 'LIB-101',
    );
    expect(found?.detail?.['size']).toBe(2);
    expect(found?.detail?.['wanted']).toBe(3);
  });

  it('flags a category with fewer carts than packets', () => {
    const four = expectOk(makeCategory({ code: 'G', name: 'Gold', packets: 4 }));
    const built = library([
      { number: 'M0001', category: 'G' },
      { number: 'M0002', category: 'G' },
    ]);
    const found = validateLibrary(
      built,
      options({ categories: new Map([[four.code, four]]), minimumCategorySize: 1 }),
    ).problems.find((p) => p.code === 'LIB-102');
    expect(found?.severity).toBe('error');
    expect(found?.detail?.['packets']).toBe(4);
  });

  it('leaves a healthy category alone', () => {
    const built = library([
      { number: 'M0001', category: 'A', billed: 'Dolly Parton' },
      { number: 'M0002', category: 'A', billed: 'Johnny Cash' },
      { number: 'M0003', category: 'A', billed: 'Emmylou Harris' },
      { number: 'M0004', category: 'A', billed: 'Merle Haggard' },
    ]);
    const report = validateLibrary(built, options({ categories: only('A') }));
    expect(codes(report).filter((code) => code !== 'LIB-105')).toEqual([]);
  });

  it('flags a category holding more of one artist than separation allows', () => {
    const built = library(
      Array.from({ length: 6 }, (_, index) => ({
        number: `M000${index + 1}`,
        category: 'A',
        billed: 'Dolly Parton',
      })),
    );
    const found = validateLibrary(
      built,
      options({ categories: only('A'), minimumCategorySize: 1 }),
    ).problems.find((p) => p.code === 'LIB-103');
    expect(found?.detail?.['artist']).toBe('DOLLY PARTON');
    expect(found?.detail?.['count']).toBe(6);
  });
});

describe('the credit policy changes what the library looks like', () => {
  const specs = [
    ...Array.from({ length: 5 }, (_, index) => ({
      number: `M000${index + 1}`,
      category: 'A',
      billed: `Artist ${index} feat. Dolly Parton`,
    })),
    { number: 'M0006', category: 'A', billed: 'Dolly Parton' },
  ];

  it('counts a guest appearance toward the ceiling only under strict credit', () => {
    const billed = validateLibrary(
      library(specs),
      options({ categories: only('A'), minimumCategorySize: 1 }),
    );
    resetFixtures();
    const strict = validateLibrary(
      library(specs),
      options({
        categories: only('A'),
        minimumCategorySize: 1,
        station: station({ creditPolicy: 'strict' }),
      }),
    );
    expect(codes(billed)).not.toContain('LIB-103');
    expect(codes(strict)).toContain('LIB-103');
  });
});

describe('findings that only show up across the library', () => {
  it('notes a master carded more than once', () => {
    const built = library([
      { number: 'M0001', category: 'A', isrc: 'USRC17607839' },
      { number: 'M0002', category: 'G', isrc: 'USRC17607839' },
    ]);
    const found = validateLibrary(built, options()).problems.find((p) => p.code === 'LIB-107');
    expect(found?.detail?.['carts']).toBe('M0001 M0002');
    expect(found?.severity).toBe('info');
  });

  it('notes a sound code in no family', () => {
    const built = library([{ number: 'M0001', category: 'A' }]);
    const coded = {
      ...built,
      entries: built.entries.map((entry) => ({
        ...entry,
        attributes: {
          tempo: 'medium' as const,
          mood: 'neutral' as const,
          texture: 'band' as const,
          sounds: ['ACCORDION'],
        },
      })),
    };
    const report = validateLibrary(coded, options());
    expect(report.problems.find((p) => p.code === 'LIB-108')?.subject).toBe('ACCORDION');
    expect(report.coded).toBe(1);
  });

  it('says nothing about a sound code that is in a family', () => {
    const built = library([{ number: 'M0001', category: 'A' }]);
    const coded = {
      ...built,
      entries: built.entries.map((entry) => ({
        ...entry,
        attributes: {
          tempo: 'medium' as const,
          mood: 'neutral' as const,
          texture: 'band' as const,
          sounds: ['FIDDLE'],
        },
      })),
    };
    expect(codes(validateLibrary(coded, options()))).not.toContain('LIB-108');
  });

  it('reports an empty library as nothing but empty categories', () => {
    const report = validateLibrary(library([]), options());
    expect(report.carts).toBe(0);
    expect(new Set(codes(report))).toEqual(new Set(['LIB-100']));
  });
});
