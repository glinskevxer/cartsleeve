import { describe, expect, it } from 'vitest';
import {
  BREAK_TOO_LONG,
  DEFAULT_BREAK_CEILING,
  DEFAULT_FLOOR_SHARE,
  HOUR_OVER_CEILING,
  HOUR_UNDERSOLD,
  auditLoad,
  hourLoad,
  isOverCeiling,
  overBy,
  remaining,
  summariseLoad,
} from '../../src/traffic/load.js';
import { fillStopset } from '../../src/traffic/stopset.js';
import { makeSpot } from '../../src/traffic/spot.js';
import type { Spot } from '../../src/traffic/spot.js';
import { fromMinutes, tenths } from '../../src/util/duration.js';
import { expectOk } from '../support/result.js';

const CEILING = fromMinutes(12);

function spot(id: string, length: string): Spot {
  return expectOk(makeSpot({ id, orderId: 'ORD-1', cart: 'C0455', length }));
}

/** A break holding `count` sixty second spots. */
function breakOf(name: string, count: number) {
  return fillStopset(
    name,
    fromMinutes(count),
    Array.from({ length: count }, (_, index) => spot(`${name}-${index}`, '1:00')),
  );
}

describe('hourLoad', () => {
  it('totals the commercial time and counts the breaks', () => {
    const load = hourLoad([breakOf('one', 3), breakOf('two', 2)], CEILING);
    expect(load.total).toBe(fromMinutes(5));
    expect(load.breaks).toBe(2);
  });

  it('finds the longest single break', () => {
    expect(hourLoad([breakOf('one', 3), breakOf('two', 5)], CEILING).longestBreak).toBe(
      fromMinutes(5),
    );
  });

  it('reports the load as a share of the ceiling', () => {
    expect(hourLoad([breakOf('one', 6)], CEILING).share).toBe(0.5);
  });

  it('reports nothing for an hour with no breaks', () => {
    const load = hourLoad([], CEILING);
    expect(load.total).toBe(0);
    expect(load.breaks).toBe(0);
    expect(load.share).toBe(0);
    expect(remaining(load)).toBe(CEILING);
  });

  it('survives a ceiling of nothing', () => {
    expect(hourLoad([breakOf('one', 3)], tenths(0)).share).toBe(0);
  });
});

describe('against the ceiling', () => {
  it('is not over when it is exactly on it', () => {
    const load = hourLoad([breakOf('one', 12)], CEILING);
    expect(isOverCeiling(load)).toBe(false);
    expect(overBy(load)).toBe(0);
    expect(remaining(load)).toBe(0);
  });

  it('is over by the difference when it passes it', () => {
    const load = hourLoad([breakOf('one', 14)], CEILING);
    expect(isOverCeiling(load)).toBe(true);
    expect(overBy(load)).toBe(fromMinutes(2));
    expect(remaining(load)).toBe(0);
  });

  it('reports the room left when it is under', () => {
    expect(remaining(hourLoad([breakOf('one', 5)], CEILING))).toBe(fromMinutes(7));
  });
});

describe('auditLoad', () => {
  it('says nothing about a healthy hour', () => {
    expect(auditLoad(hourLoad([breakOf('one', 3), breakOf('two', 3)], CEILING))).toEqual([]);
  });

  it('raises an hour past its ceiling as an error', () => {
    const found = auditLoad(hourLoad([breakOf('one', 14)], CEILING)).find(
      (each) => each.code === HOUR_OVER_CEILING,
    );
    expect(found?.severity).toBe('error');
    expect(found?.detail?.['minutes']).toBe(14);
    expect(found?.detail?.['ceiling']).toBe(12);
  });

  it('warns about a single break that runs too long', () => {
    const found = auditLoad(hourLoad([breakOf('one', 4)], CEILING)).find(
      (each) => each.code === BREAK_TOO_LONG,
    );
    expect(found?.severity).toBe('warning');
    expect(DEFAULT_BREAK_CEILING).toBe(1800);
  });

  it('honours a break ceiling that is given', () => {
    const load = hourLoad([breakOf('one', 4)], CEILING);
    // Four minutes of twelve is still undersold, so only the break warning lifts.
    expect(auditLoad(load).map((each) => each.code)).toContain(BREAK_TOO_LONG);
    expect(auditLoad(load, { breakCeiling: fromMinutes(5) }).map((each) => each.code)).toEqual([
      HOUR_UNDERSOLD,
    ]);
  });

  it('honours a floor share that is given', () => {
    const load = hourLoad([breakOf('one', 4)], CEILING);
    expect(auditLoad(load, { breakCeiling: fromMinutes(5), floorShare: 0.1 })).toEqual([]);
  });

  it('warns about an hour well under its ceiling', () => {
    const found = auditLoad(hourLoad([breakOf('one', 2)], CEILING)).find(
      (each) => each.code === HOUR_UNDERSOLD,
    );
    expect(found?.detail?.['share']).toBe(17);
    expect(DEFAULT_FLOOR_SHARE).toBeLessThan(1);
  });

  it('says nothing about an hour with no breaks at all', () => {
    expect(auditLoad(hourLoad([], CEILING))).toEqual([]);
  });

  it('can raise two findings at once', () => {
    expect(auditLoad(hourLoad([breakOf('one', 14)], CEILING)).map((each) => each.code)).toEqual([
      HOUR_OVER_CEILING,
      BREAK_TOO_LONG,
    ]);
  });
});

describe('summariseLoad', () => {
  it('averages across the hours', () => {
    const summary = summariseLoad([
      hourLoad([breakOf('a', 4)], CEILING),
      hourLoad([breakOf('b', 8)], CEILING),
    ]);
    expect(summary.hours).toBe(2);
    expect(summary.total).toBe(fromMinutes(12));
    expect(summary.average).toBe(fromMinutes(6));
    expect(summary.worst).toBe(fromMinutes(8));
  });

  it('counts the hours that went over', () => {
    const summary = summariseLoad([
      hourLoad([breakOf('a', 14)], CEILING),
      hourLoad([breakOf('b', 4)], CEILING),
      hourLoad([breakOf('c', 13)], CEILING),
    ]);
    expect(summary.overCeiling).toBe(2);
  });

  it('summarises nothing to zeroes', () => {
    expect(summariseLoad([])).toEqual({
      hours: 0,
      total: 0,
      average: 0,
      worst: 0,
      overCeiling: 0,
    });
  });
});
