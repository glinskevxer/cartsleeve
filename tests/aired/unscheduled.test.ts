import { beforeEach, describe, expect, it } from 'vitest';
import {
  NOT_IN_LIBRARY,
  UNSCHEDULED,
  byKind,
  findUnscheduled,
  payable,
  toProblem,
} from '../../src/aired/unscheduled.js';
import { makeEvent, makeEventStream } from '../../src/aired/event.js';
import type { AutomationEvent, EventInput } from '../../src/aired/event.js';
import { rebuildAired } from '../../src/aired/rebuild.js';
import type { CartNumber } from '../../src/util/ids.js';
import { resetFixtures } from '../support/fixtures.js';
import { libraryOf } from '../support/hour.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const BASE = 1_700_000_000_000;

const event = (over: Partial<EventInput> = {}): AutomationEvent =>
  expectOk(makeEvent({ kind: 'start', cart: 'M0001', at: BASE, ...over }));

const LIBRARY = () =>
  libraryOf([
    { number: 'M0001', category: 'A' },
    { number: 'M0002', category: 'A' },
    { number: 'M0003', category: 'A' },
    { number: 'J0009', billed: '', category: 'X', runtime: '0:10' },
  ]);

/** One airing of each cart named. */
function aired(carts: readonly string[]) {
  const events = carts.flatMap((number, index) => [
    event({ kind: 'start', cart: number, at: BASE + index * 4000 }),
    event({ kind: 'end', cart: number, at: BASE + index * 4000 + 2000 }),
  ]);
  return rebuildAired(makeEventStream(events));
}

const SCHEDULED = [
  { position: 0, cart: cart('M0001') },
  { position: 1, cart: cart('M0002') },
];

describe('findUnscheduled', () => {
  it('finds nothing when everything that aired was scheduled', () => {
    const found = findUnscheduled({
      scheduled: SCHEDULED,
      rebuild: aired(['M0001', 'M0002']),
      library: LIBRARY(),
    });
    expect(found).toEqual([]);
  });

  it('finds a manual fire of a cart nobody scheduled', () => {
    const found = findUnscheduled({
      scheduled: SCHEDULED,
      rebuild: aired(['M0001', 'M0003']),
      library: LIBRARY(),
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.airing.cart).toBe('M0003');
    expect(found[0]?.kind).toBe('manual fire');
    expect(found[0]?.payable).toBe(true);
  });

  it('finds the second airing of a cart scheduled once', () => {
    const found = findUnscheduled({
      scheduled: SCHEDULED,
      rebuild: aired(['M0001', 'M0001']),
      library: LIBRARY(),
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.airing.cart).toBe('M0001');
  });

  it('allows both airings when the cart was scheduled twice', () => {
    const twice = [...SCHEDULED, { position: 2, cart: cart('M0001') }];
    const found = findUnscheduled({
      scheduled: twice,
      rebuild: aired(['M0001', 'M0001']),
      library: LIBRARY(),
    });
    expect(found).toEqual([]);
  });

  it('calls a cart the library does not have unknown, and still pays on music', () => {
    const found = findUnscheduled({
      scheduled: SCHEDULED,
      rebuild: aired(['M9999']),
      library: LIBRARY(),
    });
    expect(found[0]?.kind).toBe('unknown cart');
    expect(found[0]?.payable).toBe(true);
  });

  it('does not pay on an unknown cart that is not music', () => {
    const found = findUnscheduled({
      scheduled: SCHEDULED,
      rebuild: aired(['C9999']),
      library: LIBRARY(),
    });
    expect(found[0]?.kind).toBe('unknown cart');
    expect(found[0]?.payable).toBe(false);
  });

  it('does not pay on a known cart that is not music', () => {
    const found = findUnscheduled({
      scheduled: SCHEDULED,
      rebuild: aired(['J0009']),
      library: LIBRARY(),
    });
    expect(found[0]?.kind).toBe('not music');
    expect(found[0]?.payable).toBe(false);
  });

  it('finds everything unscheduled when nothing was scheduled', () => {
    const found = findUnscheduled({
      scheduled: [],
      rebuild: aired(['M0001', 'M0002']),
      library: LIBRARY(),
    });
    expect(found).toHaveLength(2);
  });

  it('finds nothing when nothing aired', () => {
    const found = findUnscheduled({
      scheduled: SCHEDULED,
      rebuild: aired([]),
      library: LIBRARY(),
    });
    expect(found).toEqual([]);
  });
});

describe('reporting an unscheduled airing', () => {
  const found = () =>
    findUnscheduled({
      scheduled: SCHEDULED,
      rebuild: aired(['M0003', 'J0009', 'M9999']),
      library: LIBRARY(),
    });

  it('warns about a manual fire that is owed for', () => {
    const problem = toProblem(found()[0] as never);
    expect(problem.code).toBe(UNSCHEDULED);
    expect(problem.severity).toBe('warning');
    expect(problem.detail?.['payable']).toBe('yes');
  });

  it('notes a non music fire at info, because nothing is owed', () => {
    const problem = toProblem(found()[1] as never);
    expect(problem.severity).toBe('info');
    expect(problem.detail?.['payable']).toBe('no');
  });

  it('warns separately about a cart nothing knows', () => {
    const problem = toProblem(found()[2] as never);
    expect(problem.code).toBe(NOT_IN_LIBRARY);
    expect(problem.message).toContain('not in the library');
  });

  it('separates what royalty owes on from what it does not', () => {
    expect(payable(found()).map((each) => each.airing.cart)).toEqual(['M0003', 'M9999']);
  });

  it('groups by kind', () => {
    const grouped = byKind(found());
    expect(grouped.get('manual fire')).toHaveLength(1);
    expect(grouped.get('not music')).toHaveLength(1);
    expect(grouped.get('unknown cart')).toHaveLength(1);
  });

  it('groups nothing from nothing', () => {
    expect(byKind([]).size).toBe(0);
    expect(payable([])).toEqual([]);
  });
});
