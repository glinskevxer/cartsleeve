import { describe, expect, it } from 'vitest';
import {
  categoryCommand,
  clockCommand,
  isElementProblem,
  libraryCommand,
  parseElement,
} from '../../src/cli/station-commands.js';
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

describe('parseElement', () => {
  it('reads a kind and a target', () => {
    expect(parseElement('music,0:00')).toEqual({ kind: 'music', target: '0:00' });
  });

  it('reads the keys an element carries', () => {
    expect(parseElement('music,0:00,category=A')).toEqual({
      kind: 'music',
      target: '0:00',
      category: 'A',
    });
  });

  it('reads a stopset with a budget and a name', () => {
    expect(parseElement('stopset,10:00,budget=3:00,name=break one')).toEqual({
      kind: 'stopset',
      target: '10:00',
      budget: '3:00',
      name: 'break one',
    });
  });

  it('reads a flag with no value as true', () => {
    expect(parseElement('music,0:00,noOpen')).toMatchObject({ noOpen: true });
  });

  it('reads a flag set to something other than true as false', () => {
    expect(parseElement('music,0:00,noOpen=false')).toMatchObject({ noOpen: false });
  });

  it('ignores the space an operator leaves after a comma', () => {
    expect(parseElement('music, 0:00, category=A')).toMatchObject({ category: 'A' });
  });

  it('refuses a kind nobody has heard of', () => {
    const parsed = parseElement('jingle,0:00');
    expect(isElementProblem(parsed)).toBe(true);
    expect(isElementProblem(parsed) && parsed.reason).toContain('jingle');
  });

  it('refuses an element with no target time', () => {
    const parsed = parseElement('music');
    expect(isElementProblem(parsed) && parsed.reason).toContain('target');
  });

  it('refuses a key that is a typo rather than dropping it', () => {
    const parsed = parseElement('music,0:00,catagory=A');
    expect(isElementProblem(parsed)).toBe(true);
    expect(isElementProblem(parsed) && parsed.reason).toContain('catagory');
  });

  it('refuses an empty string', () => {
    expect(isElementProblem(parseElement(''))).toBe(true);
  });
});

describe('library add', () => {
  it('sends the cart the operator described', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), [
      'add',
      '--number',
      'M0001',
      '--title',
      'Ferry Road',
      '--runtime',
      '3:12',
      '--category',
      'A',
    ]);
    expect(it0.calls[0]?.op).toBe('library.add');
    expect(it0.calls[0]?.params['cart']).toEqual({
      number: 'M0001',
      title: 'Ferry Road',
      runtime: '3:12',
      category: 'A',
    });
  });

  it('sends no recording when no isrc was given', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), [
      'add',
      '--number',
      'M0001',
      '--title',
      'Ferry Road',
      '--runtime',
      '3:12',
    ]);
    expect(it0.calls[0]?.params['recording']).toBeUndefined();
  });

  it('sends a recording when an isrc was given, taking the cart title by default', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), [
      'add',
      '--number',
      'M0001',
      '--title',
      'Ferry Road',
      '--runtime',
      '3:12',
      '--isrc',
      'GBAAA2300001',
      '--label',
      'Bright Terrace',
      '--releaseYear',
      '2023',
    ]);
    expect(it0.calls[0]?.params['recording']).toEqual({
      isrc: 'GBAAA2300001',
      title: 'Ferry Road',
      label: 'Bright Terrace',
      releaseYear: 2023,
    });
  });

  it('keeps a recording title that differs from the cart title', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), [
      'add',
      '--number',
      'M0001',
      '--title',
      'Ferry Road (edit)',
      '--runtime',
      '3:12',
      '--isrc',
      'GBAAA2300001',
      '--recordingTitle',
      'Ferry Road',
      '--releaseYear',
      '2023',
    ]);
    const recording = it0.calls[0]?.params['recording'] as { title: string };
    expect(recording.title).toBe('Ferry Road');
  });

  it('refuses to run without the options a cart cannot do without', () => {
    const it0 = spy();
    expect(() => run(libraryCommand(it0.run, it0.out), ['add', '--number', 'M0001'])).toThrow();
    expect(it0.calls).toHaveLength(0);
  });
});

describe('the other library commands', () => {
  it('removes a cart by number', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), ['remove', 'M0001']);
    expect(it0.calls[0]).toEqual({ op: 'library.remove', params: { cart: 'M0001' } });
  });

  it('cards a cart, with a note when one was given', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), ['card', 'M0001', 'B', '--note', 'burned out']);
    expect(it0.calls[0]?.params).toEqual({ cart: 'M0001', to: 'B', note: 'burned out' });
  });

  it('sends no note key at all when none was given', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), ['card', 'M0001', 'B']);
    expect(it0.calls[0]?.params).toEqual({ cart: 'M0001', to: 'B' });
  });

  it('reads one cart', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), ['get', 'M0001']);
    expect(it0.calls[0]?.op).toBe('library.get');
  });

  it('counts the whole library with no category', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), ['count']);
    expect(it0.calls[0]).toEqual({ op: 'library.count', params: {} });
  });

  it('counts one category when asked', () => {
    const it0 = spy();
    run(libraryCommand(it0.run, it0.out), ['count', '--category', 'A']);
    expect(it0.calls[0]?.params).toEqual({ category: 'A' });
  });
});

describe('category add', () => {
  it('sends the code and the name', () => {
    const it0 = spy();
    run(categoryCommand(it0.run, it0.out), ['add', 'Z', 'Overnight gold']);
    expect(it0.calls[0]).toEqual({
      op: 'category.add',
      params: { code: 'Z', name: 'Overnight gold' },
    });
  });

  it('reads the numeric options as numbers, not strings', () => {
    const it0 = spy();
    run(categoryCommand(it0.run, it0.out), ['add', 'Z', 'Gold', '--packets', '4']);
    expect(it0.calls[0]?.params['packets']).toBe(4);
  });
});

describe('clock add', () => {
  it('builds an element list from the repeated option', () => {
    const it0 = spy();
    run(clockCommand(it0.run, it0.out, it0.fail), [
      'add',
      'AMD',
      '--element',
      'music,0:00,category=A',
      '--element',
      'stopset,10:00,budget=3:00,name=break',
    ]);
    expect(it0.calls[0]?.op).toBe('clock.add');
    expect(it0.calls[0]?.params).toEqual({
      name: 'AMD',
      elements: [
        { kind: 'music', target: '0:00', category: 'A' },
        { kind: 'stopset', target: '10:00', budget: '3:00', name: 'break' },
      ],
    });
  });

  it('sends nothing at all when an element will not read', () => {
    const it0 = spy();
    run(clockCommand(it0.run, it0.out, it0.fail), [
      'add',
      'AMD',
      '--element',
      'music,0:00',
      '--element',
      'jingle,4:00',
    ]);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]).toHaveLength(1);
    expect(it0.failures[0]?.[0]).toContain('jingle');
  });

  it('reports every bad element rather than the first', () => {
    const it0 = spy();
    run(clockCommand(it0.run, it0.out, it0.fail), [
      'add',
      'AMD',
      '--element',
      'jingle,4:00',
      '--element',
      'music,0:00,catagory=A',
    ]);
    expect(it0.failures[0]).toHaveLength(2);
  });

  it('sends nothing when no element was named at all', () => {
    const it0 = spy();
    run(clockCommand(it0.run, it0.out, it0.fail), ['add', 'AMD']);
    expect(it0.calls).toHaveLength(0);
    expect(it0.failures[0]?.[0]).toContain('AMD');
  });

  it('replaces through the replace operation', () => {
    const it0 = spy();
    run(clockCommand(it0.run, it0.out, it0.fail), ['replace', 'AMD', '--element', 'music,0:00']);
    expect(it0.calls[0]?.op).toBe('clock.replace');
  });

  it('reads and lists', () => {
    const it0 = spy();
    run(clockCommand(it0.run, it0.out, it0.fail), ['get', 'AMD']);
    run(clockCommand(it0.run, it0.out, it0.fail), ['list']);
    expect(it0.calls.map((call) => call.op)).toEqual(['clock.get', 'clock.list']);
  });
});
