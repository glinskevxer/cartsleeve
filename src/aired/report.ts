/**
 * The reconciliation report.
 *
 * Printed for the programme director every morning, eighty columns wide, on a
 * terminal that does not wrap. It answers one question in its first three lines
 * and gives the evidence underneath, because on most days the answer is "the
 * hour aired as scheduled" and nobody reads past it.
 *
 * What it deliberately does not do is rank by time. The log is already in time
 * order and reading it that way buries one automation error among forty
 * harmless early starts. Findings are grouped by kind and ordered by how much
 * they matter.
 */

import { percent } from '../util/table.js';
import type { Column } from '../util/table.js';
import { PAGE_WIDTH, renderFrame } from '../report/frame.js';
import type { Section } from '../report/frame.js';
import { formatDuration, tenths } from '../util/duration.js';
import { severityOf } from './dropped.js';
import { worstFirst } from './timing.js';
import { fidelity, isFaithful } from './reconcile.js';
import type { Reconciliation } from './reconcile.js';

export { PAGE_WIDTH };

const DROP_COLUMNS: readonly Column[] = [
  { heading: 'slot', align: 'right' },
  { heading: 'cart', align: 'left' },
  { heading: 'reason', align: 'left', width: 22 },
  { heading: 'evidence', align: 'left', width: 30 },
];

const UNSCHEDULED_COLUMNS: readonly Column[] = [
  { heading: 'cart', align: 'left' },
  { heading: 'kind', align: 'left', width: 16 },
  { heading: 'owed', align: 'left' },
];

const MOVED_COLUMNS: readonly Column[] = [
  { heading: 'slot', align: 'right' },
  { heading: 'cart', align: 'left' },
  { heading: 'by', align: 'right' },
];

const TIMING_COLUMNS: readonly Column[] = [
  { heading: 'slot', align: 'right' },
  { heading: 'cart', align: 'left' },
  { heading: 'late by', align: 'right' },
];

function seconds(millis: number): string {
  const sign = millis < 0 ? '-' : '';
  return `${sign}${formatDuration(tenths(Math.round(Math.abs(millis) / 100)))}`;
}

export interface ReportHeading {
  readonly station: string;
  readonly day: string;
  readonly hour: string;
}

function dropSection(reconciliation: Reconciliation): Section {
  const order = { error: 0, warning: 1, info: 2 } as const;
  return {
    title: 'DROPPED',
    columns: DROP_COLUMNS,
    rows: [...reconciliation.dropped]
      .sort(
        (a, b) =>
          order[severityOf(a.reason)] - order[severityOf(b.reason)] || a.position - b.position,
      )
      .map((drop) => [String(drop.position), drop.cart, drop.reason, drop.evidence]),
  };
}

export function renderReconciliation(
  reconciliation: Reconciliation,
  heading: ReportHeading,
): string[] {
  const clean = isFaithful(reconciliation) && reconciliation.recovery.recovered;
  const late = worstFirst(reconciliation.deviations);
  return renderFrame({
    title: 'AS AIRED RECONCILIATION',
    heading: [
      ['station', heading.station],
      ['broadcast day', heading.day],
      ['hour', heading.hour],
    ],
    summary: [
      ['verdict', isFaithful(reconciliation) ? 'aired as scheduled' : 'deviated from schedule'],
      ['planned', String(reconciliation.planned)],
      ['aired', String(reconciliation.aired)],
      ['fidelity', percent(Math.round(fidelity(reconciliation) * 1000), 1000)],
      [
        'timing',
        reconciliation.recovery.recovered
          ? 'recovered'
          : `${seconds(reconciliation.recovery.finished)} at the end`,
      ],
    ],
    sections: clean
      ? []
      : [
          dropSection(reconciliation),
          {
            title: 'UNSCHEDULED',
            columns: UNSCHEDULED_COLUMNS,
            rows: reconciliation.unscheduled.map((item) => [
              item.airing.cart,
              item.kind,
              item.payable ? 'yes' : 'no',
            ]),
          },
          {
            title: 'MOVED',
            columns: MOVED_COLUMNS,
            rows: reconciliation.moved.map((item) => [
              String(item.position),
              item.cart,
              seconds(item.by),
            ]),
          },
          {
            title: 'TIMING',
            columns: TIMING_COLUMNS,
            rows: late.map((item) => [String(item.position), item.cart, seconds(item.by)]),
          },
        ],
  });
}

/** The one line a director reads when scanning a day of these. */
export function summaryLine(reconciliation: Reconciliation, hour: string): string {
  if (isFaithful(reconciliation) && reconciliation.recovery.recovered) {
    return `${hour} clean`;
  }
  const parts: string[] = [];
  if (reconciliation.dropped.length > 0) {
    parts.push(`${reconciliation.dropped.length} dropped`);
  }
  if (reconciliation.unscheduled.length > 0) {
    parts.push(`${reconciliation.unscheduled.length} unscheduled`);
  }
  if (reconciliation.moved.length > 0) {
    parts.push(`${reconciliation.moved.length} moved`);
  }
  if (!reconciliation.recovery.recovered) {
    parts.push(`${seconds(reconciliation.recovery.finished)} out`);
  }
  return `${hour} ${parts.join(', ')}`;
}
