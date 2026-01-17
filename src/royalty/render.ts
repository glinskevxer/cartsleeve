/**
 * The printed form of the quarterly filing.
 *
 * Built on the same frame as the reconciliation, which is the whole reason the
 * frame exists: two reports that look alike on paper should be alike in code,
 * and a page width guarantee written twice is a page width guarantee that holds
 * once.
 */

import { renderFrame } from '../report/frame.js';
import type { Column } from '../util/table.js';
import { formatDuration, tenths } from '../util/duration.js';
import { describePeriod } from './quarterly.js';
import type { QuarterlyReport } from './quarterly.js';
import { describeSample } from './sampling.js';
import type { Sample } from './sampling.js';

const LINE_COLUMNS: readonly Column[] = [
  { heading: 'isrc', align: 'left' },
  { heading: 'title', align: 'left', width: 22 },
  { heading: 'artist', align: 'left', width: 18 },
  { heading: 'spins', align: 'right' },
  { heading: 'share', align: 'right' },
];

const PAYEE_COLUMNS: readonly Column[] = [
  { heading: 'payee', align: 'left', width: 30 },
  { heading: 'lines', align: 'right' },
  { heading: 'spins', align: 'right' },
];

function share(parts: number, of: number): string {
  return of === 1 ? 'all' : `${parts}/${of}`;
}

export function renderQuarterly(report: QuarterlyReport, sample?: Sample): string[] {
  const byPayee = new Map<string, { lines: number; spins: number }>();
  for (const line of report.lines) {
    const found = byPayee.get(line.payee);
    if (found === undefined) {
      byPayee.set(line.payee, { lines: 1, spins: line.spins });
    } else {
      found.lines += 1;
    }
  }
  return renderFrame({
    title: 'PERFORMANCE REPORT',
    heading: [
      ['station', report.station],
      ['period', describePeriod(report.period)],
      ...(sample === undefined
        ? []
        : ([['basis', describeSample(sample)]] as readonly (readonly [string, string])[])),
    ],
    summary: [
      ['recordings', String(report.recordings)],
      ['spins', String(report.totalSpins)],
      ['performed', formatDuration(tenths(report.totalSeconds * 10))],
      ['lines', String(report.lines.length)],
    ],
    sections: [
      {
        title: 'BY PAYEE',
        columns: PAYEE_COLUMNS,
        rows: [...byPayee]
          .sort((a, b) => b[1].spins - a[1].spins || (a[0] < b[0] ? -1 : 1))
          .map(([payee, totals]) => [payee, String(totals.lines), String(totals.spins)]),
      },
      {
        title: 'DETAIL',
        columns: LINE_COLUMNS,
        rows: report.lines.map((line) => [
          line.formattedIsrc,
          line.title,
          line.artist,
          String(line.spins),
          share(line.parts, line.of),
        ]),
      },
    ],
  });
}
