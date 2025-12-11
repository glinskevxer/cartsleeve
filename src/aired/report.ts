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

import { centre, percent, renderPairs, renderTable } from '../util/table.js';
import type { Column } from '../util/table.js';
import { formatDuration, tenths } from '../util/duration.js';
import { severityOf } from './dropped.js';
import { worstFirst } from './timing.js';
import { fidelity, isFaithful } from './reconcile.js';
import type { Reconciliation } from './reconcile.js';

export const PAGE_WIDTH = 80;

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

export function renderReconciliation(
  reconciliation: Reconciliation,
  heading: ReportHeading,
): string[] {
  const lines: string[] = [];
  lines.push(centre('AS AIRED RECONCILIATION', PAGE_WIDTH));
  lines.push('');
  lines.push(
    ...renderPairs([
      ['station', heading.station],
      ['broadcast day', heading.day],
      ['hour', heading.hour],
    ]),
  );
  lines.push('');
  lines.push(
    ...renderPairs([
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
    ]),
  );

  if (isFaithful(reconciliation) && reconciliation.recovery.recovered) {
    return lines;
  }

  if (reconciliation.dropped.length > 0) {
    lines.push('');
    lines.push('DROPPED');
    const rows = [...reconciliation.dropped]
      .sort((a, b) => {
        const order = { error: 0, warning: 1, info: 2 } as const;
        return order[severityOf(a.reason)] - order[severityOf(b.reason)] || a.position - b.position;
      })
      .map((drop) => [String(drop.position), drop.cart, drop.reason, drop.evidence]);
    lines.push(...renderTable(DROP_COLUMNS, rows));
  }

  if (reconciliation.unscheduled.length > 0) {
    lines.push('');
    lines.push('UNSCHEDULED');
    const rows = reconciliation.unscheduled.map((item) => [
      item.airing.cart,
      item.kind,
      item.payable ? 'yes' : 'no',
    ]);
    lines.push(...renderTable(UNSCHEDULED_COLUMNS, rows));
  }

  if (reconciliation.moved.length > 0) {
    lines.push('');
    lines.push('MOVED');
    const rows = reconciliation.moved.map((item) => [
      String(item.position),
      item.cart,
      seconds(item.by),
    ]);
    lines.push(...renderTable(MOVED_COLUMNS, rows));
  }

  const late = worstFirst(reconciliation.deviations);
  if (late.length > 0) {
    lines.push('');
    lines.push('TIMING');
    const rows = late.map((item) => [String(item.position), item.cart, seconds(item.by)]);
    lines.push(...renderTable(TIMING_COLUMNS, rows));
  }

  return lines;
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
