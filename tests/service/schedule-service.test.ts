import { beforeEach, describe, expect, it } from 'vitest';
import { NO_CLOCK, ScheduleService, offsetForDay } from '../../src/service/schedule-service.js';
import { emptyState } from '../../src/service/station-service.js';
import type { StationState } from '../../src/service/station-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import { WEEKDAYS, makeDaypart } from '../../src/domain/daypart.js';
import { makeRestrictionMap } from '../../src/library/restriction.js';
import type { CartNumber } from '../../src/util/ids.js';
import type { EntrySpec } from '../support/fixtures.js';
import { resetFixtures, station } from '../support/fixtures.js';
import { clockOf, libraryOf, musicClock } from '../support/hour.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const DAY = { year: 2025, month: 6, day: 10 };
const NEXT = { year: 2025, month: 6, day: 11 };
const ERA_YEARS = [1965, 1980, 1995, 2010];

const SONGS: EntrySpec[] = Array.from({ length: 20 }, (_, index) => ({
  number: `M${String(index + 1).padStart(4, '0')}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
}));

function stateWith(specs: readonly EntrySpec[]): StationState {
  let state = emptyState(station({ dayStartHour: 5 }));
  for (const input of STANDARD_CATEGORIES) {
    const built = expectOk(makeCategory(input));
    const categories = new Map(state.categories);
    categories.set(built.code, built);
    state = { ...state, categories };
  }
  return { ...state, library: libraryOf(specs) };
}

function service(): { service: ScheduleService; journal: Journal } {
  const journal = Journal.open(new MemoryStorage());
  return { service: new ScheduleService(journal), journal };
}

describe('scheduleDay', () => {
  it('fills the hours it was given a clock for', () => {
    const { service: svc } = service();
    const clock = musicClock(3);
    const outcome = svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, [], { hours: 3 });
    expect(outcome.day.hours).toHaveLength(3);
    expect(outcome.day.placed).toHaveLength(9);
    expect(outcome.problems).toEqual([]);
  });

  it('writes one record per day scheduled', () => {
    const { service: svc, journal } = service();
    const clock = musicClock(2);
    svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, [], { hours: 2 });
    const written = journal.ofKind('schedule.day');
    expect(written).toHaveLength(1);
    expect(written[0]?.payload['placed']).toBe(4);
  });

  it('warns about an hour with no clock and leaves it unscheduled', () => {
    const { service: svc } = service();
    const clock = musicClock(2);
    const outcome = svc.scheduleDay(
      stateWith(SONGS),
      DAY,
      2,
      (hourIndex) => (hourIndex === 1 ? undefined : clock),
      [],
      { hours: 3 },
    );
    expect(outcome.day.hours).toHaveLength(2);
    expect(outcome.problems[0]?.code).toBe(NO_CLOCK);
  });

  it('sees what it was told is already scheduled, once the positions differ', () => {
    const { service: svc } = service();
    const clock = musicClock(2);
    const first = svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, [], { hours: 1 });
    resetFixtures();
    const second = svc.scheduleDay(stateWith(SONGS), NEXT, 3, () => clock, first.day.placed, {
      hours: 1,
    });
    const firstCarts = new Set(first.day.placed.map((each) => each.cart));
    expect(second.day.placed.some((each) => firstCarts.has(each.cart))).toBe(false);
  });

  it('cannot see it when the two passes share a position space', () => {
    const { service: svc } = service();
    const clock = musicClock(2);
    const first = svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, [], { hours: 1 });
    resetFixtures();
    // Forcing the same offset puts the carried placements on the slots being
    // filled, so every rule skips them as though they were this very slot.
    const second = svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, first.day.placed, {
      hours: 1,
      positionOffset: offsetForDay(DAY),
    });
    const firstCarts = new Set(first.day.placed.map((each) => each.cart));
    expect(second.day.placed.some((each) => firstCarts.has(each.cart))).toBe(true);
  });

  it('gives each day its own position space', () => {
    expect(offsetForDay(DAY)).not.toBe(offsetForDay(NEXT));
  });

  it('honours a restriction map that is given', () => {
    const { service: svc } = service();
    const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 5, toHour: 10 }]));
    const restrictions = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'] }], [AMD]),
    );
    const clock = musicClock(2);
    const outcome = svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, [], {
      hours: 1,
      restrictions,
    });
    expect(outcome.day.placed.map((each) => each.cart)).not.toContain('M0001');
  });

  it('honours a floor and leaves holes rather than breaching', () => {
    const { service: svc } = service();
    const oneArtist: EntrySpec[] = Array.from({ length: 3 }, (_, index) => ({
      number: `M000${index + 1}`,
      category: 'A',
      billed: 'Dolly Parton',
      title: `Song ${index + 1}`,
      runtime: '3:00',
    }));
    const clock = musicClock(3);
    const outcome = svc.scheduleDay(stateWith(oneArtist), DAY, 2, () => clock, [], {
      hours: 1,
      floor: 2,
    });
    expect(outcome.day.holes.length).toBeGreaterThan(0);
  });

  it('handles a twenty three hour day', () => {
    const { service: svc } = service();
    const clock = musicClock(1);
    const outcome = svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, [], { hours: 23 });
    expect(outcome.day.hours).toHaveLength(23);
  });

  it('schedules a day with a break in the clock', () => {
    const { service: svc } = service();
    const clock = clockOf([
      { kind: 'music', target: '0:00', category: 'A' },
      { kind: 'stopset', target: '3:00', name: 'break one', budget: '2:00' },
      { kind: 'music', target: '5:00', category: 'A' },
    ]);
    const outcome = svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, [], { hours: 1 });
    expect(outcome.day.hours[0]?.outcome.slots).toHaveLength(3);
  });
});

describe('reading the outcome', () => {
  it('reports where the day ends', () => {
    const { service: svc } = service();
    const clock = musicClock(2);
    const outcome = svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, [], { hours: 2 });
    expect(svc.endsAt(outcome)).toBe(4 * 1800);
  });

  it('gives back everything it placed', () => {
    const { service: svc } = service();
    const clock = musicClock(2);
    const outcome = svc.scheduleDay(stateWith(SONGS), DAY, 2, () => clock, [], { hours: 2 });
    expect(svc.placed(outcome)).toHaveLength(4);
  });

  it('places nothing when the library is empty', () => {
    const { service: svc } = service();
    const clock = musicClock(2);
    const outcome = svc.scheduleDay(stateWith([]), DAY, 2, () => clock, [], { hours: 1 });
    expect(svc.placed(outcome)).toEqual([]);
    expect(outcome.day.holes).toHaveLength(2);
  });
});
