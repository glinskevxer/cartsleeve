import { beforeEach, describe, expect, it } from 'vitest';
import {
  byArtist,
  doubleCarded,
  inCategory,
  lookup,
  makeLibrary,
  musicSize,
  sameRecording,
  sameTitle,
  size,
  withEntry,
  withoutCart,
} from '../../src/library/library.js';
import type { CartNumber, Isrc } from '../../src/util/ids.js';
import { entry, library, resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

describe('building a library', () => {
  it('indexes by cart number', () => {
    const built = library([{ number: 'M0001' }, { number: 'M0002' }]);
    expect(size(built)).toBe(2);
    expect(lookup(built, 'M0001' as CartNumber)?.cart.number).toBe('M0001');
    expect(lookup(built, 'M9999' as CartNumber)).toBeUndefined();
  });

  it('indexes by category and keeps input order inside each', () => {
    const built = library([
      { number: 'M0001', category: 'A' },
      { number: 'M0002', category: 'G' },
      { number: 'M0003', category: 'A' },
    ]);
    expect(inCategory(built, 'A' as never).map((e) => e.cart.number)).toEqual(['M0001', 'M0003']);
    expect(inCategory(built, 'G' as never)).toHaveLength(1);
    expect(inCategory(built, 'B' as never)).toEqual([]);
  });

  it('counts music separately from everything on the rack', () => {
    const built = library([
      { number: 'M0001' },
      { number: 'J0002', billed: '', category: 'X' },
      { number: 'C0003', billed: '', category: 'X' },
    ]);
    expect(size(built)).toBe(3);
    expect(musicSize(built)).toBe(1);
  });

  it('handles an empty library', () => {
    const built = makeLibrary([]);
    expect(size(built)).toBe(0);
    expect(musicSize(built)).toBe(0);
    expect(inCategory(built, 'A' as never)).toEqual([]);
    expect(doubleCarded(built)).toEqual([]);
  });

  it('leaves a cart with no recording out of the recording indexes', () => {
    const built = library([{ number: 'J0001', billed: '', category: 'X', noRecording: true }]);
    expect(size(built)).toBe(1);
    expect(sameRecording(built, 'USTST2500001' as Isrc)).toEqual([]);
  });
});

describe('the recording join', () => {
  it('finds every cart that shares one master', () => {
    const shared = 'USRC17607839';
    const built = library([
      { number: 'M0001', isrc: shared, recordingTitle: 'Jolene' },
      { number: 'M0002', isrc: shared, recordingTitle: 'Jolene' },
      { number: 'M0003', recordingTitle: 'Jolene' },
    ]);
    expect(sameRecording(built, shared as Isrc).map((e) => e.cart.number)).toEqual([
      'M0001',
      'M0002',
    ]);
  });

  it('finds every cart of a title, covers included', () => {
    const built = library([
      { number: 'M0001', recordingTitle: 'Jolene' },
      { number: 'M0002', recordingTitle: 'Jolene (Single Edit)' },
      { number: 'M0003', recordingTitle: 'Ring of Fire' },
    ]);
    expect(sameTitle(built, 'JOLENE').map((e) => e.cart.number)).toEqual(['M0001', 'M0002']);
    expect(sameTitle(built, 'NOTHING')).toEqual([]);
  });

  it('reports masters that were carded twice', () => {
    const shared = 'USRC17607839';
    const built = library([
      { number: 'M0001', isrc: shared },
      { number: 'M0002', isrc: shared },
      { number: 'M0003' },
    ]);
    const doubles = doubleCarded(built);
    expect(doubles).toHaveLength(1);
    expect(doubles[0]?.map((e) => e.cart.number)).toEqual(['M0001', 'M0002']);
  });

  it('reports nothing when every master is carded once', () => {
    expect(doubleCarded(library([{ number: 'M0001' }, { number: 'M0002' }]))).toEqual([]);
  });
});

describe('byArtist under each policy', () => {
  const built = () =>
    library([
      { number: 'M0001', billed: 'Kendrick Lamar feat. SZA' },
      { number: 'M0002', billed: 'SZA' },
      { number: 'M0003', billed: 'Emmylou Harris' },
    ]);

  it('hides a guest appearance under the billed policy', () => {
    expect(byArtist(built(), 'SZA', 'billed').map((e) => e.cart.number)).toEqual(['M0002']);
  });

  it('finds the guest appearance under the strict policy', () => {
    expect(byArtist(built(), 'SZA', 'strict').map((e) => e.cart.number)).toEqual([
      'M0001',
      'M0002',
    ]);
  });

  it('agrees on an artist who never guests', () => {
    expect(byArtist(built(), 'EMMYLOU HARRIS', 'billed')).toHaveLength(1);
    expect(byArtist(built(), 'EMMYLOU HARRIS', 'strict')).toHaveLength(1);
  });

  it('finds nothing for an artist not in the library', () => {
    expect(byArtist(built(), 'NOBODY', 'strict')).toEqual([]);
  });
});

describe('changing a library', () => {
  it('adds an entry and reindexes', () => {
    const built = library([{ number: 'M0001' }]);
    const grown = withEntry(built, entry({ number: 'M0002', category: 'G' }));
    expect(size(grown)).toBe(2);
    expect(inCategory(grown, 'G' as never)).toHaveLength(1);
    expect(size(built)).toBe(1);
  });

  it('replaces an entry with the same number rather than duplicating it', () => {
    const built = library([{ number: 'M0001', category: 'A' }]);
    const replaced = withEntry(built, entry({ number: 'M0001', category: 'G' }));
    expect(size(replaced)).toBe(1);
    expect(inCategory(replaced, 'A' as never)).toEqual([]);
    expect(inCategory(replaced, 'G' as never)).toHaveLength(1);
  });

  it('removes a cart and reindexes', () => {
    const built = library([{ number: 'M0001' }, { number: 'M0002' }]);
    const shrunk = withoutCart(built, 'M0001' as CartNumber);
    expect(size(shrunk)).toBe(1);
    expect(lookup(shrunk, 'M0001' as CartNumber)).toBeUndefined();
  });

  it('removing a cart that is not there changes nothing', () => {
    const built = library([{ number: 'M0001' }]);
    expect(size(withoutCart(built, 'M9999' as CartNumber))).toBe(1);
  });
});
