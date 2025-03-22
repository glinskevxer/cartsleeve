/**
 * Importing a library from a delimited export.
 *
 * This is how a library actually arrives: a file the previous scheduling system
 * wrote, with column names nobody agreed on and a few thousand rows of which a
 * handful are wrong. The import has to report every bad row rather than stop at
 * the first, because a director is going to fix them in a spreadsheet and wants
 * the whole list in one pass.
 *
 * Column names are matched loosely, since the same field is `CART`, `Cart #`
 * and `cart_no` in the three exports this has seen.
 */

import { readTable } from '../util/delimited.js';
import type { DelimitedOptions } from '../util/delimited.js';
import { COMMA } from '../util/delimited.js';
import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';
import { importRows } from './import-core.js';
import type { ImportCoreOutcome, SourceRow } from './import-core.js';

const IMP = (n: number): string => codeFor('library', n);

/** Every spelling of each column this has had to read. */
export const COLUMN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  cart: ['cart', 'cart#', 'cartno', 'cartnumber', 'id'],
  title: ['title', 'song', 'songtitle', 'name'],
  artist: ['artist', 'artists', 'billedartist', 'performer'],
  runtime: ['runtime', 'length', 'duration', 'time'],
  category: ['category', 'cat', 'rotation'],
  intro: ['intro', 'ramp', 'introtime'],
  endtype: ['endtype', 'end', 'ending', 'outro'],
  tail: ['tail', 'fade', 'fadetime'],
  isrc: ['isrc'],
  label: ['label', 'imprint'],
  payee: ['payee', 'owner'],
  year: ['year', 'releaseyear', 'released'],
  tempo: ['tempo'],
  mood: ['mood'],
  texture: ['texture'],
  sounds: ['sounds', 'soundcodes', 'codes'],
};

function normaliseHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Map each canonical field to the column name the file actually used. */
export function resolveColumns(header: readonly string[]): Map<string, string> {
  const seen = new Map<string, string>();
  for (const column of header) {
    seen.set(normaliseHeading(column), column);
  }
  const resolved = new Map<string, string>();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const found = seen.get(alias);
      if (found !== undefined) {
        resolved.set(field, found);
        break;
      }
    }
  }
  return resolved;
}

export type ImportOutcome = ImportCoreOutcome;

export interface ImportOptions {
  readonly delimiter?: DelimitedOptions;
  readonly currentYear: number;
}

export function importDelimited(
  text: string,
  options: ImportOptions,
): Result<ImportOutcome, Problem[]> {
  const table = readTable(text, options.delimiter ?? COMMA);
  if (!table.ok) {
    return err([
      {
        code: IMP(90),
        severity: 'error',
        subject: `line ${table.error.line}`,
        message: table.error.reason,
      },
    ]);
  }
  const columns = resolveColumns(table.value.header);
  const missing = ['cart', 'title', 'runtime'].filter((field) => !columns.has(field));
  if (missing.length > 0) {
    return err(
      missing.map((field) => ({
        code: IMP(91),
        severity: 'error' as const,
        subject: 'header',
        message: `has no column for ${field}`,
      })),
    );
  }
  const rows: SourceRow[] = table.value.rows.map((row, offset) => ({
    where: `line ${offset + 2}`,
    has: (field) => columns.has(field),
    read: (field) => {
      const column = columns.get(field);
      return column === undefined ? '' : (row.get(column) ?? '');
    },
  }));
  return ok(importRows(rows, { currentYear: options.currentYear }));
}
