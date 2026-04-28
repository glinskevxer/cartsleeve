import { describe, expect, it } from 'vitest';
import {
  parseCycles,
  parseDaypart,
  parseDayparts,
  reportCommand,
} from '../../src/cli/report-commands.js';
import type { Runner, Sink } from '../../src/cli/station-commands.js';
import { succeed } from '../../src/api/envelope.js';
import type { ApiRequest, ApiResponse } from '../../src/api/envelope.js';
import type { Command } from 'commander';

const REQUEST: ApiRequest = { op: 'x', id: 'r1', at: 1_000, params: {} };

interface Spy {
  readonly calls: { op: string; params: Record<string, unknown> }[];
  readonly failures: string[][];
  readonly run: Runner;
  readonly out: Sink;
  readonly fail: (lines: string[]) => void;
}

function spy(): Spy {
  const calls: { op: string; params: Record<string, unknown> }[] = [];
  const failures: string[][] = [];
  return {
    calls,
    failures,
    run: (op, params): ApiResponse<unknown> => {
      calls.push({ op, params });
      return succeed(REQUEST, {});
    },
    out: () => undefined,
    fail: (lines) => failures.push(lines),
  };
}

function run(command: Command, argv: readonly string[]): void {
  command
    .exitOverride()
    .configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
    .parse([...argv], { from: 'user' });
}

describe('parseDaypart', () => {
  it('reads a name, a run of days and an hour band', () => {
    expect(parseDaypart('AMD:1-5:6-10')).toEqual({
      name: 'AMD',
      spans: [{ days: [1, 2, 3, 4, 5], fromHour: 6, toHour: 10 }],
    });
  });

  it('reads a set of days that is not a run', () => {
    expect(parseDaypart('WKD:0+6:6-10')?.spans[0]?.days).toEqual([0, 6]);
  });

  it('reads a single day', () => {
    expect(parseDaypart('SUN:0:6-10')?.spans[0]?.days).toEqual([0]);
  });

  it('drops a day named twice', () => {
    expect(parseDaypart('X:1+1:6-10')?.spans[0]?.days).toEqual([1]);
  });

  it('refuses a band that ends before it starts', () => {
    expect(parseDaypart('AMD:1-5:10-6')).toBeUndefined();
  });

  it('refuses a band that runs past the day', () => {
    expect(parseDaypart('AMD:1-5:20-26')).toBeUndefined();
  });

  it('refuses a run of days that goes backwards', () => {
    expect(parseDaypart('AMD:5-1:6-10')).toBeUndefined();
  });

  it('refuses one with the wrong number of parts', () => {
    expect(parseDaypart('AMD:1-5')).toBeUndefined();
    expect(parseDaypart('AMD:1-5:6-10:extra')).toBeUndefined();
  });

  it('refuses one with no name', () => {
    expect(parseDaypart(':1-5:6-10')).toBeUndefined();
  });
});

describe('parseDayparts', () => {
  it('adds a span to a daypart named twice rather than replacing it', () => {
    const parsed = parseDayparts(['AMD:1-5:6-10', 'AMD:6:8-12']);
    expect('dayparts' in parsed && parsed.dayparts).toHaveLength(1);
    expect('dayparts' in parsed && parsed.dayparts[0]?.spans).toHaveLength(2);
  });

  it('keeps the order the operator listed them in', () => {
    const parsed = parseDayparts(['PMD:1-5:15-19', 'AMD:1-5:6-10']);
    expect('dayparts' in parsed && parsed.dayparts.map((part) => part.name)).toEqual([
      'PMD',
      'AMD',
    ]);
  });

  it('names every bad one', () => {
    const parsed = parseDayparts(['AMD:1-5:6-10', 'nope', 'also:nope']);
    expect('bad' in parsed && parsed.bad).toHaveLength(2);
  });
});

describe('parseCycles', () => {
  it('reads a category and its cycle length', () => {
    expect(parseCycles(['A=24'])).toEqual({ cycles: [{ category: 'A', hours: 24 }] });
  });

  it('reads a fractional cycle, because a cycle can be fractional', () => {
    expect(parseCycles(['A=4.5'])).toEqual({ cycles: [{ category: 'A', hours: 4.5 }] });
  });

  it('refuses a cycle of nothing', () => {
    expect(parseCycles(['A=0'])).toEqual({ bad: ['A=0'] });
  });

  it('refuses one with no equals or no number', () => {
    expect(parseCycles(['A24'])).toEqual({ bad: ['A24'] });
    expect(parseCycles(['A=soon'])).toEqual({ bad: ['A=soon'] });
  });

  it('reads an empty list as no cycles', () => {
    expect(parseCycles([])).toEqual({ cycles: [] });
  });
});

describe('report breaches', () => {
  it('asks for the page with no options at all', () => {
    const it0 = spy();
    run(reportCommand(it0.run, it0.out, it0.fail), ['breaches']);
    expect(it0.calls[0]).toEqual({ op: 'report.breaches', params: {} });
  });

  it('passes the limit through as a number', () => {
    const it0 = spy();
    run(reportCommand(it0.run, it0.out, it0.fail), ['breaches', '--limit', '10']);
    expect(it0.calls[0]?.params).toEqual({ detailLimit: 10 });
  });

  it('asks for only the summary when told to', () => {
    const it0 = spy();
    run(reportCommand(it0.run, it0.out, it0.fail), ['breaches', '--summary']);
    expect(it0.calls[0]?.params).toEqual({ summaryOnly: true });
  });
});

describe('report health', () => {
  it('sends the dayparts it read', () => {
    const it0 = spy();
    run(reportCommand(it0.run, it0.out, it0.fail), [
      'health',
      '--daypart',
      'AMD:1-5:6-10',
      '--daypart',
      'PMD:1-5:15-19',
    ]);
    expect(it0.calls[0]?.op).toBe('report.health');
    expect(it0.calls[0]?.params['dayparts']).toHaveLength(2);
  });

  it('sends the cycles when there are any, and an empty list when there are not', () => {
    const it0 = spy();
    run(reportCommand(it0.run, it0.out, it0.fail), [
      'health',
      '--daypart',
      'AMD:1-5:6-10',
      '--cycle',
      'A=24',
    ]);
    expect(it0.calls[0]?.params['cycles']).toEqual([{ category: 'A', hours: 24 }]);
    run(reportCommand(it0.run, it0.out, it0.fail), ['health', '--daypart', 'AMD:1-5:6-10']);
    expect(it0.calls[1]?.params['cycles']).toEqual([]);
  });

  it('sends nothing when a daypart will not read', () => {
    const it0 = spy();
    run(reportCommand(it0.run, it0.out, it0.fail), ['health', '--daypart', 'AMD']);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('AMD:1-5:6-10');
  });

  it('sends nothing when a cycle will not read', () => {
    const it0 = spy();
    run(reportCommand(it0.run, it0.out, it0.fail), [
      'health',
      '--daypart',
      'AMD:1-5:6-10',
      '--cycle',
      'A',
    ]);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('A=24');
  });

  it('sends nothing when no daypart was named at all', () => {
    const it0 = spy();
    run(reportCommand(it0.run, it0.out, it0.fail), ['health']);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('at least one daypart');
  });
});

describe('report filings', () => {
  it('asks for the filing history', () => {
    const it0 = spy();
    run(reportCommand(it0.run, it0.out, it0.fail), ['filings']);
    expect(it0.calls[0]).toEqual({ op: 'report.filings', params: {} });
  });
});
