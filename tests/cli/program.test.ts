import { beforeEach, describe, expect, it } from 'vitest';
import { VERSION, buildProgram } from '../../src/cli/program.js';
import type { BuiltProgram } from '../../src/cli/program.js';
import { emptyState } from '../../src/service/station-service.js';
import type { StationState } from '../../src/service/station-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import { resetFixtures, station } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const AT = 1_700_000_000_000;

interface Harness {
  readonly built: BuiltProgram;
  readonly lines: string[];
  readonly journal: Journal;
  run: (argv: readonly string[]) => void;
}

function harness(files: Record<string, string> = {}): Harness {
  const journal = Journal.open(new MemoryStorage());
  let state: StationState = emptyState(station({ dayStartHour: 5 }));
  for (const input of STANDARD_CATEGORIES) {
    const category = expectOk(makeCategory(input));
    const categories = new Map(state.categories);
    categories.set(category.code, category);
    state = { ...state, categories };
  }
  const lines: string[] = [];
  const built = buildProgram({
    state,
    journal,
    write: (line) => lines.push(line),
    readFile: (path) => {
      const found = files[path];
      if (found === undefined) {
        throw new Error(`no such file ${path}`);
      }
      return found;
    },
    now: () => AT,
  });
  return {
    built,
    lines,
    journal,
    run: (argv) => {
      built.program
        .exitOverride()
        .configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
        .parse([...argv], { from: 'user' });
    },
  };
}

const CART = [
  '--number',
  'M0001',
  '--title',
  'Ferry Road',
  '--billed',
  'The Lint Committee',
  '--runtime',
  '3:12',
  '--category',
  'A',
];

describe('the program', () => {
  it('knows every operation the api has', () => {
    const it0 = harness();
    it0.run(['ops']);
    const ops = it0.lines.map((line) => line.split(' ')[1]);
    expect(ops).toContain('library.add');
    expect(ops).toContain('schedule.day');
    expect(ops).toContain('traffic.merge');
    expect(ops).toContain('report.health');
    expect(ops).toContain('aired.reconcile');
    expect(ops).toContain('royalty.file');
  });

  it('marks which operations write', () => {
    const it0 = harness();
    it0.run(['ops']);
    const add = it0.lines.find((line) => line.includes('library.add'));
    const get = it0.lines.find((line) => line.includes('library.get'));
    expect(add?.startsWith('w')).toBe(true);
    expect(get?.startsWith('r')).toBe(true);
  });

  it('carries a version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('runs a command and prints its answer', () => {
    const it0 = harness();
    it0.run(['library', 'add', ...CART]);
    expect(it0.lines.join('\n')).toContain('M0001');
    expect(it0.built.status()).toBe(0);
  });

  it('keeps the station for the life of the process', () => {
    const it0 = harness();
    it0.run(['library', 'add', ...CART]);
    it0.lines.length = 0;
    it0.run(['library', 'count']);
    expect(it0.lines.join('\n')).toContain('1');
  });

  it('reports a refusal in the exit status', () => {
    const it0 = harness();
    it0.run(['library', 'get', 'M0404']);
    expect(it0.built.status()).toBe(1);
  });

  it('keeps the worst status of a run, not the last', () => {
    const it0 = harness();
    it0.run(['library', 'get', 'M0404']);
    it0.run(['library', 'add', ...CART]);
    expect(it0.built.status()).toBe(1);
  });

  it('stamps every request with the clock it was given', () => {
    const it0 = harness();
    it0.run(['--json', 'library', 'add', ...CART]);
    const parsed = JSON.parse(it0.lines.join('\n')) as { at: number; id: string };
    expect(parsed.at).toBe(AT);
    expect(parsed.id).toBe('cli-1');
  });
});

describe('read only', () => {
  it('refuses a write and leaves the journal alone', () => {
    const it0 = harness();
    it0.run(['--read-only', 'library', 'add', ...CART]);
    expect(it0.built.status()).toBe(1);
    expect(it0.journal.readAll().records).toHaveLength(0);
  });

  it('lets a read through', () => {
    const it0 = harness();
    it0.run(['--read-only', 'library', 'count']);
    expect(it0.built.status()).toBe(0);
  });
});

describe('batch', () => {
  const REQUESTS = JSON.stringify([
    {
      op: 'library.add',
      id: 'b1',
      at: AT,
      params: {
        cart: {
          number: 'M0001',
          title: 'Ferry Road',
          billed: 'The Lint Committee',
          runtime: '3:12',
          category: 'A',
        },
      },
    },
    { op: 'library.count', id: 'b2', at: AT, params: {} },
  ]);

  it('runs every request in one session', () => {
    const it0 = harness({ 'run.json': REQUESTS });
    it0.run(['batch', 'run.json']);
    expect(it0.lines.join('\n')).toContain('M0001');
    expect(it0.lines.join('\n')).toContain('1');
    expect(it0.built.status()).toBe(0);
  });

  it('takes a file that wraps the list in an object', () => {
    const wrapped = JSON.stringify({ requests: JSON.parse(REQUESTS) as unknown[] });
    const it0 = harness({ 'run.json': wrapped });
    it0.run(['batch', 'run.json']);
    expect(it0.built.status()).toBe(0);
  });

  it('keeps going past a refusal by default', () => {
    const bad = JSON.stringify([
      { op: 'library.get', id: 'b1', at: AT, params: { cart: 'M0404' } },
      { op: 'library.count', id: 'b2', at: AT, params: {} },
    ]);
    const it0 = harness({ 'run.json': bad });
    it0.run(['batch', 'run.json']);
    expect(it0.built.status()).toBe(1);
    expect(it0.lines.join('\n')).toContain('carts');
  });

  it('stops at the first refusal when told to, and says how far it got', () => {
    const bad = JSON.stringify([
      { op: 'library.get', id: 'b1', at: AT, params: { cart: 'M0404' } },
      { op: 'library.count', id: 'b2', at: AT, params: {} },
    ]);
    const it0 = harness({ 'run.json': bad });
    it0.run(['batch', 'run.json', '--stop']);
    expect(it0.lines.join('\n')).toContain('stopped after 1 of 2');
  });

  it('says which file it could not read', () => {
    const it0 = harness();
    it0.run(['batch', 'missing.json']);
    expect(it0.lines[0]).toContain('missing.json');
    expect(it0.built.status()).toBe(1);
  });

  it('refuses a file that is not json', () => {
    const it0 = harness({ 'run.json': 'not json at all' });
    it0.run(['batch', 'run.json']);
    expect(it0.lines[0]).toContain('is not json');
  });

  it('refuses json that holds no list of requests', () => {
    const it0 = harness({ 'run.json': '{"hello":true}' });
    it0.run(['batch', 'run.json']);
    expect(it0.lines[0]).toContain('no list of requests');
  });

  it('carries the read only guard into the batch', () => {
    const it0 = harness({ 'run.json': REQUESTS });
    it0.run(['--read-only', 'batch', 'run.json']);
    expect(it0.built.status()).toBe(1);
    expect(it0.journal.readAll().records).toHaveLength(0);
  });
});
