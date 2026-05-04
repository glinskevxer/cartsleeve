import { beforeEach, describe, expect, it } from 'vitest';
import { Router } from '../../src/api/dispatch.js';
import { ScheduleSession, scheduleRoutes } from '../../src/api/schedule-handlers.js';
import { ScheduleService } from '../../src/service/schedule-service.js';
import { StationService, emptyState } from '../../src/service/station-service.js';
import type { StationState } from '../../src/service/station-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import type { EntrySpec } from '../support/fixtures.js';
import { resetFixtures, station } from '../support/fixtures.js';
import { libraryOf, musicClock } from '../support/hour.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const DAY = { year: 2025, month: 6, day: 10 };
const ERA_YEARS = [1965, 1980, 1995, 2010];
let counter = 0;

const SONGS: EntrySpec[] = Array.from({ length: 24 }, (_, index) => ({
  number: `M${String(index + 1).padStart(4, '0')}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
}));

interface Harness {
  readonly router: Router;
  readonly session: ScheduleSession;
  readonly journal: Journal;
}

function harness(): Harness {
  const journal = Journal.open(new MemoryStorage());
  let state: StationState = emptyState(station({ dayStartHour: 5 }));
  for (const input of STANDARD_CATEGORIES) {
    const built = expectOk(makeCategory(input));
    const categories = new Map(state.categories);
    categories.set(built.code, built);
    state = { ...state, categories };
  }
  const clocks = new Map(state.clocks);
  // A clock is stored under its own name, the way the service stores it.
  clocks.set('AMD', { ...musicClock(3), name: 'AMD' });
  clocks.set('OVN', { ...musicClock(2), name: 'OVN' });
  clocks.set('EMPTY', { ...musicClock(2, 'C'), name: 'EMPTY' });
  state = { ...state, library: libraryOf(SONGS), clocks };

  const stationService = new StationService(state, journal);
  const session = new ScheduleSession();
  const router = new Router(scheduleRoutes(stationService, new ScheduleService(journal), session));
  return { router, session, journal };
}

function call(
  router: Router,
  op: string,
  params: Record<string, unknown>,
): ReturnType<Router['handle']> {
  counter += 1;
  return router.handle({ op, id: `s${counter}`, at: 1_700_000_000_000, params });
}

describe('schedule.day', () => {
  it('schedules the hours it was asked for and counts what it did', () => {
    const { router } = harness();
    const response = call(router, 'schedule.day', {
      day: DAY,
      weekday: 2,
      clock: 'AMD',
      hours: 3,
    });
    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({ hours: 3, placed: 9, holes: 0 });
  });

  it('writes one journal record for the day', () => {
    const { router, journal } = harness();
    call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'AMD', hours: 2 });
    expect(journal.ofKind('schedule.day')).toHaveLength(1);
  });

  it('takes a different clock for a named hour', () => {
    const { router } = harness();
    const response = call(router, 'schedule.day', {
      day: DAY,
      weekday: 2,
      clock: 'AMD',
      clocks: { '2': 'OVN' },
      hours: 3,
    });
    expect(response.data).toMatchObject({ placed: 8 });
  });

  it('refuses a clock name nobody defined, and names every one that is missing', () => {
    const { router } = harness();
    const response = call(router, 'schedule.day', {
      day: DAY,
      weekday: 2,
      clock: 'PMD',
      clocks: { '0': 'MID' },
      hours: 2,
    });
    expect(response.ok).toBe(false);
    expect(response.problems.map((item) => item.subject)).toEqual(['MID', 'PMD']);
  });

  it('refuses a request that names no clock at all', () => {
    const { router } = harness();
    const response = call(router, 'schedule.day', { day: DAY, weekday: 2, hours: 2 });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('clock');
  });

  it('refuses a weekday that is not a day of the week', () => {
    const { router } = harness();
    expect(call(router, 'schedule.day', { day: DAY, weekday: 9, clock: 'AMD' }).ok).toBe(false);
  });

  it('refuses a month nobody has', () => {
    const { router } = harness();
    const response = call(router, 'schedule.day', {
      day: { ...DAY, month: 13 },
      weekday: 2,
      clock: 'AMD',
    });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('day.month');
  });
});

describe('carrying yesterday', () => {
  it('starts from nothing when the caller does not ask to carry', () => {
    const { router, session } = harness();
    call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'AMD', hours: 2 });
    const first = session.carried().length;
    call(router, 'schedule.day', {
      day: { ...DAY, day: 11 },
      weekday: 3,
      clock: 'AMD',
      hours: 2,
    });
    expect(first).toBeGreaterThan(0);
    expect(session.carried()).toHaveLength(first);
  });

  it('separates the second day against the first when asked to carry', () => {
    const { router } = harness();
    call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'AMD', hours: 3 });
    const second = call(router, 'schedule.day', {
      day: { ...DAY, day: 11 },
      weekday: 3,
      clock: 'AMD',
      hours: 3,
      carry: true,
    });
    expect(second.ok).toBe(true);
    expect(second.data).toMatchObject({ hours: 3 });
  });

  it('remembers only the last day', () => {
    const { router, session } = harness();
    call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'AMD', hours: 3 });
    call(router, 'schedule.day', { day: { ...DAY, day: 11 }, weekday: 3, clock: 'OVN', hours: 2 });
    expect(session.label()).toBe('2025-06-11');
    expect(session.outcome()?.day.hours).toHaveLength(2);
  });
});

describe('schedule.last', () => {
  it('refuses before anything has been scheduled', () => {
    const { router } = harness();
    const response = call(router, 'schedule.last', {});
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('schedule');
  });

  it('reads back the day that was scheduled', () => {
    const { router } = harness();
    call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'AMD', hours: 3 });
    const response = call(router, 'schedule.last', {});
    expect(response.data).toMatchObject({ day: '2025-06-10', hours: 3, placed: 9 });
  });

  it('does not write', () => {
    const { router } = harness();
    expect(router.writes('schedule.last')).toBe(false);
  });
});

describe('schedule.holes', () => {
  it('answers with nothing when the day filled', () => {
    const { router } = harness();
    call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'AMD', hours: 3 });
    expect(call(router, 'schedule.holes', {}).data).toEqual([]);
  });

  it('names the category and the cause of every hole', () => {
    const { router } = harness();
    // Nothing is carded into C, so every slot the clock asks for is a hole.
    call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'EMPTY', hours: 2 });
    const holes = call(router, 'schedule.holes', {}).data as { category: string; cause: string }[];
    expect(holes).toHaveLength(4);
    expect(holes.every((hole) => hole.category === 'C')).toBe(true);
    expect(holes.every((hole) => hole.cause === 'category empty')).toBe(true);
  });

  it('refuses before anything has been scheduled', () => {
    const { router } = harness();
    expect(call(router, 'schedule.holes', {}).ok).toBe(false);
  });
});
