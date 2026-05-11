import { beforeEach, describe, expect, it } from 'vitest';
import { Router } from '../../src/api/dispatch.js';
import { airedRoutes, plannedFrom } from '../../src/api/aired-handlers.js';
import { ScheduleSession, scheduleRoutes } from '../../src/api/schedule-handlers.js';
import { ScheduleService } from '../../src/service/schedule-service.js';
import { ReportService } from '../../src/service/report-service.js';
import { StationService, emptyState } from '../../src/service/station-service.js';
import type { StationState } from '../../src/service/station-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import { tenths } from '../../src/util/duration.js';
import type { CartNumber } from '../../src/util/ids.js';
import type { EntrySpec } from '../support/fixtures.js';
import { resetFixtures, station } from '../support/fixtures.js';
import { libraryOf, musicClock } from '../support/hour.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const DAY = { year: 2025, month: 6, day: 10 };
const AT = 1_700_000_000_000;
const ERA_YEARS = [1965, 1980, 1995, 2010];
let counter = 0;

const SONGS: EntrySpec[] = Array.from({ length: 12 }, (_, index) => ({
  number: `M${String(index + 1).padStart(4, '0')}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
  isrc: `GBAAA23${String(index + 1).padStart(5, '0')}`,
}));

const PERIOD = {
  from: { year: 2025, month: 4, day: 1 },
  to: { year: 2025, month: 6, day: 30 },
  label: 'Q2 2025',
};

interface Harness {
  readonly router: Router;
  readonly journal: Journal;
}

function harness(): Harness {
  const journal = Journal.open(new MemoryStorage());
  let state: StationState = emptyState(station({ dayStartHour: 5 }));
  for (const input of STANDARD_CATEGORIES) {
    const category = expectOk(makeCategory(input));
    const categories = new Map(state.categories);
    categories.set(category.code, category);
    state = { ...state, categories };
  }
  const clocks = new Map(state.clocks);
  clocks.set('AMD', { ...musicClock(3), name: 'AMD' });
  state = { ...state, library: libraryOf(SONGS), clocks };

  const stationService = new StationService(state, journal);
  const session = new ScheduleSession();
  const reports = new ReportService(journal);
  return {
    journal,
    router: new Router([
      ...scheduleRoutes(stationService, new ScheduleService(journal), session),
      ...airedRoutes(stationService, reports, session),
    ]),
  };
}

function call(
  router: Router,
  op: string,
  params: Record<string, unknown>,
): ReturnType<Router['handle']> {
  counter += 1;
  return router.handle({ op, id: `a${counter}`, at: AT, params });
}

function scheduled(router: Router): void {
  call(router, 'schedule.day', { day: DAY, weekday: 2, clock: 'AMD', hours: 1 });
}

/** One cart starting and ending cleanly, three minutes long. */
function aired(cart: string, startsAt: number): Record<string, unknown>[] {
  return [
    { kind: 'start', cart, at: AT + startsAt },
    { kind: 'end', cart, at: AT + startsAt + 180_000 },
  ];
}

describe('plannedFrom', () => {
  it('moves the day times onto the caller clock', () => {
    const planned = plannedFrom(
      [{ cart: 'M0001' as CartNumber, position: 3, at: tenths(1_800) }],
      AT,
    );
    expect(planned[0]?.at).toBe(AT + 180_000);
    expect(planned[0]?.position).toBe(3);
  });

  it('reads an empty day as no planned starts', () => {
    expect(plannedFrom([], AT)).toEqual([]);
  });
});

describe('aired.reconcile', () => {
  it('refuses before a day has been scheduled', () => {
    const { router } = harness();
    const response = call(router, 'aired.reconcile', {
      events: aired('M0001', 0),
      hour: '06:00',
    });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('schedule');
  });

  it('reconciles a log against the day and renders the page', () => {
    const { router } = harness();
    scheduled(router);
    const response = call(router, 'aired.reconcile', {
      events: aired('M0001', 0),
      hour: '06:00',
    });
    expect(response.ok).toBe(true);
    const data = response.data as { dropped: number; unscheduled: number; lines: string[] };
    expect(data.lines.length).toBeGreaterThan(0);
    expect(typeof data.dropped).toBe('number');
  });

  it('counts a cart that aired and nobody scheduled', () => {
    const { router } = harness();
    scheduled(router);
    const data = call(router, 'aired.reconcile', {
      events: aired('M0099', 0),
      hour: '06:00',
    }).data as { unscheduled: number };
    expect(data.unscheduled).toBeGreaterThan(0);
  });

  it('writes a record of the reconciliation', () => {
    const { router, journal } = harness();
    scheduled(router);
    call(router, 'aired.reconcile', { events: aired('M0001', 0), hour: '06:00' });
    expect(journal.ofKind('report.reconciled')).toHaveLength(1);
  });

  it('refuses a log with no events in it', () => {
    const { router } = harness();
    scheduled(router);
    expect(call(router, 'aired.reconcile', { events: [], hour: '06:00' }).ok).toBe(false);
  });

  it('refuses an event kind the automation should never send', () => {
    const { router } = harness();
    scheduled(router);
    const response = call(router, 'aired.reconcile', {
      events: [{ kind: 'exploded', cart: 'M0001', at: AT }],
      hour: '06:00',
    });
    expect(response.ok).toBe(false);
  });

  it('refuses a request with no hour, because a page has to say which one', () => {
    const { router } = harness();
    scheduled(router);
    expect(call(router, 'aired.reconcile', { events: aired('M0001', 0) }).ok).toBe(false);
  });
});

describe('royalty.file', () => {
  it('builds a filing from what aired and says whether it is filable', () => {
    const { router } = harness();
    const response = call(router, 'royalty.file', {
      events: [...aired('M0001', 0), ...aired('M0002', 200_000)],
      period: PERIOD,
    });
    expect(response.ok).toBe(true);
    const data = response.data as {
      recordings: number;
      spins: number;
      filable: string;
      lines: string[];
    };
    expect(data.spins).toBe(2);
    expect(data.recordings).toBe(2);
    expect(['yes', 'no']).toContain(data.filable);
    expect(data.lines.length).toBeGreaterThan(0);
  });

  it('needs no scheduled day, because a filing is a list of what was broadcast', () => {
    const { router } = harness();
    expect(call(router, 'royalty.file', { events: aired('M0001', 0), period: PERIOD }).ok).toBe(
      true,
    );
  });

  it('counts one cart played twice as two spins of one recording', () => {
    const { router } = harness();
    const data = call(router, 'royalty.file', {
      events: [...aired('M0001', 0), ...aired('M0001', 400_000)],
      period: PERIOD,
    }).data as { recordings: number; spins: number };
    expect(data.spins).toBe(2);
    expect(data.recordings).toBe(1);
  });

  it('refuses a log where nothing finished airing', () => {
    const { router } = harness();
    const response = call(router, 'royalty.file', {
      events: [{ kind: 'start', cart: 'M0001', at: AT }],
      period: PERIOD,
    });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('Q2 2025');
  });

  it('writes a record of the filing', () => {
    const { router, journal } = harness();
    call(router, 'royalty.file', { events: aired('M0001', 0), period: PERIOD });
    expect(journal.ofKind('report.filed')).toHaveLength(1);
  });

  it('refuses a period with no label', () => {
    const { router } = harness();
    expect(
      call(router, 'royalty.file', {
        events: aired('M0001', 0),
        period: { ...PERIOD, label: '' },
      }).ok,
    ).toBe(false);
  });

  it('is a write, because it puts a filing in the journal', () => {
    const { router } = harness();
    expect(router.writes('royalty.file')).toBe(true);
    expect(router.writes('aired.reconcile')).toBe(true);
  });
});
