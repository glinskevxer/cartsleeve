/**
 * The part of importing that both readers share.
 *
 * The delimited reader and the card image reader disagree about how to get a
 * field out of a row and agree about everything after that. Both were carrying
 * their own copy of build the cart, build the recording, code the attributes,
 * attribute every problem to the right line, and the two copies had already
 * drifted: only one of them kept the attributes when a row also had an ISRC.
 *
 * So a row is now nothing but a way to ask for a field by name, and everything
 * downstream of that question lives here once.
 */

import type { Problem } from '../util/problem.js';
import { makeCart } from '../domain/cart.js';
import { makeRecording } from '../domain/recording.js';
import { makeAttributes } from './attributes.js';
import type { LibraryEntry } from './library.js';
import { makeLibrary } from './library.js';
import type { Library } from './library.js';

/** Ask a row for a field. An absent field reads as the empty string. */
export type FieldReader = (field: string) => string;

export interface SourceRow {
  /** Where this row came from, for attributing a problem. */
  readonly where: string;
  readonly read: FieldReader;
  /** Fields the source actually carries, so an absent one is not a blank one. */
  readonly has: (field: string) => boolean;
}

export interface ImportCoreOptions {
  readonly currentYear: number;
}

export interface ImportCoreOutcome {
  readonly library: Library;
  readonly problems: readonly Problem[];
  readonly rowsRead: number;
  readonly rowsKept: number;
}

export function splitSounds(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

/** Include a key only when the source carries it and it is not blank. */
function optional(row: SourceRow, field: string, as: string): Record<string, string> {
  if (!row.has(field)) {
    return {};
  }
  const value = row.read(field);
  return value.length === 0 ? {} : { [as]: value };
}

function attributesFor(row: SourceRow, problems: Problem[]): LibraryEntry['attributes'] {
  const coded = makeAttributes(row.where, {
    ...optional(row, 'tempo', 'tempo'),
    ...optional(row, 'mood', 'mood'),
    ...optional(row, 'texture', 'texture'),
    ...(row.has('sounds') ? { sounds: splitSounds(row.read('sounds')) } : {}),
  });
  if (coded.ok) {
    return coded.value;
  }
  problems.push(...coded.error);
  return undefined;
}

export function entryFrom(
  row: SourceRow,
  options: ImportCoreOptions,
  problems: Problem[],
): LibraryEntry | undefined {
  const built = makeCart({
    number: row.read('cart'),
    title: row.read('title'),
    billed: row.read('artist'),
    runtime: row.read('runtime'),
    ...optional(row, 'category', 'category'),
    ...optional(row, 'intro', 'intro'),
    ...optional(row, 'endtype', 'endType'),
    ...optional(row, 'tail', 'tail'),
  });
  if (!built.ok) {
    problems.push(...built.error.map((problem) => ({ ...problem, subject: row.where })));
    return undefined;
  }
  const attributes = attributesFor(row, problems);
  const coding = attributes === undefined ? {} : { attributes };
  if (!row.has('isrc') || row.read('isrc').length === 0) {
    return { cart: built.value, ...coding };
  }
  const recording = makeRecording(
    {
      isrc: row.read('isrc'),
      title: built.value.title,
      label: row.has('label') ? row.read('label') : '',
      ...optional(row, 'payee', 'payee'),
      releaseYear: row.has('year') ? Number.parseInt(row.read('year'), 10) : Number.NaN,
    },
    options.currentYear,
  );
  if (!recording.ok) {
    problems.push(...recording.error.map((problem) => ({ ...problem, subject: row.where })));
    return { cart: built.value, ...coding };
  }
  return { cart: built.value, recording: recording.value, ...coding };
}

/** Build a library from rows, keeping every problem and every good row. */
export function importRows(
  rows: readonly SourceRow[],
  options: ImportCoreOptions,
): ImportCoreOutcome {
  const problems: Problem[] = [];
  const entries: LibraryEntry[] = [];
  for (const row of rows) {
    const entry = entryFrom(row, options, problems);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return {
    library: makeLibrary(entries),
    problems,
    rowsRead: rows.length,
    rowsKept: entries.length,
  };
}
