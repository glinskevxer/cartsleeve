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
import { makeCart } from '../domain/cart.js';
import type { Cart } from '../domain/cart.js';
import { makeRecording } from '../domain/recording.js';
import { makeAttributes } from './attributes.js';
import type { Attributes } from './attributes.js';
import type { LibraryEntry } from './library.js';
import { makeLibrary } from './library.js';
import type { Library } from './library.js';

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

export interface ImportOutcome {
  readonly library: Library;
  readonly problems: readonly Problem[];
  readonly rowsRead: number;
  readonly rowsKept: number;
}

export interface ImportOptions {
  readonly delimiter?: DelimitedOptions;
  readonly currentYear: number;
}

function splitSounds(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
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
  const problems: Problem[] = [];
  for (const field of ['cart', 'title', 'runtime']) {
    if (!columns.has(field)) {
      problems.push({
        code: IMP(91),
        severity: 'error',
        subject: 'header',
        message: `has no column for ${field}`,
      });
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  const entries: LibraryEntry[] = [];
  for (const [offset, row] of table.value.rows.entries()) {
    const line = offset + 2;
    const at = (field: string): string => {
      const column = columns.get(field);
      return column === undefined ? '' : (row.get(column) ?? '');
    };
    const built = makeCart({
      number: at('cart'),
      title: at('title'),
      billed: at('artist'),
      runtime: at('runtime'),
      ...(columns.has('category') ? { category: at('category') } : {}),
      ...(columns.has('intro') && at('intro').length > 0 ? { intro: at('intro') } : {}),
      ...(columns.has('endtype') && at('endtype').length > 0 ? { endType: at('endtype') } : {}),
      ...(columns.has('tail') && at('tail').length > 0 ? { tail: at('tail') } : {}),
    });
    if (!built.ok) {
      problems.push(...built.error.map((problem) => ({ ...problem, subject: `line ${line}` })));
      continue;
    }
    const entry = buildEntry(built.value, at, columns, options.currentYear, line, problems);
    entries.push(entry);
  }
  return ok({
    library: makeLibrary(entries),
    problems,
    rowsRead: table.value.rows.length,
    rowsKept: entries.length,
  });
}

function buildEntry(
  cart: Cart,
  at: (field: string) => string,
  columns: ReadonlyMap<string, string>,
  currentYear: number,
  line: number,
  problems: Problem[],
): LibraryEntry {
  let attributes: Attributes | undefined;
  const coded = makeAttributes(`line ${line}`, {
    ...(columns.has('tempo') && at('tempo').length > 0 ? { tempo: at('tempo') } : {}),
    ...(columns.has('mood') && at('mood').length > 0 ? { mood: at('mood') } : {}),
    ...(columns.has('texture') && at('texture').length > 0 ? { texture: at('texture') } : {}),
    ...(columns.has('sounds') ? { sounds: splitSounds(at('sounds')) } : {}),
  });
  if (coded.ok) {
    attributes = coded.value;
  } else {
    problems.push(...coded.error);
  }
  // Whatever happens to the recording, the coded attributes belong on the entry.
  const coding = attributes === undefined ? {} : { attributes };
  if (!columns.has('isrc') || at('isrc').length === 0) {
    return { cart, ...coding };
  }
  const recording = makeRecording(
    {
      isrc: at('isrc'),
      title: cart.title,
      label: columns.has('label') ? at('label') : '',
      ...(columns.has('payee') && at('payee').length > 0 ? { payee: at('payee') } : {}),
      releaseYear: columns.has('year') ? Number.parseInt(at('year'), 10) : Number.NaN,
    },
    currentYear,
  );
  if (!recording.ok) {
    problems.push(...recording.error.map((problem) => ({ ...problem, subject: `line ${line}` })));
    return { cart, ...coding };
  }
  return { cart, recording: recording.value, ...coding };
}
