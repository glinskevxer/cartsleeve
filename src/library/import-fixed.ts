/**
 * Importing a library from the legacy fixed width export.
 *
 * The system this replaced wrote a card image: eighty columns, fields at fixed
 * offsets, values padded with spaces and no delimiter anywhere. Stations still
 * have archives in it and one of them still runs a nightly job that emits it,
 * so it has to be read.
 *
 * Two things about the format cost more than they should. Fields are padded
 * rather than trimmed, so a title that fills its column has no trailing space
 * and runs into the next field to the naked eye. And a short line is legal:
 * trailing fields that were empty are simply not written, so a reader that
 * slices past the end has to see that as absent rather than as an error.
 */

import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';
import { importRows } from './import-core.js';
import type { ImportCoreOutcome, SourceRow } from './import-core.js';

const FIX = (n: number): string => codeFor('library', n);

export interface FixedField {
  readonly name: string;
  /** Zero based, inclusive. */
  readonly at: number;
  readonly width: number;
}

/** The layout the old scheduler wrote, measured off a real export. */
export const LEGACY_LAYOUT: readonly FixedField[] = [
  { name: 'cart', at: 0, width: 5 },
  { name: 'category', at: 5, width: 2 },
  { name: 'runtime', at: 7, width: 7 },
  { name: 'intro', at: 14, width: 5 },
  { name: 'endtype', at: 19, width: 1 },
  { name: 'title', at: 20, width: 30 },
  { name: 'artist', at: 50, width: 24 },
  { name: 'year', at: 74, width: 4 },
  { name: 'isrc', at: 78, width: 12 },
  { name: 'label', at: 90, width: 20 },
];

export function sliceField(line: string, field: FixedField): string {
  if (field.at >= line.length) {
    return '';
  }
  return line.slice(field.at, field.at + field.width).trim();
}

export function readFixedLine(
  line: string,
  layout: readonly FixedField[] = LEGACY_LAYOUT,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const field of layout) {
    values.set(field.name, sliceField(line, field));
  }
  return values;
}

export interface FixedImportOutcome extends ImportCoreOutcome {
  readonly linesRead: number;
  readonly linesKept: number;
}

export interface FixedImportOptions {
  readonly layout?: readonly FixedField[];
  readonly currentYear: number;
  /** Lines starting with these are comments the old system wrote. */
  readonly commentPrefixes?: readonly string[];
}

const DEFAULT_COMMENTS = ['*', '#', ';'];

export function importFixed(
  text: string,
  options: FixedImportOptions,
): Result<FixedImportOutcome, Problem[]> {
  const layout = options.layout ?? LEGACY_LAYOUT;
  const comments = options.commentPrefixes ?? DEFAULT_COMMENTS;
  const names = new Set(layout.map((field) => field.name));
  const missing = ['cart', 'runtime', 'title'].filter((name) => !names.has(name));
  if (missing.length > 0) {
    return err(
      missing.map((name) => ({
        code: FIX(95),
        severity: 'error' as const,
        subject: 'layout',
        message: `has no field for ${name}`,
      })),
    );
  }
  const rows: SourceRow[] = [];
  for (const [offset, raw] of text.split('\n').entries()) {
    const line = raw.replace(/\r$/, '');
    if (line.trim().length === 0 || comments.some((prefix) => line.startsWith(prefix))) {
      continue;
    }
    const values = readFixedLine(line, layout);
    rows.push({
      where: `line ${offset + 1}`,
      has: (field) => names.has(field),
      read: (field) => values.get(field) ?? '',
    });
  }
  const outcome = importRows(rows, { currentYear: options.currentYear });
  return ok({ ...outcome, linesRead: outcome.rowsRead, linesKept: outcome.rowsKept });
}
