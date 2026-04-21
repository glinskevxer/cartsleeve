/**
 * The schedule and traffic commands.
 *
 * Two shapes an operator types that a request cannot take. A day is `2025-06-10`
 * on a command line and three numbers in a request, and a traffic log is a path
 * on a command line and the text of the file in a request. Both conversions
 * happen here and nowhere else.
 *
 * Reading the file here rather than in a handler is deliberate. The api is the
 * same whether it is called from this process or from a batch on another
 * machine, and a handler that opened a path would only work in one of those.
 */

import { Command } from 'commander';
import type { Runner, Sink } from './station-commands.js';

export interface DayParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Days of the week, in the order the calendar has them. */
const WEEKDAY_OF = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Read a date an operator typed. Only one form is accepted, because a tool that
 * takes three date formats will one day read 06-10-2025 as the sixth of October.
 */
export function parseDay(text: string): DayParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  return { year, month, day };
}

/** Which day of the week a date falls on, so the caller does not have to say. */
export function weekdayOf(parts: DayParts): number {
  const at = Date.UTC(parts.year, parts.month - 1, parts.day);
  return WEEKDAY_OF[new Date(at).getUTCDay()] ?? 0;
}

/**
 * Read a clock per hour off `--hour 6=AMD` options. The bare `--clock` covers
 * every hour and these override it, which is how a station runs one clock all
 * day and a different one overnight without listing twenty four of them.
 */
export function parseHourClocks(
  values: readonly string[],
): { clocks: Record<string, string> } | { bad: string[] } {
  const clocks: Record<string, string> = {};
  const bad: string[] = [];
  for (const value of values) {
    const split = value.indexOf('=');
    const hour = split < 0 ? '' : value.slice(0, split).trim();
    const name = split < 0 ? '' : value.slice(split + 1).trim();
    const index = Number(hour);
    if (name === '' || !Number.isInteger(index) || index < 0 || index > 24) {
      bad.push(value);
      continue;
    }
    clocks[String(index)] = name;
  }
  return bad.length > 0 ? { bad } : { clocks };
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export type ReadFile = (path: string) => string;

export function scheduleCommand(run: Runner, out: Sink, fail: (lines: string[]) => void): Command {
  const schedule = new Command('schedule').description('build a broadcast day');

  schedule
    .command('day')
    .description('schedule one day')
    .argument('<date>', 'the broadcast day, as 2025-06-10')
    .requiredOption('--clock <name>', 'the clock every hour runs unless told otherwise')
    .option(
      '--hour <index=clock>',
      'a clock for one hour index, repeatable',
      collect,
      [] as string[],
    )
    .option('--hours <n>', 'how many hours the day holds', Number)
    .option('--floor <n>', 'the lowest tier the search may relax to', Number)
    .option('--carry', 'separate against the day scheduled before this one')
    .action((date: string, options: Record<string, unknown>) => {
      const day = parseDay(date);
      if (day === undefined) {
        fail([`${date} is not a date, which is written 2025-06-10`]);
        return;
      }
      const perHour = parseHourClocks((options['hour'] as string[] | undefined) ?? []);
      if ('bad' in perHour) {
        fail(perHour.bad.map((value) => `${value} is not an hour and a clock, like 6=AMD`));
        return;
      }
      out(
        run('schedule.day', {
          day,
          weekday: weekdayOf(day),
          clock: options['clock'],
          ...(Object.keys(perHour.clocks).length === 0 ? {} : { clocks: perHour.clocks }),
          ...(options['hours'] === undefined ? {} : { hours: options['hours'] }),
          ...(options['floor'] === undefined ? {} : { floor: options['floor'] }),
          ...(options['carry'] === true ? { carry: true } : {}),
        }),
      );
    });

  schedule
    .command('last')
    .description('what the last day came to')
    .action(() => {
      out(run('schedule.last', {}));
    });

  schedule
    .command('holes')
    .description('the slots the last day could not fill')
    .action(() => {
      out(run('schedule.holes', {}));
    });

  return schedule;
}

export function trafficCommand(
  run: Runner,
  out: Sink,
  fail: (lines: string[]) => void,
  readFile: ReadFile,
): Command {
  const traffic = new Command('traffic').description('the commercial log, and what it moves');

  const withLog = (
    path: string,
    delimiter: unknown,
    then: (log: Record<string, unknown>) => void,
  ): void => {
    let text: string;
    try {
      text = readFile(path);
    } catch (thrown: unknown) {
      fail([`cannot read ${path}: ${thrown instanceof Error ? thrown.message : String(thrown)}`]);
      return;
    }
    then({ text, ...(delimiter === undefined ? {} : { delimiter }) });
  };

  traffic
    .command('load')
    .description('read a traffic log and say what is in it')
    .argument('<path>', 'the log traffic sent')
    .option('--delimiter <kind>', 'comma, pipe or tab')
    .action((path: string, options: Record<string, unknown>) => {
      withLog(path, options['delimiter'], (log) => {
        out(run('traffic.load', { log }));
      });
    });

  traffic
    .command('merge')
    .description('put the real break lengths into the last day and remeasure')
    .argument('<path>', 'the log traffic sent')
    .option('--delimiter <kind>', 'comma, pipe or tab')
    .option('--tier <n>', 'the tier the music pass settled at', Number)
    .option('--allowOverfill', 'let a break run over its budget')
    .action((path: string, options: Record<string, unknown>) => {
      withLog(path, options['delimiter'], (log) => {
        out(
          run('traffic.merge', {
            log,
            ...(options['tier'] === undefined ? {} : { tier: options['tier'] }),
            ...(options['allowOverfill'] === true ? { allowOverfill: true } : {}),
          }),
        );
      });
    });

  return traffic;
}
