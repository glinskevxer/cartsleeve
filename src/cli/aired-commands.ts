/**
 * The as aired commands.
 *
 * The automation writes a log of what it did and drops it somewhere the music
 * system can read. It is a delimited file like the traffic log and unlike it in
 * one way that matters: traffic says what was meant to happen and this says what
 * did, so nothing here is allowed to correct it. A row that will not read is
 * reported and skipped, never repaired.
 *
 * The timestamp column is milliseconds since the epoch, because that is what the
 * automation writes. An operator never types one, so there is no friendlier form
 * to accept.
 */

import { Command } from 'commander';
import { COMMA, PIPE, TAB, readTable } from '../util/delimited.js';
import type { DelimitedOptions } from '../util/delimited.js';
import type { Runner, Sink } from './station-commands.js';
import type { ReadFile } from './schedule-commands.js';
import { parseDay } from './schedule-commands.js';

const DELIMITERS: Record<string, DelimitedOptions> = { comma: COMMA, pipe: PIPE, tab: TAB };

/** The column each field can be called, in the order the automation writes them. */
export const EVENT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  kind: ['kind', 'event', 'type'],
  cart: ['cart', 'cart#', 'cartno'],
  at: ['at', 'time', 'timestamp', 'ms'],
  note: ['note', 'reason', 'comment'],
  position: ['position', 'slot', 'pos'],
};

function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function resolveEventColumns(header: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const [field, names] of Object.entries(EVENT_COLUMNS)) {
    const wanted = new Set(names.map(normalise));
    const column = header.find((heading) => wanted.has(normalise(heading)));
    if (column !== undefined) {
      found.set(field, column);
    }
  }
  return found;
}

export interface EventRows {
  readonly events: Record<string, unknown>[];
  readonly skipped: string[];
}

/**
 * Read the automation log into event params. Building the events themselves is
 * the api's job, so this only decides what each row says and which rows say
 * nothing readable at all.
 */
export function readEvents(text: string, delimiter: string): EventRows | { bad: string } {
  const table = readTable(text, DELIMITERS[delimiter] ?? COMMA);
  if (!table.ok) {
    return { bad: `line ${table.error.line}: ${table.error.reason}` };
  }
  const columns = resolveEventColumns(table.value.header);
  const missing = ['kind', 'cart', 'at'].filter((field) => !columns.has(field));
  if (missing.length > 0) {
    return { bad: `the header has no column for ${missing.join(', ')}` };
  }
  const events: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  for (const [offset, row] of table.value.rows.entries()) {
    const at = (field: string): string => {
      const column = columns.get(field);
      return column === undefined ? '' : (row.get(column) ?? '');
    };
    const stamp = Number(at('at'));
    if (!Number.isFinite(stamp)) {
      skipped.push(`line ${offset + 2} has no readable timestamp`);
      continue;
    }
    const position = Number.parseInt(at('position'), 10);
    events.push({
      kind: at('kind'),
      cart: at('cart').trim(),
      at: stamp,
      ...(at('note') === '' ? {} : { note: at('note') }),
      ...(Number.isInteger(position) ? { position } : {}),
    });
  }
  return { events, skipped };
}

export interface AiredDeps {
  readonly run: Runner;
  readonly out: Sink;
  readonly fail: (lines: string[]) => void;
  /** A skipped row is worth a line of its own. It is not a failure. */
  readonly note: (line: string) => void;
  readonly readFile: ReadFile;
}

export function airedCommand(deps: AiredDeps): Command {
  const { run, out, fail, readFile } = deps;
  const aired = new Command('aired').description('what the automation says actually ran');

  const withEvents = (
    path: string,
    delimiter: unknown,
    then: (events: Record<string, unknown>[], skipped: string[]) => void,
  ): void => {
    let text: string;
    try {
      text = readFile(path);
    } catch (thrown: unknown) {
      fail([`cannot read ${path}: ${thrown instanceof Error ? thrown.message : String(thrown)}`]);
      return;
    }
    const read = readEvents(text, typeof delimiter === 'string' ? delimiter : 'comma');
    if ('bad' in read) {
      fail([`${path}: ${read.bad}`]);
      return;
    }
    if (read.events.length === 0) {
      fail([`${path} holds no readable events`, ...read.skipped]);
      return;
    }
    then(read.events, read.skipped);
  };

  aired
    .command('reconcile')
    .description('compare the last scheduled day against the automation log')
    .argument('<path>', 'the log the automation wrote')
    .requiredOption('--hour <label>', 'which hour this log covers')
    .option('--delimiter <kind>', 'comma, pipe or tab')
    .action((path: string, options: Record<string, unknown>) => {
      withEvents(path, options['delimiter'], (events, skipped) => {
        for (const line of skipped) {
          deps.note(line);
        }
        out(run('aired.reconcile', { events, hour: options['hour'] }));
      });
    });

  aired
    .command('file')
    .description('build the performance report from the automation log')
    .argument('<path>', 'the log the automation wrote')
    .requiredOption('--from <date>', 'first day of the period, as 2025-04-01')
    .requiredOption('--to <date>', 'last day of the period, as 2025-06-30')
    .option('--label <label>', 'what the period is called on the filing')
    .option('--delimiter <kind>', 'comma, pipe or tab')
    .action((path: string, options: Record<string, unknown>) => {
      const from = parseDay(String(options['from']));
      const to = parseDay(String(options['to']));
      if (from === undefined || to === undefined) {
        fail(['the period needs two dates, each written 2025-04-01']);
        return;
      }
      withEvents(path, options['delimiter'], (events, skipped) => {
        for (const line of skipped) {
          deps.note(line);
        }
        out(
          run('royalty.file', {
            events,
            period: {
              from,
              to,
              label:
                options['label'] === undefined
                  ? `${options['from'] as string} to ${options['to'] as string}`
                  : options['label'],
            },
          }),
        );
      });
    });

  return aired;
}
