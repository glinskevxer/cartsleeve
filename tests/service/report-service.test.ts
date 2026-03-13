import { beforeEach, describe, expect, it } from 'vitest';
import { REPORT_RUN, ReportService } from '../../src/service/report-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { makeEvent, makeEventStream } from '../../src/aired/event.js';
import type { AutomationEvent, EventInput } from '../../src/aired/event.js';
import type { Airing } from '../../src/aired/rebuild.js';
import type { PlannedStart } from '../../src/aired/timing.js';
import type { ReportPeriod } from '../../src/royalty/quarterly.js';
import { censusSample, weeklySample } from '../../src/royalty/sampling.js';
import { fitsPage } from '../../src/report/frame.js';
import type { CartNumber } from '../../src/util/ids.js';
import { resetFixtures } from '../support/fixtures.js';
import { libraryOf } from '../support/hour.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const BASE = 1_700_000_000_000;
const DAY = { year: 2025, month: 6, day: 10 };

const PERIOD: ReportPeriod = {
  from: { year: 2025, month: 4, day: 1 },
  to: { year: 2025, month: 6, day: 30 },
  label: 'Q2 2025',
};

const LIBRARY = () =>
  libraryOf([
    {
      number: 'M0001',
      category: 'A',
      billed: 'Emmylou Harris',
      title: 'Boulder',
      label: 'Reprise',
    },
    {
      number: 'M0002',
      category: 'A',
      billed: 'Kendrick Lamar feat. SZA',
      title: 'All the Stars',
      label: 'TDE',
    },
  ]);

const event = (over: Partial<EventInput> = {}): AutomationEvent =>
  expectOk(makeEvent({ kind: 'start', cart: 'M0001', at: BASE, ...over }));

function service(): { service: ReportService; journal: Journal } {
  const journal = Journal.open(new MemoryStorage());
  return { service: new ReportService(journal), journal };
}

function airing(number: string, at: number): Airing {
  return {
    cart: cart(number),
    startedAt: at,
    endedAt: at + 180_000,
    length: 180_000,
    orphan: false,
    note: '',
  };
}

const PLANNED: PlannedStart[] = [
  { cart: cart('M0001'), position: 0, at: BASE },
  { cart: cart('M0002'), position: 1, at: BASE + 200_000 },
];

const stream = () =>
  makeEventStream([
    event({ kind: 'start', cart: 'M0001', at: BASE }),
    event({ kind: 'end', cart: 'M0001', at: BASE + 180_000 }),
    event({ kind: 'start', cart: 'M0002', at: BASE + 200_000 }),
    event({ kind: 'end', cart: 'M0002', at: BASE + 380_000 }),
  ]);

const hourRequest = () => ({
  planned: PLANNED,
  stream: stream(),
  library: LIBRARY(),
  station: 'KHRT',
  day: DAY,
  hour: '07:00',
});

const airings = () => [airing('M0001', BASE), airing('M0002', BASE + 200_000)];

const filingRequest = () => ({
  airings: airings(),
  library: LIBRARY(),
  station: 'KHRT',
  period: PERIOD,
  policy: 'billed' as const,
});

describe('reconcileHour', () => {
  it('reconciles a faithful hour and renders it', () => {
    const result = service().service.reconcileHour(hourRequest());
    expect(result.reconciliation.dropped).toEqual([]);
    expect(result.lines[0]?.trim()).toBe('AS AIRED RECONCILIATION');
    expect(fitsPage([...result.lines])).toBe(true);
  });

  it('writes a record of having reconciled', () => {
    const { service: svc, journal } = service();
    svc.reconcileHour(hourRequest());
    const written = journal.ofKind('report.reconciled');
    expect(written).toHaveLength(1);
    expect(written[0]?.payload['hour']).toBe('07:00');
  });

  it('reports the rebuild problems', () => {
    const result = service().service.reconcileHour({
      ...hourRequest(),
      stream: makeEventStream([event({ kind: 'start', cart: 'M0001', at: BASE })]),
    });
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('gives the same answer twice', () => {
    const { service: svc } = service();
    expect(svc.reconcileHour(hourRequest()).lines).toEqual(svc.reconcileHour(hourRequest()).lines);
  });
});

describe('buildFiling', () => {
  it('builds, checks and renders a filing', () => {
    const result = service().service.buildFiling(filingRequest());
    expect(result.report.recordings).toBe(2);
    expect(result.validation.filable).toBe(true);
    expect(result.lines[0]?.trim()).toBe('PERFORMANCE REPORT');
  });

  it('explains the divergence between the log and the claim', () => {
    const { service: svc } = service();
    expect(svc.buildFiling(filingRequest()).agreement.agrees).toBe(false);
    expect(svc.buildFiling({ ...filingRequest(), policy: 'strict' }).agreement.agrees).toBe(true);
  });

  it('carries the sample onto the rendered page', () => {
    const result = service().service.buildFiling({
      ...filingRequest(),
      sample: censusSample(PERIOD.from, PERIOD.to),
    });
    expect(result.lines.join('\n')).toContain('census of 91 days');
  });

  it('folds in the sample problems', () => {
    const result = service().service.buildFiling({
      ...filingRequest(),
      sample: weeklySample(PERIOD.from, PERIOD.to, 0),
    });
    expect(result.problems.length).toBeGreaterThan(1);
  });

  it('notes that the report was produced', () => {
    const result = service().service.buildFiling(filingRequest());
    expect(result.problems.map((each) => each.code)).toContain(REPORT_RUN);
  });

  it('builds an empty filing without falling over', () => {
    const result = service().service.buildFiling({ ...filingRequest(), airings: [] });
    expect(result.report.lines).toEqual([]);
    expect(result.validation.filable).toBe(true);
  });
});

describe('filingHistory', () => {
  it('remembers what was filed', () => {
    const { service: svc } = service();
    svc.buildFiling(filingRequest());
    const history = svc.filingHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.period).toBe('Q2 2025');
    expect(history[0]?.filable).toBe('yes');
  });

  it('remembers nothing before anything was filed', () => {
    expect(service().service.filingHistory()).toEqual([]);
  });
});
