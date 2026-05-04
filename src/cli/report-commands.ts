/**
 * The report commands.
 *
 * One shape needs translating and it is the awkward one. A daypart is a name, a
 * set of weekdays and an hour band, and an operator will not type json for it.
 * The form here is `AMD:1-5:6-10`, and the option repeats: naming the same
 * daypart twice adds a span to it rather than replacing it, which is how a
 * weekday band and a Saturday band end up being the same daypart.
 *
 * That last part is the only thing in this file worth a test on its own. A
 * daypart that quietly replaced its own spans would report a station as having
 * no weekend rotation at all, and the number would look plausible.
 */

import { Command } from 'commander';
import type { Runner, Sink } from './station-commands.js';

export interface SpanSpec {
  readonly days: number[];
  readonly fromHour: number;
  readonly toHour: number;
}

export interface DaypartSpec {
  readonly name: string;
  readonly spans: SpanSpec[];
}

/** Days as `1-5`, or as `0+6` for a set that is not a run. */
export function parseDays(text: string): number[] | undefined {
  const days: number[] = [];
  for (const part of text.split('+')) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range !== null) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > to) {
        return undefined;
      }
      for (let day = from; day <= to; day += 1) {
        days.push(day);
      }
      continue;
    }
    if (!/^\d$/.test(part)) {
      return undefined;
    }
    days.push(Number(part));
  }
  return days.length === 0 ? undefined : [...new Set(days)].sort((a, b) => a - b);
}

export function parseDaypart(text: string): DaypartSpec | undefined {
  const parts = text.split(':');
  if (parts.length !== 3) {
    return undefined;
  }
  const name = (parts[0] ?? '').trim();
  const days = parseDays((parts[1] ?? '').trim());
  const band = /^(\d{1,2})-(\d{1,2})$/.exec((parts[2] ?? '').trim());
  if (name === '' || days === undefined || band === null) {
    return undefined;
  }
  const fromHour = Number(band[1]);
  const toHour = Number(band[2]);
  if (fromHour >= toHour || toHour > 24) {
    return undefined;
  }
  return { name, spans: [{ days, fromHour, toHour }] };
}

/**
 * Fold the repeated options into one daypart per name. The order the operator
 * gave them in is kept, because the report prints them in that order and an
 * operator who lists morning drive first expects to read it first.
 */
export function parseDayparts(
  values: readonly string[],
): { dayparts: DaypartSpec[] } | { bad: string[] } {
  const byName = new Map<string, DaypartSpec>();
  const bad: string[] = [];
  for (const value of values) {
    const parsed = parseDaypart(value);
    if (parsed === undefined) {
      bad.push(value);
      continue;
    }
    const already = byName.get(parsed.name);
    if (already === undefined) {
      byName.set(parsed.name, { name: parsed.name, spans: [...parsed.spans] });
    } else {
      already.spans.push(...parsed.spans);
    }
  }
  return bad.length > 0 ? { bad } : { dayparts: [...byName.values()] };
}

/** Cycle lengths as `A=24`, for the check no single cart can fail on its own. */
export function parseCycles(
  values: readonly string[],
): { cycles: { category: string; hours: number }[] } | { bad: string[] } {
  const cycles: { category: string; hours: number }[] = [];
  const bad: string[] = [];
  for (const value of values) {
    const split = value.indexOf('=');
    const category = split < 0 ? '' : value.slice(0, split).trim();
    const hours = Number(split < 0 ? Number.NaN : value.slice(split + 1).trim());
    if (category === '' || !Number.isFinite(hours) || hours <= 0) {
      bad.push(value);
      continue;
    }
    cycles.push({ category, hours });
  }
  return bad.length > 0 ? { bad } : { cycles };
}

export interface GridSpanSpec extends SpanSpec {
  readonly clock: string;
}

/**
 * A grid span, written `1-5:6-10=AMD`. The same form as a daypart with a clock
 * name on the end, because an operator who has typed one should not have to
 * learn a second. The split is on the first equals, so a clock whose name has
 * one in it still reads.
 */
export function parseGridSpan(text: string): GridSpanSpec | undefined {
  const split = text.indexOf('=');
  if (split < 0) {
    return undefined;
  }
  const clock = text.slice(split + 1).trim();
  const band = parseDaypart(`span:${text.slice(0, split)}`);
  const span = band?.spans[0];
  if (clock === '' || span === undefined) {
    return undefined;
  }
  return { ...span, clock };
}

export function parseGridSpans(
  values: readonly string[],
): { spans: GridSpanSpec[] } | { bad: string[] } {
  const spans: GridSpanSpec[] = [];
  const bad: string[] = [];
  for (const value of values) {
    const parsed = parseGridSpan(value);
    if (parsed === undefined) {
      bad.push(value);
    } else {
      spans.push(parsed);
    }
  }
  return bad.length > 0 ? { bad } : { spans };
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function reportCommand(run: Runner, out: Sink, fail: (lines: string[]) => void): Command {
  const report = new Command('report').description('what the last day looks like');

  report
    .command('breaches')
    .description('the rules the last day relaxed')
    .option('--limit <n>', 'how many individual breaches to list', Number)
    .option('--summary', 'the one line, without the page')
    .action((options: Record<string, unknown>) => {
      out(
        run('report.breaches', {
          ...(options['limit'] === undefined ? {} : { detailLimit: options['limit'] }),
          ...(options['summary'] === true ? { summaryOnly: true } : {}),
        }),
      );
    });

  report
    .command('health')
    .description('whether the rotation is spread, and what to fix first')
    .option('--daypart <name:days:hours>', 'as AMD:1-5:6-10, repeatable', collect, [] as string[])
    .option('--cycle <code=hours>', 'a cycle length, as A=24, repeatable', collect, [] as string[])
    .action((options: Record<string, unknown>) => {
      const named = (options['daypart'] as string[] | undefined) ?? [];
      if (named.length === 0) {
        // A required option with a default is not required, and commander is
        // right about that. The check belongs here, where the message can name
        // the form rather than an array index.
        fail(['name at least one daypart, as AMD:1-5:6-10']);
        return;
      }
      const dayparts = parseDayparts(named);
      if ('bad' in dayparts) {
        fail(
          dayparts.bad.map((value) => `${value} is not a daypart, which is written AMD:1-5:6-10`),
        );
        return;
      }
      const cycles = parseCycles((options['cycle'] as string[] | undefined) ?? []);
      if ('bad' in cycles) {
        fail(cycles.bad.map((value) => `${value} is not a cycle length, which is written A=24`));
        return;
      }
      out(run('report.health', { dayparts: dayparts.dayparts, cycles: cycles.cycles }));
    });

  report
    .command('turnover')
    .description('how often each category comes round')
    .option('--span <days:hours=clock>', 'as 1-5:6-10=AMD, repeatable', collect, [] as string[])
    .option('--name <name>', 'what the grid is called')
    .action((options: Record<string, unknown>) => {
      const named = (options['span'] as string[] | undefined) ?? [];
      if (named.length === 0) {
        fail(['name at least one grid span, as 1-5:6-10=AMD']);
        return;
      }
      const spans = parseGridSpans(named);
      if ('bad' in spans) {
        fail(
          spans.bad.map((value) => `${value} is not a grid span, which is written 1-5:6-10=AMD`),
        );
        return;
      }
      out(
        run('report.turnover', {
          grid: {
            spans: spans.spans,
            ...(options['name'] === undefined ? {} : { name: options['name'] }),
          },
        }),
      );
    });

  report
    .command('filings')
    .description('what has been filed from this journal')
    .action(() => {
      out(run('report.filings', {}));
    });

  return report;
}
