import { describe, expect, it } from 'vitest';
import {
  countsFeatured,
  describeStation,
  makeStation,
  makeStations,
} from '../../src/domain/station.js';
import type { StationInput } from '../../src/domain/station.js';
import { ARIZONA, MOUNTAIN } from '../../src/util/time.js';
import { expectErr, expectOk } from '../support/result.js';

const BASE: StationInput = { callSign: 'KHRT', name: 'Heart Country', format: 'country' };

describe('makeStation', () => {
  it('builds a station from the least it needs', () => {
    const station = expectOk(makeStation(BASE));
    expect(station.callSign).toBe('KHRT');
    expect(station.name).toBe('Heart Country');
    expect(station.format).toBe('country');
  });

  it('defaults the day to midnight, the ceiling to twelve minutes and credit to billed', () => {
    const station = expectOk(makeStation(BASE));
    expect(station.dayStartHour).toBe(0);
    expect(station.spotCeiling).toBe(7200);
    expect(station.creditPolicy).toBe('billed');
    expect(station.reportingMode).toBe('census');
    expect(station.zone).toBe(MOUNTAIN);
  });

  it('takes the values it is given', () => {
    const station = expectOk(
      makeStation({
        ...BASE,
        zone: ARIZONA,
        dayStartHour: 5,
        spotMinutes: 10,
        creditPolicy: 'strict',
        reportingMode: 'sampled',
      }),
    );
    expect(station.dayStartHour).toBe(5);
    expect(station.spotCeiling).toBe(6000);
    expect(station.creditPolicy).toBe('strict');
    expect(station.reportingMode).toBe('sampled');
    expect(station.zone.label).toBe('US/Arizona');
  });

  it('trims the name and the format', () => {
    const station = expectOk(makeStation({ ...BASE, name: '  Heart  ', format: ' country ' }));
    expect(station.name).toBe('Heart');
    expect(station.format).toBe('country');
  });

  it('rejects a call sign that is not one', () => {
    expect(expectErr(makeStation({ ...BASE, callSign: 'XX' }))[0]?.code).toBe('LIB-001');
  });

  it('rejects an empty name', () => {
    expect(expectErr(makeStation({ ...BASE, name: '   ' }))[0]?.code).toBe('LIB-002');
  });

  it('rejects a day start hour outside the day', () => {
    for (const hour of [-1, 24, 2.5]) {
      const problems = expectErr(makeStation({ ...BASE, dayStartHour: hour }));
      expect(problems[0]?.code).toBe('LIB-003');
      expect(problems[0]?.detail?.['given']).toBe(hour);
    }
  });

  it('accepts both ends of the day', () => {
    expect(expectOk(makeStation({ ...BASE, dayStartHour: 0 })).dayStartHour).toBe(0);
    expect(expectOk(makeStation({ ...BASE, dayStartHour: 23 })).dayStartHour).toBe(23);
  });

  it('rejects a spot ceiling that does not fit in an hour', () => {
    expect(expectErr(makeStation({ ...BASE, spotMinutes: 61 }))[0]?.code).toBe('LIB-004');
    expect(expectErr(makeStation({ ...BASE, spotMinutes: -1 }))[0]?.code).toBe('LIB-004');
  });

  it('reports every problem at once rather than the first', () => {
    const problems = expectErr(
      makeStation({ callSign: 'XX', name: '', format: 'country', dayStartHour: 99 }),
    );
    expect(problems.map((p) => p.code)).toEqual(['LIB-001', 'LIB-002', 'LIB-003']);
  });
});

describe('makeStations', () => {
  it('builds a whole group', () => {
    const group = expectOk(
      makeStations([BASE, { callSign: 'KJZR', name: 'Jazz River', format: 'jazz' }]),
    );
    expect(group.map((s) => s.callSign)).toEqual(['KHRT', 'KJZR']);
  });

  it('flattens the problems from every station that failed', () => {
    const problems = expectErr(makeStations([BASE, { callSign: 'XX', name: '', format: 'jazz' }]));
    expect(problems.map((p) => p.code)).toEqual(['LIB-001', 'LIB-002']);
  });

  it('treats an empty group as success', () => {
    expect(expectOk(makeStations([]))).toEqual([]);
  });
});

describe('the credit policy', () => {
  it('says whether a featured credit counts for separation', () => {
    expect(countsFeatured(expectOk(makeStation(BASE)))).toBe(false);
    expect(countsFeatured(expectOk(makeStation({ ...BASE, creditPolicy: 'strict' })))).toBe(true);
  });
});

describe('describeStation', () => {
  it('names the sign, the format, the day start and the zone', () => {
    const station = expectOk(makeStation({ ...BASE, dayStartHour: 5 }));
    expect(describeStation(station)).toBe(
      'KHRT Heart Country (country, day starts 05:00 US/Mountain)',
    );
  });
});
