import { beforeEach, describe, expect, it } from 'vitest';
import { PAGE_WIDTH, renderReconciliation, summaryLine } from '../../src/aired/report.js';
import type { Reconciliation } from '../../src/aired/reconcile.js';
import type { CartNumber } from '../../src/util/ids.js';
import { resetFixtures } from '../support/fixtures.js';
import { entry } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const BASE = 1_700_000_000_000;

const HEADING = { station: 'KHRT', day: '2025-06-10', hour: '07:00' };

const CLEAN: Reconciliation = {
  dropped: [],
  unscheduled: [],
  moved: [],
  deviations: [],
  recovery: { worst: 0, finished: 0, recovered: true },
  aired: 14,
  planned: 14,
};

function messy(): Reconciliation {
  return {
    dropped: [
      {
        cart: cart('M0002'),
        position: 1,
        reason: 'skipped by operator',
        evidence: 'made the news',
      },
      { cart: cart('M0005'), position: 4, reason: 'automation error', evidence: 'file missing' },
    ],
    unscheduled: [
      {
        airing: {
          cart: cart('M0900'),
          startedAt: BASE,
          endedAt: BASE + 1000,
          length: 1000,
          orphan: false,
          note: '',
        },
        kind: 'manual fire',
        payable: true,
      },
    ],
    moved: [
      { cart: cart('M0007'), position: 6, plannedAt: BASE, airedAt: BASE + 90_000, by: 90_000 },
    ],
    deviations: [
      { cart: cart('M0009'), position: 8, plannedAt: BASE, actualAt: BASE + 45_000, by: 45_000 },
    ],
    recovery: { worst: 45_000, finished: 45_000, recovered: false },
    aired: 13,
    planned: 14,
  };
}

describe('renderReconciliation', () => {
  it('opens with a centred title and the heading', () => {
    const lines = renderReconciliation(CLEAN, HEADING);
    expect(lines[0]?.trim()).toBe('AS AIRED RECONCILIATION');
    expect(lines.join('\n')).toContain('station:');
    expect(lines.join('\n')).toContain('KHRT');
  });

  it('gives the verdict in the summary block', () => {
    expect(renderReconciliation(CLEAN, HEADING).join('\n')).toContain('aired as scheduled');
    expect(renderReconciliation(messy(), HEADING).join('\n')).toContain('deviated from schedule');
  });

  it('stops after the summary when the hour was clean', () => {
    const lines = renderReconciliation(CLEAN, HEADING);
    expect(lines.join('\n')).not.toContain('DROPPED');
    expect(lines.join('\n')).not.toContain('TIMING');
  });

  it('prints every section that has something in it', () => {
    const text = renderReconciliation(messy(), HEADING).join('\n');
    expect(text).toContain('DROPPED');
    expect(text).toContain('UNSCHEDULED');
    expect(text).toContain('MOVED');
    expect(text).toContain('TIMING');
  });

  it('puts the automation error above the deliberate skip', () => {
    const lines = renderReconciliation(messy(), HEADING);
    const start = lines.findIndex((line) => line === 'DROPPED');
    const body = lines.slice(start + 3);
    expect(body[0]).toContain('automation error');
    expect(body[1]).toContain('skipped by operator');
  });

  it('says whether an unscheduled airing is owed for', () => {
    const text = renderReconciliation(messy(), HEADING).join('\n');
    expect(text).toContain('manual fire');
    expect(text).toContain('yes');
  });

  it('never runs a line past the page width', () => {
    for (const line of renderReconciliation(messy(), HEADING)) {
      expect(line.length).toBeLessThanOrEqual(PAGE_WIDTH);
    }
  });

  it('leaves no trailing space on any line', () => {
    for (const line of renderReconciliation(messy(), HEADING)) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('reports timing even when nothing else deviated', () => {
    const lateOnly: Reconciliation = {
      ...CLEAN,
      deviations: [
        { cart: cart('M0009'), position: 8, plannedAt: BASE, actualAt: BASE + 45_000, by: 45_000 },
      ],
      recovery: { worst: 45_000, finished: 45_000, recovered: false },
    };
    const text = renderReconciliation(lateOnly, HEADING).join('\n');
    expect(text).toContain('TIMING');
    expect(text).not.toContain('DROPPED');
  });

  it('renders an hour that planned nothing', () => {
    const empty: Reconciliation = { ...CLEAN, aired: 0, planned: 0 };
    expect(renderReconciliation(empty, HEADING).length).toBeGreaterThan(0);
  });
});

describe('summaryLine', () => {
  it('calls a clean hour clean', () => {
    expect(summaryLine(CLEAN, '07:00')).toBe('07:00 clean');
  });

  it('names every kind of deviation it found', () => {
    const line = summaryLine(messy(), '07:00');
    expect(line).toContain('2 dropped');
    expect(line).toContain('1 unscheduled');
    expect(line).toContain('1 moved');
    expect(line).toContain('out');
  });

  it('leaves out what did not happen', () => {
    const onlyDropped: Reconciliation = { ...CLEAN, dropped: messy().dropped };
    const line = summaryLine(onlyDropped, '07:00');
    expect(line).toBe('07:00 2 dropped');
  });

  it('mentions the timing on an hour that only ran late', () => {
    const late: Reconciliation = {
      ...CLEAN,
      recovery: { worst: 45_000, finished: 45_000, recovered: false },
    };
    expect(summaryLine(late, '07:00')).toContain('out');
  });

  it('uses whatever hour label it was given', () => {
    expect(summaryLine(CLEAN, 'overnight')).toBe('overnight clean');
  });

  it('does not need the library fixture to render', () => {
    expect(entry({ number: 'M0001' }).cart.number).toBe('M0001');
  });
});
