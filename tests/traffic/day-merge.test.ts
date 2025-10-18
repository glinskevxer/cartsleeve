import { beforeEach, describe, expect, it } from 'vitest';
import {
  DAY_DRIFTED,
  ORPHANED_BREAK,
  clockHourOf,
  dayMusic,
  definedBreaks,
  hourIndexOf,
  mergeDay,
  orphanedBreaks,
} from '../../src/traffic/day-merge.js';
import { fillDay } from '../../src/schedule/day.js';
import { makeSpot } from '../../src/traffic/spot.js';
import type { Spot } from '../../src/traffic/spot.js';
import { tenths } from '../../src/util/duration.js';
import type { EntrySpec } from '../support/fixtures.js';
import { resetFixtures } from '../support/fixtures.js';
import { clockOf, dayInput, libraryOf } from '../support/hour.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const ERA_YEARS = [1965, 1980, 1995, 2010];

const SONGS: EntrySpec[] = Array.from({ length: 20 }, (_, index) => ({
  number: `M${String(index + 1).padStart(4, '0')}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
}));

function spot(id: string, length: string): Spot {
  return expectOk(makeSpot({ id, orderId: 'ORD-1', cart: 'C0455', length }));
}

const CLOCK = () =>
  clockOf([
    { kind: 'music', target: '0:00', category: 'A' },
    { kind: 'stopset', target: '3:00', name: 'break one', budget: '2:00' },
    { kind: 'music', target: '5:00', category: 'A' },
  ]);

/** Three hours starting at 05:00. */
const scheduled = () =>
  fillDay(dayInput({ clock: CLOCK(), library: libraryOf(SONGS), hours: 3, dayStartHour: 5 }));

const onBudget = (): Spot[] => [spot('SPT-1', '1:00'), spot('SPT-2', '1:00')];
const short = (): Spot[] => [spot('SPT-1', '0:30')];

describe('translating hours', () => {
  it('turns an hour index into a wall clock hour', () => {
    expect(clockHourOf(5, 0)).toBe(5);
    expect(clockHourOf(5, 7)).toBe(12);
    expect(clockHourOf(5, 21)).toBe(2);
  });

  it('turns a wall clock hour back into an hour index', () => {
    expect(hourIndexOf(5, 5)).toBe(0);
    expect(hourIndexOf(5, 12)).toBe(7);
    expect(hourIndexOf(5, 2)).toBe(21);
  });

  it('round trips every hour of the day', () => {
    for (let index = 0; index < 24; index += 1) {
      expect(hourIndexOf(5, clockHourOf(5, index))).toBe(index);
    }
  });

  it('is the identity on a day that starts at midnight', () => {
    for (let index = 0; index < 24; index += 1) {
      expect(clockHourOf(0, index)).toBe(index);
    }
  });
});

describe('mergeDay', () => {
  it('merges every hour and labels it with its wall clock hour', () => {
    const outcome = mergeDay({ hours: scheduled().hours, dayStartHour: 5, spotsFor: onBudget });
    expect(outcome.hours).toHaveLength(3);
    expect(outcome.hours.map((hour) => hour.clockHour)).toEqual([5, 6, 7]);
  });

  it('asks traffic for each break by its wall clock hour', () => {
    const asked: number[] = [];
    mergeDay({
      hours: scheduled().hours,
      dayStartHour: 5,
      spotsFor: (clockHour) => {
        asked.push(clockHour);
        return [];
      },
    });
    expect(asked).toEqual([5, 6, 7]);
  });

  it('leaves the day where it was when every break sells to budget', () => {
    const outcome = mergeDay({ hours: scheduled().hours, dayStartHour: 5, spotsFor: onBudget });
    expect(outcome.driftedBy).toBe(0);
    expect(outcome.problems).toEqual([]);
  });

  it('gathers every stopset of the day', () => {
    const outcome = mergeDay({ hours: scheduled().hours, dayStartHour: 5, spotsFor: onBudget });
    expect(outcome.stopsets).toHaveLength(3);
  });

  it('merges a day with no hours at all', () => {
    const outcome = mergeDay({ hours: [], dayStartHour: 5, spotsFor: onBudget });
    expect(outcome.hours).toEqual([]);
    expect(outcome.endsAt).toBe(0);
    expect(outcome.driftedBy).toBe(0);
  });
});

describe('drift accumulating down the day', () => {
  it('pulls every later hour earlier, not just the one that sold short', () => {
    const outcome = mergeDay({ hours: scheduled().hours, dayStartHour: 5, spotsFor: short });
    // Three minutes of music, a thirty second break, three more: 3900 an hour
    // against the 4800 the clock budgeted for.
    const starts = outcome.hours.map((hour) => hour.outcome.slots[0]?.mergedAt);
    expect(starts).toEqual([0, 3900, 7800]);
  });

  it('accumulates the drift rather than repeating it', () => {
    const outcome = mergeDay({ hours: scheduled().hours, dayStartHour: 5, spotsFor: short });
    expect(outcome.driftedBy).toBe(-2700);
  });

  it('warns once the day has drifted past the tolerance', () => {
    const outcome = mergeDay({ hours: scheduled().hours, dayStartHour: 5, spotsFor: short });
    expect(outcome.problems.map((each) => each.code)).toContain(DAY_DRIFTED);
  });

  it('says nothing when the drift is inside the tolerance', () => {
    const outcome = mergeDay({
      hours: scheduled().hours,
      dayStartHour: 5,
      spotsFor: short,
      driftTolerance: tenths(6000),
    });
    expect(outcome.problems.map((each) => each.code)).not.toContain(DAY_DRIFTED);
  });
});

describe('breaks nobody defined', () => {
  it('lists the breaks the clocks actually have', () => {
    expect([...definedBreaks(scheduled().hours)]).toEqual(['break one']);
  });

  it('warns about a break traffic sold into that no clock defines', () => {
    const problems = orphanedBreaks(scheduled().hours, ['break one', 'break nine']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe(ORPHANED_BREAK);
    expect(problems[0]?.subject).toBe('break nine');
  });

  it('warns once per name however often it was sold into', () => {
    expect(orphanedBreaks(scheduled().hours, ['break nine', 'break nine'])).toHaveLength(1);
  });

  it('says nothing when every break is defined', () => {
    expect(orphanedBreaks(scheduled().hours, ['break one'])).toEqual([]);
  });

  it('calls everything orphaned when no clock has a break', () => {
    const musicOnly = fillDay(
      dayInput({
        clock: clockOf([{ kind: 'music', target: '0:00', category: 'A' }]),
        library: libraryOf(SONGS),
        hours: 1,
      }),
    );
    expect(definedBreaks(musicOnly.hours).size).toBe(0);
    expect(orphanedBreaks(musicOnly.hours, ['break one'])).toHaveLength(1);
  });
});

describe('dayMusic', () => {
  it('gives every music placement with its merged time and hour', () => {
    const outcome = mergeDay({
      hours: scheduled().hours,
      dayStartHour: 5,
      spotsFor: () => [spot('SPT-1', '2:00')],
    });
    const music = dayMusic(outcome);
    expect(music).toHaveLength(6);
    expect(music[0]?.clockHour).toBe(5);
    expect(music[5]?.clockHour).toBe(7);
    expect(music.every((each) => each.cart.length > 0)).toBe(true);
  });

  it('gives the merged time rather than the scheduled one', () => {
    const outcome = mergeDay({ hours: scheduled().hours, dayStartHour: 5, spotsFor: () => [] });
    expect(dayMusic(outcome)[1]?.at).toBe(1800);
  });

  it('gives nothing for a day that merged nothing', () => {
    expect(dayMusic(mergeDay({ hours: [], dayStartHour: 5, spotsFor: () => [] }))).toEqual([]);
  });
});
