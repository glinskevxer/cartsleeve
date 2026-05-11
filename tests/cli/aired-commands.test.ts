import { describe, expect, it } from 'vitest';
import {
  EVENT_COLUMNS,
  airedCommand,
  readEvents,
  resolveEventColumns,
} from '../../src/cli/aired-commands.js';
import type { Runner, Sink } from '../../src/cli/station-commands.js';
import { succeed } from '../../src/api/envelope.js';
import type { ApiRequest, ApiResponse } from '../../src/api/envelope.js';
import type { Command } from 'commander';

const REQUEST: ApiRequest = { op: 'x', id: 'r1', at: 1_000, params: {} };

interface Spy {
  readonly calls: { op: string; params: Record<string, unknown> }[];
  readonly failures: string[][];
  readonly notes: string[];
  readonly run: Runner;
  readonly out: Sink;
  readonly fail: (lines: string[]) => void;
  readonly note: (line: string) => void;
}

function spy(): Spy {
  const calls: { op: string; params: Record<string, unknown> }[] = [];
  const failures: string[][] = [];
  const notes: string[] = [];
  return {
    calls,
    failures,
    notes,
    run: (op, params): ApiResponse<unknown> => {
      calls.push({ op, params });
      return succeed(REQUEST, {});
    },
    out: () => undefined,
    fail: (lines) => failures.push(lines),
    note: (line) => notes.push(line),
  };
}

function run(command: Command, argv: readonly string[]): void {
  command
    .exitOverride()
    .configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
    .parse([...argv], { from: 'user' });
}

const HEADER = 'kind,cart,at,note,position';
const LOG = [
  HEADER,
  'start,M0001,1700000000000,,1',
  'end,M0001,1700000192000,,1',
  'start,M0002,1700000192000,,2',
].join('\n');

describe('resolveEventColumns', () => {
  it('takes each column under any of its names', () => {
    const found = resolveEventColumns(['Event', 'Cart#', 'Timestamp', 'Reason', 'Slot']);
    expect(found.get('kind')).toBe('Event');
    expect(found.get('cart')).toBe('Cart#');
    expect(found.get('at')).toBe('Timestamp');
    expect(found.get('note')).toBe('Reason');
    expect(found.get('position')).toBe('Slot');
  });

  it('ignores case and punctuation in a heading', () => {
    expect(resolveEventColumns(['  KIND  ']).get('kind')).toBe('  KIND  ');
  });

  it('finds nothing in a header that names nothing it knows', () => {
    expect(resolveEventColumns(['a', 'b']).size).toBe(0);
  });

  it('lists every field it can resolve', () => {
    expect(Object.keys(EVENT_COLUMNS)).toEqual(['kind', 'cart', 'at', 'note', 'position']);
  });
});

describe('readEvents', () => {
  it('reads a row per event', () => {
    const read = readEvents(LOG, 'comma');
    expect('events' in read && read.events).toHaveLength(3);
  });

  it('keeps the position as a number and drops it when there is none', () => {
    const read = readEvents(LOG, 'comma');
    const events = 'events' in read ? read.events : [];
    expect(events[0]?.['position']).toBe(1);
    const noPosition = readEvents([HEADER, 'start,M0001,1700000000000,,'].join('\n'), 'comma');
    const first = 'events' in noPosition ? noPosition.events[0] : undefined;
    expect(first?.['position']).toBeUndefined();
  });

  it('drops an empty note rather than sending an empty string', () => {
    const read = readEvents(LOG, 'comma');
    const events = 'events' in read ? read.events : [];
    expect(events[0]?.['note']).toBeUndefined();
  });

  it('skips a row with no readable timestamp and says which line', () => {
    const read = readEvents([HEADER, 'start,M0001,soon,,1'].join('\n'), 'comma');
    expect('events' in read && read.events).toHaveLength(0);
    expect('skipped' in read && read.skipped[0]).toContain('line 2');
  });

  it('refuses a header with no kind, cart or time', () => {
    const read = readEvents('a,b,c\n1,2,3', 'comma');
    expect('bad' in read && read.bad).toContain('kind');
  });

  it('reads a tab delimited log', () => {
    const tabbed = LOG.split(',').join('\t');
    expect('events' in readEvents(tabbed, 'tab')).toBe(true);
  });

  it('falls back to commas for a delimiter nobody has', () => {
    expect('events' in readEvents(LOG, 'semicolon')).toBe(true);
  });
});

describe('aired reconcile', () => {
  const deps = (it0: Spy, files: Record<string, string>) => ({
    run: it0.run,
    out: it0.out,
    fail: it0.fail,
    note: it0.note,
    readFile: (path: string): string => {
      const found = files[path];
      if (found === undefined) {
        throw new Error(`no such file ${path}`);
      }
      return found;
    },
  });

  it('sends the events and the hour', () => {
    const it0 = spy();
    run(airedCommand(deps(it0, { 'aired.csv': LOG })), [
      'reconcile',
      'aired.csv',
      '--hour',
      '06:00',
    ]);
    expect(it0.calls[0]?.op).toBe('aired.reconcile');
    expect(it0.calls[0]?.params['hour']).toBe('06:00');
    expect(it0.calls[0]?.params['events']).toHaveLength(3);
  });

  it('notes a skipped row without failing the command', () => {
    const it0 = spy();
    const withBad = `${LOG}\nstart,M0003,soon,,3`;
    run(airedCommand(deps(it0, { 'aired.csv': withBad })), [
      'reconcile',
      'aired.csv',
      '--hour',
      '06:00',
    ]);
    expect(it0.notes[0]).toContain('line 5');
    expect(it0.calls).toHaveLength(1);
  });

  it('sends nothing when the file is not there', () => {
    const it0 = spy();
    run(airedCommand(deps(it0, {})), ['reconcile', 'aired.csv', '--hour', '06:00']);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('aired.csv');
  });

  it('sends nothing when every row was skipped', () => {
    const it0 = spy();
    run(airedCommand(deps(it0, { 'aired.csv': `${HEADER}\nstart,M0001,soon,,1` })), [
      'reconcile',
      'aired.csv',
      '--hour',
      '06:00',
    ]);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('no readable events');
  });

  it('refuses to run without an hour', () => {
    const it0 = spy();
    expect(() =>
      run(airedCommand(deps(it0, { 'aired.csv': LOG })), ['reconcile', 'aired.csv']),
    ).toThrow();
  });
});

describe('aired file', () => {
  const deps = (it0: Spy, files: Record<string, string>) => ({
    run: it0.run,
    out: it0.out,
    fail: it0.fail,
    note: it0.note,
    readFile: (path: string): string => files[path] ?? '',
  });

  it('sends the period it was given', () => {
    const it0 = spy();
    run(airedCommand(deps(it0, { 'aired.csv': LOG })), [
      'file',
      'aired.csv',
      '--from',
      '2025-04-01',
      '--to',
      '2025-06-30',
    ]);
    expect(it0.calls[0]?.op).toBe('royalty.file');
    expect(it0.calls[0]?.params['period']).toEqual({
      from: { year: 2025, month: 4, day: 1 },
      to: { year: 2025, month: 6, day: 30 },
      label: '2025-04-01 to 2025-06-30',
    });
  });

  it('takes a label when one was given', () => {
    const it0 = spy();
    run(airedCommand(deps(it0, { 'aired.csv': LOG })), [
      'file',
      'aired.csv',
      '--from',
      '2025-04-01',
      '--to',
      '2025-06-30',
      '--label',
      'Q2 2025',
    ]);
    const period = it0.calls[0]?.params['period'] as { label: string };
    expect(period.label).toBe('Q2 2025');
  });

  it('sends nothing when a date will not read', () => {
    const it0 = spy();
    run(airedCommand(deps(it0, { 'aired.csv': LOG })), [
      'file',
      'aired.csv',
      '--from',
      'april',
      '--to',
      '2025-06-30',
    ]);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('2025-04-01');
  });

  it('checks the dates before it opens the file', () => {
    const it0 = spy();
    run(airedCommand(deps(it0, {})), ['file', 'missing.csv', '--from', 'april', '--to', 'may']);
    expect(it0.failures[0]?.[0]).toContain('two dates');
  });
});
