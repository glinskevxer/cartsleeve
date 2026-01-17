/**
 * The frame every printed report shares.
 *
 * A title, a heading block, a summary block, then named sections each holding a
 * table. The reconciliation had all of this inline and the royalty filing needed
 * the same thing, and two copies of page layout is two chances to print a line
 * eighty three columns wide onto an eighty column terminal.
 *
 * The frame owns three guarantees, which is the point of having it: nothing runs
 * past the page width, nothing carries trailing space, and a section with no
 * rows is omitted rather than printed with an empty table under it.
 */

import { centre, renderPairs, renderTable } from '../util/table.js';
import type { Column } from '../util/table.js';

export const PAGE_WIDTH = 80;

export interface Section {
  readonly title: string;
  readonly columns: readonly Column[];
  readonly rows: readonly (readonly string[])[];
}

export interface ReportFrame {
  readonly title: string;
  /** Printed under the title as an aligned key and value block. */
  readonly heading: readonly (readonly [string, string])[];
  /** Printed under the heading, blank line between. Usually the verdict. */
  readonly summary?: readonly (readonly [string, string])[];
  readonly sections: readonly Section[];
}

/**
 * Render a report. Sections with no rows are dropped, so a caller can build the
 * whole set unconditionally and let the frame decide what is worth printing.
 */
export function renderFrame(frame: ReportFrame): string[] {
  const lines: string[] = [];
  lines.push(centre(frame.title, PAGE_WIDTH));
  lines.push('');
  lines.push(...renderPairs(frame.heading));
  if (frame.summary !== undefined && frame.summary.length > 0) {
    lines.push('');
    lines.push(...renderPairs(frame.summary));
  }
  for (const section of frame.sections) {
    if (section.rows.length === 0) {
      continue;
    }
    lines.push('');
    lines.push(section.title);
    lines.push(...renderTable(section.columns, section.rows));
  }
  // Cut first, then trim. Trimming first can leave the cut landing inside a
  // run of padding, which puts the trailing space back after it was removed.
  return lines.map((line) => line.slice(0, PAGE_WIDTH).trimEnd());
}

/** Whether a rendered report fits the page. Used as a guard in tests. */
export function fitsPage(lines: readonly string[]): boolean {
  return lines.every((line) => line.length <= PAGE_WIDTH && line === line.trimEnd());
}

/** Sections that would actually print, for a caller that wants to know first. */
export function printedSections(frame: ReportFrame): string[] {
  return frame.sections
    .filter((section) => section.rows.length > 0)
    .map((section) => section.title);
}
