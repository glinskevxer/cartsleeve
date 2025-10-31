import { describe, expect, it } from 'vitest';
import {
  EMPTY_STREAM,
  EVENT_KINDS,
  eventsBetween,
  eventsOfKind,
  makeEvent,
  makeEventStream,
  parseEventKind,
  unterminated,
  withEvent,
} from '../../src/aired/event.js';
import type { AutomationEvent, EventInput } from '../../src/aired/event.js';
import type { CartNumber } from '../../src/util/ids.js';
import { expectErr, expectOk } from '../support/result.js';

const cart = (value: string): CartNumber => value as CartNumber;
const BASE = 1_700_000_000_000;

const event = (over: Partial<EventInput> = {}): AutomationEvent =>
  expectOk(makeEvent({ kind: 'start', cart: 'M0001', at: BASE, ...over }));

describe('parseEventKind', () => {
  it('reads every kind it knows', () => {
    for (const kind of EVENT_KINDS) {
      expect(parseEventKind(kind)).toBe(kind);
    }
  });

  it('ignores case and space', () => {
    expect(parseEventKind(' START ')).toBe('start');
  });

  it('returns undefined for anything else', () => {
    expect(parseEventKind('exploded')).toBeUndefined();
    expect(parseEventKind('')).toBeUndefined();
  });
});

describe('makeEvent', () => {
  it('builds an event', () => {
    const built = event({ note: ' network feed ' });
    expect(built.kind).toBe('start');
    expect(built.cart).toBe('M0001');
    expect(built.at).toBe(BASE);
    expect(built.note).toBe('network feed');
  });

  it('leaves the position off when the automation did not say', () => {
    expect('position' in event()).toBe(false);
    expect(event({ position: 4 }).position).toBe(4);
  });

  it('rejects an unknown kind, a bad cart and a bad timestamp', () => {
    expect(expectErr(makeEvent({ kind: 'nope', cart: 'M0001', at: BASE }))[0]?.code).toBe(
      'AIR-001',
    );
    expect(expectErr(makeEvent({ kind: 'start', cart: 'nope', at: BASE }))[0]?.code).toBe(
      'AIR-002',
    );
    expect(expectErr(makeEvent({ kind: 'start', cart: 'M0001', at: 0 }))[0]?.code).toBe('AIR-003');
    expect(expectErr(makeEvent({ kind: 'start', cart: 'M0001', at: Number.NaN }))[0]?.code).toBe(
      'AIR-003',
    );
  });

  it('reports every problem at once', () => {
    const problems = expectErr(makeEvent({ kind: 'nope', cart: 'nope', at: -1 }));
    expect(problems.map((each) => each.code)).toEqual(['AIR-001', 'AIR-002', 'AIR-003']);
  });
});

describe('makeEventStream', () => {
  it('orders events by time however they arrive', () => {
    const stream = makeEventStream([
      event({ at: BASE + 3000 }),
      event({ at: BASE + 1000 }),
      event({ at: BASE + 2000 }),
    ]);
    expect(stream.events.map((each) => each.at - BASE)).toEqual([1000, 2000, 3000]);
  });

  it('puts a start before an end that shares its timestamp', () => {
    const stream = makeEventStream([
      event({ kind: 'end', at: BASE }),
      event({ kind: 'start', at: BASE }),
    ]);
    expect(stream.events.map((each) => each.kind)).toEqual(['start', 'end']);
  });

  it('groups the events of each cart', () => {
    const stream = makeEventStream([
      event({ cart: 'M0001' }),
      event({ cart: 'M0002', at: BASE + 1000 }),
      event({ kind: 'end', cart: 'M0001', at: BASE + 2000 }),
    ]);
    expect(stream.byCart.get(cart('M0001'))).toHaveLength(2);
    expect(stream.byCart.get(cart('M9999'))).toBeUndefined();
  });

  it('handles an empty stream', () => {
    expect(EMPTY_STREAM.events).toEqual([]);
    expect(makeEventStream([]).byCart.size).toBe(0);
  });

  it('adds an event and keeps the order', () => {
    const stream = withEvent(makeEventStream([event({ at: BASE + 2000 })]), event({ at: BASE }));
    expect(stream.events.map((each) => each.at - BASE)).toEqual([0, 2000]);
  });
});

describe('reading a stream', () => {
  const stream = () =>
    makeEventStream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'end', cart: 'M0001', at: BASE + 2000 }),
      event({ kind: 'skip', cart: 'M0002', at: BASE + 3000 }),
      event({ kind: 'start', cart: 'M0003', at: BASE + 4000 }),
    ]);

  it('filters by kind', () => {
    expect(eventsOfKind(stream(), 'start')).toHaveLength(2);
    expect(eventsOfKind(stream(), 'skip')).toHaveLength(1);
    expect(eventsOfKind(stream(), 'error')).toEqual([]);
  });

  it('filters by time, inclusive on both bounds', () => {
    expect(eventsBetween(stream(), BASE, BASE + 3000)).toHaveLength(3);
    expect(eventsBetween(stream(), BASE + 1, BASE + 2999)).toHaveLength(1);
    expect(eventsBetween(stream(), BASE + 9000, BASE + 9999)).toEqual([]);
  });
});

describe('unterminated', () => {
  it('finds a start with no end after it', () => {
    const stream = makeEventStream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'end', cart: 'M0001', at: BASE + 2000 }),
      event({ kind: 'start', cart: 'M0003', at: BASE + 4000 }),
    ]);
    expect(unterminated(stream).map((each) => each.cart)).toEqual(['M0003']);
  });

  it('finds nothing when every start was closed', () => {
    const stream = makeEventStream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'end', cart: 'M0001', at: BASE + 2000 }),
    ]);
    expect(unterminated(stream)).toEqual([]);
  });

  it('treats a skip as closing the start', () => {
    const stream = makeEventStream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'skip', cart: 'M0001', at: BASE + 500 }),
    ]);
    expect(unterminated(stream)).toEqual([]);
  });

  it('finds the earlier start when the same cart starts twice without ending', () => {
    const stream = makeEventStream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'start', cart: 'M0001', at: BASE + 4000 }),
    ]);
    expect(unterminated(stream).map((each) => each.at - BASE)).toEqual([0, 4000]);
  });

  it('does not care that another cart ended in between', () => {
    const stream = makeEventStream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'start', cart: 'M0002', at: BASE + 1000 }),
      event({ kind: 'end', cart: 'M0002', at: BASE + 2000 }),
    ]);
    expect(unterminated(stream).map((each) => each.cart)).toEqual(['M0001']);
  });

  it('finds nothing in an empty stream', () => {
    expect(unterminated(EMPTY_STREAM)).toEqual([]);
  });
});
