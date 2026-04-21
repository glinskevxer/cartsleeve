import { beforeEach, describe, expect, it } from 'vitest';
import { Router } from '../../src/api/dispatch.js';
import { ScheduleSession, scheduleRoutes } from '../../src/api/schedule-handlers.js';
import { trafficRoutes } from '../../src/api/traffic-handlers.js';
import { ScheduleService } from '../../src/service/schedule-service.js';
import { StationService, emptyState } from '../../src/service/station-service.js';
import type { StationState } from '../../src/service/station-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import type { EntrySpec } from '../support/fixtures.js';
import { resetFixtures, station } from '../support/fixtures.js';
import { clockOf, libraryOf } from '../support/hour.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const DAY = { year: 2025, month: 6, day: 10 };
const ERA_YEARS = [1965, 1980, 1995, 2010];
let counter = 0;

const SONGS: EntrySpec[] = Array.from({ length: 20 }, (_, index) => ({
  number: `M${String(index + 1).padStart(4, '0')}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
}));

/** Two songs an hour with a two minute break between them, starting at 05:00. */
const CLOCK = [
  { kind: 'music' as const, target: '0:00', category: 'A' },
  { kind: 'stopset' as const, target: '3:00', name: 'break one', budget: '2:00' },
  { kind: 'music' as const, target: '5:00', category: 'A' },
];

const HEADER = 'spot,order,cart,length,hour,break';

/**
 * Traffic sells every hour of the day, not only the first. A break the log says
 * nothing about is an empty break, which moves the music after it exactly as a
 * short one does, so a fixture that covers one hour would move the other two.
 */
const HOURS = [5, 6, 7];

function logOf(lengths: readonly string[][]): string {
  const rows: string[] = [HEADER];
  for (const [index, hour] of HOURS.entries()) {
    for (const [spot, length] of (lengths[index] ?? []).entries()) {
      rows.push(`SPT-${hour}-${spot},ORD-1,C04${hour}${spot},${length},${hour},break one`);
    }
  }
  return rows.join('\n');
}

const FULL = ['1:00', '1:00'];
const ON_BUDGET = logOf([FULL, FULL, FULL]);
const SHORT = logOf([['0:30'], FULL, FULL]);

function harness(): { router: Router } {
  const journal = Journal.open(new MemoryStorage());
  let state: StationState = emptyState(station({ dayStartHour: 5 }));
  for (const input of STANDARD_CATEGORIES) {
    const built = expectOk(makeCategory(input));
    const categories = new Map(state.categories);
    categories.set(built.code, built);
    state = { ...state, categories };
  }
  const clocks = new Map(state.clocks);
  clocks.set('ALL', clockOf(CLOCK));
  state = { ...state, library: libraryOf(SONGS), clocks };

  const stationService = new StationService(state, journal);
  const session = new ScheduleSession();
  return {
    router: new Router([
      ...scheduleRoutes(stationService, new ScheduleService(journal), session),
      ...trafficRoutes(stationService, session),
    ]),
  };
}

function call(
  router: Router,
  op: string,
  params: Record<string, unknown>,
): ReturnType<Router['handle']> {
  counter += 1;
  return router.handle({ op, id: `t${counter}`, at: 1_700_000_000_000, params });
}

function scheduled(router: Router, hours = 3): void {
  call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'ALL', hours });
}

describe('traffic.load', () => {
  it('reads a log and counts what is in it', () => {
    const { router } = harness();
    const response = call(router, 'traffic.load', { log: { text: ON_BUDGET } });
    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({
      spots: 6,
      lines: 6,
      hours: '5 6 7',
      breaks: 'break one',
    });
  });

  it('refuses a log with no header the reader recognises', () => {
    const { router } = harness();
    const response = call(router, 'traffic.load', { log: { text: 'a,b,c\n1,2,3' } });
    expect(response.ok).toBe(false);
    expect(response.problems.length).toBeGreaterThan(0);
  });

  it('refuses an empty log rather than reading nothing out of it', () => {
    const { router } = harness();
    expect(call(router, 'traffic.load', { log: { text: '' } }).ok).toBe(false);
  });

  it('reads a pipe delimited log when told to', () => {
    const { router } = harness();
    const piped = ON_BUDGET.split(',').join('|');
    const response = call(router, 'traffic.load', {
      log: { text: piped, delimiter: 'pipe' },
    });
    expect(response.data).toMatchObject({ spots: 6 });
  });

  it('refuses a delimiter nobody has', () => {
    const { router } = harness();
    expect(
      call(router, 'traffic.load', { log: { text: ON_BUDGET, delimiter: 'semicolon' } }).ok,
    ).toBe(false);
  });

  it('carries the reader problems onto a log that mostly read', () => {
    const { router } = harness();
    const withBadRow = `${ON_BUDGET}\nSPT-3,ORD-1,C0457,1:00,99,break one`;
    const response = call(router, 'traffic.load', { log: { text: withBadRow } });
    expect(response.ok).toBe(true);
    expect(response.problems.length).toBeGreaterThan(0);
  });
});

describe('traffic.merge', () => {
  it('refuses before a day has been scheduled', () => {
    const { router } = harness();
    const response = call(router, 'traffic.merge', { log: { text: ON_BUDGET } });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('schedule');
  });

  it('merges the log into the last day and reports what moved', () => {
    const { router } = harness();
    scheduled(router);
    const response = call(router, 'traffic.merge', { log: { text: ON_BUDGET } });
    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({ day: '2025-06-10', hours: 3, spots: 6 });
  });

  it('moves nothing when every break sells at its budget', () => {
    const { router } = harness();
    scheduled(router);
    const data = call(router, 'traffic.merge', { log: { text: ON_BUDGET } }).data as {
      worstMove: string;
      drifted: string;
    };
    expect(data.worstMove).toBe('0:00');
    expect(data.drifted).toBe('0:00');
  });

  it('moves everything after a break that sold short', () => {
    const { router } = harness();
    scheduled(router);
    const data = call(router, 'traffic.merge', { log: { text: SHORT } }).data as {
      worstMove: string;
    };
    expect(data.worstMove).not.toBe('0:00');
  });

  it('counts the music it remeasured', () => {
    const { router } = harness();
    scheduled(router);
    const data = call(router, 'traffic.merge', { log: { text: ON_BUDGET } }).data as {
      music: number;
    };
    expect(data.music).toBe(6);
  });

  it('reports the breaches before and after so the difference is visible', () => {
    const { router } = harness();
    scheduled(router);
    const data = call(router, 'traffic.merge', { log: { text: SHORT } }).data as {
      breachesBefore: number;
      breachesAfter: number;
      causedByTraffic: number;
    };
    expect(data.causedByTraffic).toBeLessThanOrEqual(data.breachesAfter);
    expect(typeof data.breachesBefore).toBe('number');
  });

  it('does not write, because merging decides nothing', () => {
    const { router } = harness();
    expect(router.writes('traffic.merge')).toBe(false);
    expect(router.writes('traffic.load')).toBe(false);
  });

  it('refuses a log that will not read, without touching the day', () => {
    const { router } = harness();
    scheduled(router);
    const response = call(router, 'traffic.merge', { log: { text: 'a,b,c\n1,2,3' } });
    expect(response.ok).toBe(false);
    expect(call(router, 'schedule.last', {}).ok).toBe(true);
  });

  it('refuses a tier that is not one', () => {
    const { router } = harness();
    scheduled(router);
    expect(call(router, 'traffic.merge', { log: { text: ON_BUDGET }, tier: -1 }).ok).toBe(false);
  });
});
