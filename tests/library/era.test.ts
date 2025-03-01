import { describe, expect, it } from 'vitest';
import {
  CLASSIC_HITS_BANDS,
  COUNTRY_BANDS,
  bandFor,
  bandWidth,
  describeBand,
  eraOf,
  eraSpread,
  gaps,
  makeEraMap,
} from '../../src/library/era.js';
import { expectErr, expectOk } from '../support/result.js';

const classic = () => expectOk(makeEraMap(CLASSIC_HITS_BANDS));
const country = () => expectOk(makeEraMap(COUNTRY_BANDS));

describe('makeEraMap', () => {
  it('sorts the bands by their first year', () => {
    const map = expectOk(
      makeEraMap([
        { name: 'late', fromYear: 1980, toYear: 1986 },
        { name: 'early', fromYear: 1964, toYear: 1971 },
      ]),
    );
    expect(map.bands.map((b) => b.name)).toEqual(['early', 'late']);
  });

  it('rejects a map with no bands', () => {
    expect(expectErr(makeEraMap([]))[0]?.code).toBe('LIB-070');
  });

  it('rejects an unnamed band and a name used twice', () => {
    expect(expectErr(makeEraMap([{ name: ' ', fromYear: 1964, toYear: 1971 }]))[0]?.code).toBe(
      'LIB-071',
    );
    const problems = expectErr(
      makeEraMap([
        { name: 'early', fromYear: 1964, toYear: 1971 },
        { name: 'early', fromYear: 1972, toYear: 1979 },
      ]),
    );
    expect(problems[0]?.code).toBe('LIB-072');
  });

  it('rejects a band that runs backwards', () => {
    const problems = expectErr(makeEraMap([{ name: 'x', fromYear: 1980, toYear: 1970 }]));
    expect(problems[0]?.code).toBe('LIB-073');
    expect(problems[0]?.detail?.['from']).toBe(1980);
  });

  it('accepts a band covering a single year', () => {
    expect(expectOk(makeEraMap([{ name: 'x', fromYear: 1977, toYear: 1977 }])).bands).toHaveLength(
      1,
    );
  });

  it('rejects two bands that overlap and names the earlier one', () => {
    const problems = expectErr(
      makeEraMap([
        { name: 'early', fromYear: 1964, toYear: 1975 },
        { name: 'peak', fromYear: 1972, toYear: 1979 },
      ]),
    );
    expect(problems[0]?.code).toBe('LIB-074');
    expect(problems[0]?.detail?.['previous']).toBe('early');
  });

  it('accepts two bands that touch without overlapping', () => {
    expect(
      expectOk(
        makeEraMap([
          { name: 'early', fromYear: 1964, toYear: 1971 },
          { name: 'peak', fromYear: 1972, toYear: 1979 },
        ]),
      ).bands,
    ).toHaveLength(2);
  });

  it('allows a gap between two bands', () => {
    expect(
      expectOk(
        makeEraMap([
          { name: 'early', fromYear: 1964, toYear: 1971 },
          { name: 'late', fromYear: 1980, toYear: 1986 },
        ]),
      ).bands,
    ).toHaveLength(2);
  });
});

describe('placing a year', () => {
  it('finds the band a year sits in, on both bounds', () => {
    expect(eraOf(classic(), 1964)).toBe('early');
    expect(eraOf(classic(), 1971)).toBe('early');
    expect(eraOf(classic(), 1972)).toBe('peak');
    expect(eraOf(classic(), 1994)).toBe('tail');
  });

  it('calls a year outside every band unbanded', () => {
    expect(eraOf(classic(), 1955)).toBe('unbanded');
    expect(eraOf(classic(), 2001)).toBe('unbanded');
    expect(bandFor(classic(), 2001)).toBeUndefined();
  });

  it('bands the same year differently on two formats, which is the point', () => {
    expect(eraOf(classic(), 1978)).toBe('peak');
    expect(eraOf(country(), 1978)).toBe('outlaw');
    expect(eraOf(classic(), 1985)).toBe('late');
    expect(eraOf(country(), 1985)).toBe('outlaw');
  });

  it('measures a band width inclusively', () => {
    expect(bandWidth({ name: 'x', fromYear: 1972, toYear: 1979 })).toBe(8);
    expect(bandWidth({ name: 'x', fromYear: 1977, toYear: 1977 })).toBe(1);
  });
});

describe('gaps', () => {
  it('finds years no band claims', () => {
    const map = expectOk(
      makeEraMap([
        { name: 'early', fromYear: 1964, toYear: 1971 },
        { name: 'late', fromYear: 1980, toYear: 1986 },
      ]),
    );
    expect(gaps(map, 1964, 1986)).toEqual([1972, 1973, 1974, 1975, 1976, 1977, 1978, 1979]);
  });

  it('finds none when the bands are contiguous', () => {
    expect(gaps(classic(), 1964, 1994)).toEqual([]);
  });

  it('finds everything outside the banded range', () => {
    expect(gaps(classic(), 1960, 1963)).toEqual([1960, 1961, 1962, 1963]);
  });
});

describe('eraSpread', () => {
  it('counts one for a run all from the same band', () => {
    expect(eraSpread(classic(), [1973, 1975, 1978, 1979])).toBe(1);
  });

  it('counts one per distinct band', () => {
    expect(eraSpread(classic(), [1966, 1975, 1983, 1990])).toBe(4);
    expect(eraSpread(classic(), [1966, 1968, 1983, 1990])).toBe(3);
  });

  it('gives a different answer for the same years on a different format', () => {
    const years = [1976, 1982, 1985, 1988];
    expect(eraSpread(classic(), years)).toBe(3);
    expect(eraSpread(country(), years)).toBe(1);
  });

  it('counts unbanded years as one band between them', () => {
    expect(eraSpread(classic(), [2001, 2005])).toBe(1);
  });

  it('is zero for no years', () => {
    expect(eraSpread(classic(), [])).toBe(0);
  });

  it('describes a band for a report', () => {
    expect(describeBand({ name: 'peak', fromYear: 1972, toYear: 1979 })).toBe('peak 1972 to 1979');
  });
});
