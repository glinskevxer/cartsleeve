import { describe, expect, it } from 'vitest';
import {
  parseDay,
  parseHourClocks,
  scheduleCommand,
  trafficCommand,
  weekdayOf,
} from '../../src/cli/schedule-commands.js';
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

describe('parseDay', () => {
  it('reads the one date form the tool takes', () => {
    expect(parseDay('2025-06-10')).toEqual({ year: 2025, month: 6, day: 10 });
  });

  it('ignores the space around it', () => {
    expect(parseDay(' 2025-06-10 ')).toEqual({ year: 2025, month: 6, day: 10 });
  });

  it('refuses a date written the other way round rather than guessing', () => {
    expect(parseDay('06-10-2025')).toBeUndefined();
  });

  it('refuses a date with no padding, because that is where the guessing starts', () => {
    expect(parseDay('2025-6-1')).toBeUndefined();
  });

  it('refuses a month and a day nobody has', () => {
    expect(parseDay('2025-13-10')).toBeUndefined();
    expect(parseDay('2025-06-32')).toBeUndefined();
  });

  it('refuses something that is not a date at all', () => {
    expect(parseDay('tomorrow')).toBeUndefined();
  });
});

describe('weekdayOf', () => {
  it('reads the day of the week off the calendar', () => {
    expect(weekdayOf({ year: 2025, month: 6, day: 10 })).toBe(2);
    expect(weekdayOf({ year: 2025, month: 6, day: 8 })).toBe(0);
    expect(weekdayOf({ year: 2025, month: 6, day: 14 })).toBe(6);
  });
});

describe('parseHourClocks', () => {
  it('reads an hour and a clock', () => {
    expect(parseHourClocks(['6=AMD'])).toEqual({ clocks: { '6': 'AMD' } });
  });

  it('reads several, and the later one wins on the same hour', () => {
    expect(parseHourClocks(['6=AMD', '7=MID', '6=OVN'])).toEqual({
      clocks: { '6': 'OVN', '7': 'MID' },
    });
  });

  it('ignores the space an operator leaves around the equals', () => {
    expect(parseHourClocks([' 6 = AMD '])).toEqual({ clocks: { '6': 'AMD' } });
  });

  it('refuses one with no clock name', () => {
    expect(parseHourClocks(['6='])).toEqual({ bad: ['6='] });
  });

  it('refuses one with no equals at all', () => {
    expect(parseHourClocks(['6 AMD'])).toEqual({ bad: ['6 AMD'] });
  });

  it('refuses an hour outside the day', () => {
    expect(parseHourClocks(['25=AMD'])).toEqual({ bad: ['25=AMD'] });
  });

  it('names every bad one rather than the first', () => {
    const parsed = parseHourClocks(['6=AMD', 'x=MID', '99=OVN']);
    expect('bad' in parsed && parsed.bad).toHaveLength(2);
  });
});

describe('schedule day', () => {
  it('sends the date and the weekday it works out for itself', () => {
    const it0 = spy();
    run(scheduleCommand(it0.run, it0.out, it0.fail), ['day', '2025-06-10', '--clock', 'AMD']);
    expect(it0.calls[0]?.op).toBe('schedule.day');
    expect(it0.calls[0]?.params).toEqual({
      day: { year: 2025, month: 6, day: 10 },
      weekday: 2,
      clock: 'AMD',
    });
  });

  it('sends the hour overrides when there are any', () => {
    const it0 = spy();
    run(scheduleCommand(it0.run, it0.out, it0.fail), [
      'day',
      '2025-06-10',
      '--clock',
      'AMD',
      '--hour',
      '21=OVN',
    ]);
    expect(it0.calls[0]?.params['clocks']).toEqual({ '21': 'OVN' });
  });

  it('sends the numbers as numbers', () => {
    const it0 = spy();
    run(scheduleCommand(it0.run, it0.out, it0.fail), [
      'day',
      '2025-06-10',
      '--clock',
      'AMD',
      '--hours',
      '23',
      '--floor',
      '2',
    ]);
    expect(it0.calls[0]?.params).toMatchObject({ hours: 23, floor: 2 });
  });

  it('sends the carry flag only when it was given', () => {
    const it0 = spy();
    run(scheduleCommand(it0.run, it0.out, it0.fail), [
      'day',
      '2025-06-10',
      '--clock',
      'AMD',
      '--carry',
    ]);
    expect(it0.calls[0]?.params['carry']).toBe(true);
    run(scheduleCommand(it0.run, it0.out, it0.fail), ['day', '2025-06-11', '--clock', 'AMD']);
    expect(it0.calls[1]?.params['carry']).toBeUndefined();
  });

  it('sends nothing when the date will not read', () => {
    const it0 = spy();
    run(scheduleCommand(it0.run, it0.out, it0.fail), ['day', 'tomorrow', '--clock', 'AMD']);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('2025-06-10');
  });

  it('sends nothing when an hour override will not read', () => {
    const it0 = spy();
    run(scheduleCommand(it0.run, it0.out, it0.fail), [
      'day',
      '2025-06-10',
      '--clock',
      'AMD',
      '--hour',
      'six=OVN',
    ]);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('six=OVN');
  });

  it('refuses to run with no clock at all', () => {
    const it0 = spy();
    expect(() => run(scheduleCommand(it0.run, it0.out, it0.fail), ['day', '2025-06-10'])).toThrow();
  });

  it('reads the last day and its holes', () => {
    const it0 = spy();
    run(scheduleCommand(it0.run, it0.out, it0.fail), ['last']);
    run(scheduleCommand(it0.run, it0.out, it0.fail), ['holes']);
    expect(it0.calls.map((call) => call.op)).toEqual(['schedule.last', 'schedule.holes']);
  });
});

describe('traffic commands', () => {
  const LOG = 'spot,order,cart,length,hour,break\nSPT-1,ORD-1,C0455,1:00,5,break one';
  const reader = (contents: string) => (): string => contents;
  const missing = (path: string) => (): string => {
    throw new Error(`no such file ${path}`);
  };

  it('reads the file and sends its text', () => {
    const it0 = spy();
    run(trafficCommand(it0.run, it0.out, it0.fail, reader(LOG)), ['load', 'log.csv']);
    expect(it0.calls[0]?.op).toBe('traffic.load');
    expect(it0.calls[0]?.params['log']).toEqual({ text: LOG });
  });

  it('passes the delimiter through when one was named', () => {
    const it0 = spy();
    run(trafficCommand(it0.run, it0.out, it0.fail, reader(LOG)), [
      'load',
      'log.psv',
      '--delimiter',
      'pipe',
    ]);
    expect(it0.calls[0]?.params['log']).toEqual({ text: LOG, delimiter: 'pipe' });
  });

  it('sends nothing when the file is not there, and says which one', () => {
    const it0 = spy();
    run(trafficCommand(it0.run, it0.out, it0.fail, missing('log.csv')), ['load', 'log.csv']);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('log.csv');
  });

  it('merges through the merge operation', () => {
    const it0 = spy();
    run(trafficCommand(it0.run, it0.out, it0.fail, reader(LOG)), ['merge', 'log.csv']);
    expect(it0.calls[0]?.op).toBe('traffic.merge');
  });

  it('sends the tier as a number when one was given', () => {
    const it0 = spy();
    run(trafficCommand(it0.run, it0.out, it0.fail, reader(LOG)), [
      'merge',
      'log.csv',
      '--tier',
      '2',
    ]);
    expect(it0.calls[0]?.params['tier']).toBe(2);
  });

  it('sends the overfill flag only when it was given', () => {
    const it0 = spy();
    run(trafficCommand(it0.run, it0.out, it0.fail, reader(LOG)), ['merge', 'log.csv']);
    expect(it0.calls[0]?.params['allowOverfill']).toBeUndefined();
    run(trafficCommand(it0.run, it0.out, it0.fail, reader(LOG)), [
      'merge',
      'log.csv',
      '--allowOverfill',
    ]);
    expect(it0.calls[1]?.params['allowOverfill']).toBe(true);
  });

  it('does not read the file twice for one command', () => {
    let reads = 0;
    const counting = (): string => {
      reads += 1;
      return LOG;
    };
    const it0 = spy();
    run(trafficCommand(it0.run, it0.out, it0.fail, counting), ['merge', 'log.csv']);
    expect(reads).toBe(1);
  });
});
