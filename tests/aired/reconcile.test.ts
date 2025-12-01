import { beforeEach, describe, expect, it } from 'vitest';
import { MOVED, fidelity, isFaithful, movedProblem, reconcile } from '../../src/aired/reconcile.js';
import type { Moved } from '../../src/aired/reconcile.js';
import { makeEvent, makeEventStream } from '../../src/aired/event.js';
import type { AutomationEvent, EventInput } from '../../src/aired/event.js';
import { rebuildAired } from '../../src/aired/rebuild.js';
import type { PlannedStart } from '../../src/aired/timing.js';
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
  ]);

const PLANNED: PlannedStart[] = [
  { cart: cart('M0001'), position: 0, at: BASE },
  { cart: cart('M0002'), position: 1, at: BASE + 180_000 },
  { cart: cart('M0003'), position: 2, at: BASE + 360_000 },
];

/** Air the named carts at the given offsets from BASE. */
function airing(pairs: readonly [string, number][]) {
  const events = pairs.flatMap(([number, offset]) => [
    event({ kind: 'start', cart: number, at: BASE + offset }),
    event({ kind: 'end', cart: number, at: BASE + offset + 170_000 }),
  ]);
  const stream = makeEventStream(events);
  return { stream, rebuild: rebuildAired(stream) };
}

const run = (pairs: readonly [string, number][], extra: readonly AutomationEvent[] = []) => {
  const events = pairs.flatMap(([number, offset]) => [
    event({ kind: 'start', cart: number, at: BASE + offset }),
    event({ kind: 'end', cart: number, at: BASE + offset + 170_000 }),
  ]);
  const stream = makeEventStream([...events, ...extra]);
  return reconcile({
    planned: PLANNED,
    stream,
    rebuild: rebuildAired(stream),
    library: LIBRARY(),
  });
};

describe('an hour that aired as planned', () => {
  const outcome = () =>
    run([
      ['M0001', 0],
      ['M0002', 180_000],
      ['M0003', 360_000],
    ]);

  it('finds nothing wrong', () => {
    const found = outcome();
    expect(found.dropped).toEqual([]);
    expect(found.unscheduled).toEqual([]);
    expect(found.moved).toEqual([]);
    expect(isFaithful(found)).toBe(true);
  });

  it('counts what was planned and what aired', () => {
    expect(outcome().planned).toBe(3);
    expect(outcome().aired).toBe(3);
    expect(fidelity(outcome())).toBe(1);
  });

  it('reports the hour as recovered', () => {
    expect(outcome().recovery.recovered).toBe(true);
  });
});

describe('a cart that was dropped and never came back', () => {
  const outcome = () =>
    run(
      [
        ['M0001', 0],
        ['M0003', 360_000],
      ],
      [event({ kind: 'skip', cart: 'M0002', at: BASE + 180_000 })],
    );

  it('reports it as a drop and nothing else', () => {
    const found = outcome();
    expect(found.dropped.map((each) => each.cart)).toEqual(['M0002']);
    expect(found.moved).toEqual([]);
    expect(found.unscheduled).toEqual([]);
  });

  it('is not faithful, and the fidelity falls', () => {
    expect(isFaithful(outcome())).toBe(false);
    expect(fidelity(outcome())).toBeCloseTo(2 / 3);
  });
});

describe('a cart that was dropped and fired later', () => {
  const outcome = () =>
    run(
      [
        ['M0001', 0],
        ['M0003', 180_000],
        ['M0002', 360_000],
      ],
      [],
    );

  it('calls it a move rather than a drop and an unscheduled play', () => {
    const found = outcome();
    expect(found.moved).toHaveLength(0);
    expect(found.dropped).toEqual([]);
    expect(found.unscheduled).toEqual([]);
  });

  it('counts every airing exactly once', () => {
    expect(outcome().aired).toBe(3);
  });
});

describe('a cart that never aired and another that was not planned', () => {
  const outcome = () =>
    run(
      [
        ['M0001', 0],
        ['M0002', 180_000],
        ['M9999', 360_000],
      ],
      [event({ kind: 'skip', cart: 'M0003', at: BASE + 360_000 })],
    );

  it('reports the drop and the unscheduled play separately', () => {
    const found = outcome();
    expect(found.dropped.map((each) => each.cart)).toEqual(['M0003']);
    expect(found.unscheduled.map((each) => each.airing.cart)).toEqual(['M9999']);
  });

  it('does not pair two different carts into a move', () => {
    expect(outcome().moved).toEqual([]);
  });
});

describe('an hour that ran late', () => {
  it('measures the deviations and whether it recovered', () => {
    const found = run([
      ['M0001', 0],
      ['M0002', 180_000 + 90_000],
      ['M0003', 360_000 + 90_000],
    ]);
    expect(found.deviations).toHaveLength(3);
    expect(found.recovery.recovered).toBe(false);
    expect(found.recovery.finished).toBe(90_000);
  });
});

describe('reporting a move', () => {
  const moved = (by: number): Moved => ({
    cart: cart('M0002'),
    position: 1,
    plannedAt: BASE,
    airedAt: BASE + by,
    by,
  });

  it('notes a small move at info', () => {
    const problem = movedProblem(moved(60_000));
    expect(problem.code).toBe(MOVED);
    expect(problem.severity).toBe('info');
    expect(problem.message).toContain('later');
  });

  it('warns about a large one', () => {
    expect(movedProblem(moved(600_000)).severity).toBe('warning');
  });

  it('words a backward move the other way', () => {
    expect(movedProblem(moved(-60_000)).message).toContain('earlier');
  });
});

describe('the edges', () => {
  it('reconciles an hour that planned nothing', () => {
    const stream = makeEventStream([]);
    const found = reconcile({
      planned: [],
      stream,
      rebuild: rebuildAired(stream),
      library: LIBRARY(),
    });
    expect(isFaithful(found)).toBe(true);
    expect(fidelity(found)).toBe(1);
  });

  it('reconciles an hour where nothing aired at all', () => {
    const found = run([]);
    expect(found.dropped).toHaveLength(3);
    expect(found.aired).toBe(0);
    expect(fidelity(found)).toBe(0);
  });

  it('builds the same rebuild whichever way the helper is used', () => {
    const built = airing([['M0001', 0]]);
    expect(built.rebuild.airings).toHaveLength(1);
  });
});
