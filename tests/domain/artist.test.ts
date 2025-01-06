import { describe, expect, it } from 'vitest';
import {
  artistKey,
  featuredOf,
  formatCredits,
  parseCredits,
  primaryOf,
  royaltyKeys,
  separationKeys,
  sortCredits,
} from '../../src/domain/artist.js';

describe('artistKey', () => {
  it('upper cases and strips punctuation', () => {
    expect(artistKey('Emmylou Harris')).toBe('EMMYLOU HARRIS');
    expect(artistKey('Guns N. Roses')).toBe('GUNS N ROSES');
    expect(artistKey("Sinead O'Connor")).toBe('SINEAD OCONNOR');
  });

  it('drops a leading the so the two spellings match', () => {
    expect(artistKey('The Band')).toBe('BAND');
    expect(artistKey('the band')).toBe('BAND');
    expect(artistKey('Band')).toBe('BAND');
  });

  it('keeps a the that is not leading', () => {
    expect(artistKey('Songs About The Rain')).toBe('SONGS ABOUT THE RAIN');
  });

  it('collapses runs of space and trims', () => {
    expect(artistKey('  Dolly   Parton ')).toBe('DOLLY PARTON');
  });
});

describe('parseCredits', () => {
  it('reads a single artist as one primary credit', () => {
    const credits = parseCredits('Emmylou Harris');
    expect(credits).toHaveLength(1);
    expect(credits[0]?.role).toBe('primary');
    expect(credits[0]?.name).toBe('Emmylou Harris');
    expect(credits[0]?.key).toBe('EMMYLOU HARRIS');
  });

  it('reads an empty billing as no credits', () => {
    expect(parseCredits('')).toEqual([]);
    expect(parseCredits('   ')).toEqual([]);
  });

  it('splits on every feature marker it knows', () => {
    for (const marker of ['featuring', 'feat.', 'feat', 'ft.', 'ft', 'with', 'duet with']) {
      const credits = parseCredits(`Willie Nelson ${marker} Merle Haggard`);
      expect(credits.map((c) => c.name)).toEqual(['Willie Nelson', 'Merle Haggard']);
      expect(credits[1]?.role).toBe('featured');
    }
  });

  it('is not case sensitive about the marker', () => {
    expect(parseCredits('Willie Nelson FEAT. Merle Haggard')).toHaveLength(2);
    expect(parseCredits('Willie Nelson Feat Merle Haggard')).toHaveLength(2);
  });

  it('splits several featured artists on commas and ampersands', () => {
    const credits = parseCredits('Kendrick Lamar feat. SZA, Jay Rock & Ab-Soul');
    expect(credits.map((c) => c.name)).toEqual(['Kendrick Lamar', 'SZA', 'Jay Rock', 'Ab-Soul']);
    expect(featuredOf(credits)).toHaveLength(3);
  });

  it('keeps an ampersand inside a band name rather than splitting on it', () => {
    for (const band of ['Hall & Oates', 'Earth, Wind & Fire', 'Booker T. & the MGs']) {
      const credits = parseCredits(band);
      expect(credits).toHaveLength(1);
      expect(credits[0]?.name).toBe(band);
    }
  });

  it('keeps the band name whole even when it is featured on something', () => {
    const credits = parseCredits('Bonnie Raitt feat. Hall & Oates');
    expect(credits.map((c) => c.name)).toEqual(['Bonnie Raitt', 'Hall', 'Oates']);
  });

  it('drops a repeated credit rather than counting the artist twice', () => {
    const credits = parseCredits('Dolly Parton feat. Dolly Parton, Kenny Rogers');
    expect(credits.map((c) => c.name)).toEqual(['Dolly Parton', 'Kenny Rogers']);
  });

  it('takes the earliest marker when a billing carries two', () => {
    const credits = parseCredits('A feat. B with C');
    expect(credits[0]?.name).toBe('A');
    expect(credits.map((c) => c.name)).toContain('B with C');
  });

  it('reads the primary and the featured back out', () => {
    const credits = parseCredits('Willie Nelson feat. Merle Haggard');
    expect(primaryOf(credits)?.name).toBe('Willie Nelson');
    expect(featuredOf(credits).map((c) => c.name)).toEqual(['Merle Haggard']);
    expect(primaryOf([])).toBeUndefined();
  });
});

describe('the two readings of a credit', () => {
  const collaboration = parseCredits('Kendrick Lamar feat. SZA, Jay Rock');

  it('counts only the billed primary for separation under the billed policy', () => {
    expect(separationKeys(collaboration, 'billed')).toEqual(['KENDRICK LAMAR']);
  });

  it('counts every credit for separation under the strict policy', () => {
    expect(separationKeys(collaboration, 'strict')).toEqual(['KENDRICK LAMAR', 'SZA', 'JAY ROCK']);
  });

  it('always counts every credit for royalty whatever the policy', () => {
    expect(royaltyKeys(collaboration)).toEqual(['KENDRICK LAMAR', 'SZA', 'JAY ROCK']);
  });

  it('makes the two readings disagree, which is the whole point', () => {
    expect(separationKeys(collaboration, 'billed')).not.toEqual(royaltyKeys(collaboration));
    expect(separationKeys(collaboration, 'strict')).toEqual(royaltyKeys(collaboration));
  });

  it('agrees on a solo record under either policy', () => {
    const solo = parseCredits('Emmylou Harris');
    expect(separationKeys(solo, 'billed')).toEqual(royaltyKeys(solo));
    expect(separationKeys(solo, 'strict')).toEqual(royaltyKeys(solo));
  });

  it('returns nothing for an empty billing', () => {
    expect(separationKeys([], 'billed')).toEqual([]);
    expect(royaltyKeys([])).toEqual([]);
  });
});

describe('presentation', () => {
  it('formats a solo credit as the bare name', () => {
    expect(formatCredits(parseCredits('Emmylou Harris'))).toBe('Emmylou Harris');
    expect(formatCredits([])).toBe('');
  });

  it('formats a collaboration with one feat. and a comma list', () => {
    expect(formatCredits(parseCredits('Kendrick Lamar ft. SZA, Jay Rock'))).toBe(
      'Kendrick Lamar feat. SZA, Jay Rock',
    );
  });

  it('sorts the primary first and the featured by name', () => {
    const sorted = sortCredits(parseCredits('Kendrick Lamar feat. SZA, Ab-Soul'));
    expect(sorted.map((c) => c.name)).toEqual(['Kendrick Lamar', 'Ab-Soul', 'SZA']);
  });
});
