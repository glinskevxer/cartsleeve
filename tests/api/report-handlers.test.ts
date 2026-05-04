import { beforeEach, describe, expect, it } from 'vitest';
import { Router } from '../../src/api/dispatch.js';
import { ScheduleSession, scheduleRoutes } from '../../src/api/schedule-handlers.js';
import { reportRoutes } from '../../src/api/report-handlers.js';
import { ScheduleService } from '../../src/service/schedule-service.js';
import { ReportService } from '../../src/service/report-service.js';
import { StationService, emptyState } from '../../src/service/station-service.js';
import type { StationState } from '../../src/service/station-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import { fitsPage } from '../../src/report/frame.js';
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

const SONGS: EntrySpec[] = Array.from({ length: 12 }, (_, index) => ({
  number: `M${String(index + 1).padStart(4, '0')}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
}));

const DAYPARTS = [
  { name: 'AMD', spans: [{ days: [1, 2, 3, 4, 5], fromHour: 6, toHour: 10 }] },
  { name: 'MID', spans: [{ days: [1, 2, 3, 4, 5], fromHour: 10, toHour: 15 }] },
  { name: 'PMD', spans: [{ days: [1, 2, 3, 4, 5], fromHour: 15, toHour: 19 }] },
];

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
  // A clock is stored under its own name, the way the service stores it.
  clocks.set('AMD', { ...musicClock(3), name: 'AMD' });
  clocks.set('EMPTY', { ...musicClock(2, 'C'), name: 'EMPTY' });
  state = { ...state, library: libraryOf(SONGS), clocks };

  const stationService = new StationService(state, journal);
  const session = new ScheduleSession();
  const router = new Router([
    ...scheduleRoutes(stationService, new ScheduleService(journal), session),
    ...reportRoutes(stationService, new ReportService(journal), session),
  ]);
  return { router };
}

function call(
  router: Router,
  op: string,
  params: Record<string, unknown>,
): ReturnType<Router['handle']> {
  counter += 1;
  return router.handle({ op, id: `p${counter}`, at: 1_700_000_000_000, params });
}

function scheduled(router: Router, hours = 6): void {
  call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'AMD', hours });
}

describe('report.breaches', () => {
  it('refuses before a day has been scheduled', () => {
    const { router } = harness();
    const response = call(router, 'report.breaches', {});
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('schedule');
  });

  it('renders a page that fits', () => {
    const { router } = harness();
    scheduled(router);
    const response = call(router, 'report.breaches', {});
    expect(response.ok).toBe(true);
    const data = response.data as { summary: string; lines: string[] };
    expect(fitsPage(data.lines)).toBe(true);
  });

  it('names the day it is reporting on', () => {
    const { router } = harness();
    scheduled(router);
    const data = call(router, 'report.breaches', {}).data as { lines: string[] };
    expect(data.lines.join('\n')).toContain('2025-06-10');
  });

  it('gives the summary without the page when only the summary is asked for', () => {
    const { router } = harness();
    scheduled(router);
    const data = call(router, 'report.breaches', { summaryOnly: true }).data as {
      summary: string;
      lines: string[];
    };
    expect(data.lines).toEqual([]);
    expect(data.summary.length).toBeGreaterThan(0);
  });

  it('refuses a detail limit of nothing', () => {
    const { router } = harness();
    scheduled(router);
    expect(call(router, 'report.breaches', { detailLimit: 0 }).ok).toBe(false);
  });

  it('reports the holes from a day that could not fill', () => {
    const { router } = harness();
    call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'EMPTY', hours: 2 });
    const data = call(router, 'report.breaches', {}).data as { summary: string };
    expect(data.summary).toContain('4');
  });
});

describe('report.health', () => {
  it('refuses before a day has been scheduled', () => {
    const { router } = harness();
    expect(call(router, 'report.health', { dayparts: DAYPARTS }).ok).toBe(false);
  });

  it('refuses a request with no dayparts, because there is nothing to spread over', () => {
    const { router } = harness();
    scheduled(router);
    const response = call(router, 'report.health', { dayparts: [] });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('dayparts');
  });

  it('refuses a daypart that runs past the end of the day', () => {
    const { router } = harness();
    scheduled(router);
    const response = call(router, 'report.health', {
      dayparts: [{ name: 'BAD', spans: [{ days: [1], fromHour: 20, toHour: 4 }] }],
    });
    expect(response.ok).toBe(false);
  });

  it('renders a page that fits and says what to fix first', () => {
    const { router } = harness();
    scheduled(router);
    const response = call(router, 'report.health', { dayparts: DAYPARTS });
    expect(response.ok).toBe(true);
    const data = response.data as { remedy: string; lines: string[] };
    expect(fitsPage(data.lines)).toBe(true);
    expect(data.remedy.length).toBeGreaterThan(0);
  });

  it('puts a locking cycle ahead of any amount of hand spreading', () => {
    const { router } = harness();
    scheduled(router);
    const data = call(router, 'report.health', {
      dayparts: DAYPARTS,
      cycles: [{ category: 'A', hours: 24 }],
    }).data as { remedy: string };
    expect(data.remedy).toBe('change the cycle length for A');
  });

  it('takes no cycles at all', () => {
    const { router } = harness();
    scheduled(router);
    const data = call(router, 'report.health', { dayparts: DAYPARTS }).data as { lines: string[] };
    expect(data.lines.join('\n')).not.toContain('CATEGORY CYCLES');
  });

  it('does not write', () => {
    const { router } = harness();
    expect(router.writes('report.health')).toBe(false);
  });
});

describe('report.filings', () => {
  it('answers with nothing on a journal that has never filed', () => {
    const { router } = harness();
    const response = call(router, 'report.filings', {});
    expect(response.ok).toBe(true);
    expect(response.data).toEqual([]);
  });

  it('does not write', () => {
    const { router } = harness();
    expect(router.writes('report.filings')).toBe(false);
  });
});

describe('the reports and the session', () => {
  it('follows the session to the day scheduled most recently', () => {
    const { router } = harness();
    scheduled(router);
    call(router, 'schedule.day', { day: { ...DAY, day: 11 }, weekday: 3, clock: 'AMD', hours: 2 });
    const data = call(router, 'report.breaches', {}).data as { lines: string[] };
    expect(data.lines.join('\n')).toContain('2025-06-11');
  });
});

describe('report.turnover', () => {
  const WEEK = [{ days: [0, 1, 2, 3, 4, 5, 6], fromHour: 0, toHour: 24, clock: 'AMD' }];

  it('reads the whole week and prints a page that fits', () => {
    const { router } = harness();
    const response = call(router, 'report.turnover', { grid: { spans: WEEK } });
    expect(response.ok).toBe(true);
    const data = response.data as { lines: string[]; misleading: string[] };
    expect(fitsPage(data.lines)).toBe(true);
    expect(data.lines[0]).toContain('TURNOVER');
  });

  it('counts the carts it has, category by category', () => {
    const { router } = harness();
    const data = call(router, 'report.turnover', { grid: { spans: WEEK } }).data as {
      lines: string[];
    };
    expect(data.lines.join('\n')).toContain('12');
  });

  it('needs no scheduled day, because turnover is a property of the grid', () => {
    const { router } = harness();
    expect(call(router, 'report.turnover', { grid: { spans: WEEK } }).ok).toBe(true);
  });

  it('refuses a grid naming a clock the station does not have', () => {
    const { router } = harness();
    const response = call(router, 'report.turnover', {
      grid: { spans: [{ ...WEEK[0], clock: 'PMD' }] },
    });
    expect(response.ok).toBe(false);
  });

  it('refuses a grid with no spans at all', () => {
    const { router } = harness();
    expect(call(router, 'report.turnover', { grid: { spans: [] } }).ok).toBe(false);
  });

  it('does not write', () => {
    const { router } = harness();
    expect(router.writes('report.turnover')).toBe(false);
  });
});
