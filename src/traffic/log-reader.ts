/**
 * Reading the traffic log.
 *
 * Traffic runs on its own system and sends a file every afternoon for the next
 * day: one line per spot, saying which hour and which break it belongs in. The
 * music scheduler reads it and never writes to it, because traffic is the system
 * of record for anything that was sold.
 *
 * Two things about the format cost real time. The hour is the wall clock hour
 * rather than an index into the broadcast day, so a station whose day starts at
 * 05:00 has to translate, and getting that wrong puts the overnight breaks on
 * the wrong day. And a break is named rather than numbered, so a clock that
 * renames a break silently orphans every spot traffic sold into it.
 */

import { COMMA, readTable } from '../util/delimited.js';
import type { DelimitedOptions } from '../util/delimited.js';
import { codeFor, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';
import { makeSpot } from './spot.js';
import type { Spot } from './spot.js';

const LOG = (n: number): string => codeFor('traffic', n);

export const LOG_UNREADABLE = LOG(40);
export const LOG_MISSING_COLUMN = LOG(41);
export const LOG_BAD_HOUR = LOG(42);

export interface ScheduledSpot {
  readonly spot: Spot;
  /** Wall clock hour the spot was sold into, 0 to 23. */
  readonly clockHour: number;
  /** The break it belongs in, by the name the clock gives it. */
  readonly breakName: string;
}

export interface TrafficLog {
  readonly spots: readonly ScheduledSpot[];
  readonly problems: readonly Problem[];
  readonly linesRead: number;
}

export const LOG_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  spot: ['spot', 'spotid', 'spot#', 'id'],
  order: ['order', 'orderid', 'order#', 'contract'],
  cart: ['cart', 'cart#', 'cartno'],
  length: ['length', 'len', 'duration', 'runtime'],
  hour: ['hour', 'hr', 'clockhour'],
  break: ['break', 'breakname', 'stopset', 'position'],
  priority: ['priority', 'pri', 'rank'],
};

function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function resolveLogColumns(header: readonly string[]): Map<string, string> {
  const seen = new Map(header.map((column) => [normalise(column), column]));
  const resolved = new Map<string, string>();
  for (const [field, aliases] of Object.entries(LOG_COLUMNS)) {
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

export interface LogOptions {
  readonly delimiter?: DelimitedOptions;
}

export function readTrafficLog(
  text: string,
  options: LogOptions = {},
): Result<TrafficLog, Problem[]> {
  const table = readTable(text, options.delimiter ?? COMMA);
  if (!table.ok) {
    return err([warning(LOG_UNREADABLE, `line ${table.error.line}`, table.error.reason)]);
  }
  const columns = resolveLogColumns(table.value.header);
  const missing = ['spot', 'order', 'cart', 'length', 'hour', 'break'].filter(
    (field) => !columns.has(field),
  );
  if (missing.length > 0) {
    return err(
      missing.map((field) => warning(LOG_MISSING_COLUMN, 'header', `has no column for ${field}`)),
    );
  }

  const problems: Problem[] = [];
  const spots: ScheduledSpot[] = [];
  for (const [offset, row] of table.value.rows.entries()) {
    const where = `line ${offset + 2}`;
    const at = (field: string): string => {
      const column = columns.get(field);
      return column === undefined ? '' : (row.get(column) ?? '');
    };
    const hour = Number.parseInt(at('hour'), 10);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      problems.push(
        warning(LOG_BAD_HOUR, where, 'names an hour outside the day', { given: at('hour') }),
      );
      continue;
    }
    const built = makeSpot({
      id: at('spot'),
      orderId: at('order'),
      cart: at('cart'),
      length: at('length'),
      ...(columns.has('priority') && at('priority').length > 0
        ? { priority: Number.parseInt(at('priority'), 10) }
        : {}),
    });
    if (!built.ok) {
      problems.push(...built.error.map((problem) => ({ ...problem, subject: where })));
      continue;
    }
    spots.push({ spot: built.value, clockHour: hour, breakName: at('break').trim() });
  }
  return ok({ spots, problems, linesRead: table.value.rows.length });
}

/** The spots sold into one break of one hour, in the order traffic listed them. */
export function spotsFor(log: TrafficLog, clockHour: number, breakName: string): Spot[] {
  return log.spots
    .filter((each) => each.clockHour === clockHour && each.breakName === breakName)
    .map((each) => each.spot);
}

/** Break names traffic sold into. A clock that has none of these orphans them. */
export function breakNames(log: TrafficLog): string[] {
  return [...new Set(log.spots.map((each) => each.breakName))].sort();
}

export function hoursUsed(log: TrafficLog): number[] {
  return [...new Set(log.spots.map((each) => each.clockHour))].sort((a, b) => a - b);
}

/** Spots traffic sold into a break no clock in the grid defines. */
export function orphaned(log: TrafficLog, known: readonly string[]): ScheduledSpot[] {
  const defined = new Set(known);
  return log.spots.filter((each) => !defined.has(each.breakName));
}
