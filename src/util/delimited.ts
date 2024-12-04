/**
 * Delimited files.
 *
 * Every music scheduler exports a different flavour of the same idea: a header
 * row, a delimiter that is a pipe as often as a comma, quoted fields that may
 * contain the delimiter and the line ending, and a trailing newline that may or
 * may not be there. Song titles contain commas and apostrophes and the
 * occasional embedded quote, so the reader has to be a real one.
 */

import { err, ok } from './result.js';
import type { Result } from './result.js';

export interface DelimitedOptions {
  readonly delimiter: string;
  readonly quote: string;
}

export const COMMA: DelimitedOptions = { delimiter: ',', quote: '"' };
export const PIPE: DelimitedOptions = { delimiter: '|', quote: '"' };
export const TAB: DelimitedOptions = { delimiter: '\t', quote: '"' };

export interface DelimitedProblem {
  readonly line: number;
  readonly column: number;
  readonly reason: string;
}

/**
 * Split a whole document into rows of fields. Quoted fields keep their content
 * verbatim including delimiters and newlines, and a doubled quote inside a
 * quoted field is one literal quote.
 */
export function readRows(
  text: string,
  options: DelimitedOptions = COMMA,
): Result<string[][], DelimitedProblem> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;
  let line = 1;
  let column = 1;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
    quoted = false;
    started = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
    line += 1;
    column = 0;
  };

  while (index < text.length) {
    const char = text[index] ?? '';
    if (quoted) {
      if (char === options.quote) {
        const next = text[index + 1];
        if (next === options.quote) {
          field += options.quote;
          index += 2;
          column += 2;
          continue;
        }
        quoted = false;
        index += 1;
        column += 1;
        continue;
      }
      if (char === '\n') {
        line += 1;
        column = 0;
      }
      field += char;
      index += 1;
      column += 1;
      continue;
    }
    if (char === options.quote && !started) {
      quoted = true;
      started = true;
      index += 1;
      column += 1;
      continue;
    }
    if (char === options.quote && started) {
      return err({ line, column, reason: 'a quote appeared inside an unquoted field' });
    }
    if (char === options.delimiter) {
      endField();
      index += 1;
      column += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      column += 1;
      continue;
    }
    field += char;
    started = true;
    index += 1;
    column += 1;
  }
  if (quoted) {
    return err({ line, column, reason: 'the file ended inside a quoted field' });
  }
  if (field.length > 0 || row.length > 0) {
    endRow();
  }
  return ok(rows);
}

export interface DelimitedTable {
  readonly header: string[];
  readonly rows: ReadonlyMap<string, string>[];
}

/** Read a document with a header row into records keyed by column name. */
export function readTable(
  text: string,
  options: DelimitedOptions = COMMA,
): Result<DelimitedTable, DelimitedProblem> {
  const parsed = readRows(text, options);
  if (!parsed.ok) {
    return parsed;
  }
  const [header, ...body] = parsed.value;
  if (header === undefined) {
    return err({ line: 1, column: 1, reason: 'the file has no header row' });
  }
  const seen = new Set<string>();
  for (const name of header) {
    if (seen.has(name)) {
      return err({ line: 1, column: 1, reason: `the column ${name} appears twice` });
    }
    seen.add(name);
  }
  const rows: ReadonlyMap<string, string>[] = [];
  for (const [offset, values] of body.entries()) {
    if (values.length !== header.length) {
      return err({
        line: offset + 2,
        column: 1,
        reason: `has ${values.length} fields where the header has ${header.length}`,
      });
    }
    const record = new Map<string, string>();
    for (const [position, name] of header.entries()) {
      record.set(name, values[position] ?? '');
    }
    rows.push(record);
  }
  return ok({ header, rows });
}

/** Quote a field only when it would otherwise change the shape of the row. */
export function quoteField(value: string, options: DelimitedOptions = COMMA): string {
  const needsQuote =
    value.includes(options.delimiter) ||
    value.includes(options.quote) ||
    value.includes('\n') ||
    value.includes('\r') ||
    value !== value.trim();
  if (!needsQuote) {
    return value;
  }
  const escaped = value.split(options.quote).join(options.quote + options.quote);
  return `${options.quote}${escaped}${options.quote}`;
}

export function writeRow(values: readonly string[], options: DelimitedOptions = COMMA): string {
  return values.map((value) => quoteField(value, options)).join(options.delimiter);
}

export function writeRows(
  rows: readonly (readonly string[])[],
  options: DelimitedOptions = COMMA,
): string {
  return rows.map((row) => writeRow(row, options)).join('\n') + (rows.length > 0 ? '\n' : '');
}

/** Write records back out under a fixed column order, blanking what is absent. */
export function writeTable(
  header: readonly string[],
  rows: readonly ReadonlyMap<string, string>[],
  options: DelimitedOptions = COMMA,
): string {
  const body = rows.map((record) => header.map((name) => record.get(name) ?? ''));
  return writeRows([[...header], ...body], options);
}
