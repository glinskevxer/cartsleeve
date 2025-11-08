import { describe, expect, it } from 'vitest';
import {
  IMPLAUSIBLE_LENGTH,
  MAX_PLAUSIBLE_MS,
  ORPHAN_END,
  SKIPPED,
  UNTERMINATED,
  airingsOf,
  measured,
  rebuildAired,
  totalAired,
  unmeasured,
} from '../../src/aired/rebuild.js';
import { makeEvent, makeEventStream } from '../../src/aired/event.js';
import type { AutomationEvent, EventInput } from '../../src/aired/event.js';
import type { CartNumber } from '../../src/util/ids.js';
import { expectOk } from '../support/result.js';

const cart = (value: string): CartNumber => value as CartNumber;
const BASE = 1_700_000_000_000;

const event = (over: Partial<EventInput> = {}): AutomationEvent =>
  expectOk(makeEvent({ kind: 'start', cart: 'M0001', at: BASE, ...over }));

const stream = (events: readonly AutomationEvent[]) => rebuildAired(makeEventStream(events));

describe('a clean pairing', () => {
  it('turns a start and an end into one airing', () => {
    const rebuilt = stream([
      event({ kind: 'start', at: BASE }),
      event({ kind: 'end', at: BASE + 180_000 }),
    ]);
    expect(rebuilt.airings).toHaveLength(1);
    expect(rebuilt.airings[0]?.cart).toBe('M0001');
    expect(rebuilt.airings[0]?.length).toBe(180_000);
    expect(rebuilt.airings[0]?.orphan).toBe(false);
    expect(rebuilt.problems).toEqual([]);
  });

  it('keeps the position when the automation knew it', () => {
    const rebuilt = stream([
      event({ kind: 'start', at: BASE, position: 4 }),
      event({ kind: 'end', at: BASE + 1000 }),
    ]);
    expect(rebuilt.airings[0]?.position).toBe(4);
  });

  it('takes the note from the start, falling back to the end', () => {
    const fromStart = stream([
      event({ kind: 'start', at: BASE, note: 'from start' }),
      event({ kind: 'end', at: BASE + 1000, note: 'from end' }),
    ]);
    expect(fromStart.airings[0]?.note).toBe('from start');
    const fromEnd = stream([
      event({ kind: 'start', at: BASE }),
      event({ kind: 'end', at: BASE + 1000, note: 'from end' }),
    ]);
    expect(fromEnd.airings[0]?.note).toBe('from end');
  });

  it('rebuilds several airings in order', () => {
    const rebuilt = stream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'end', cart: 'M0001', at: BASE + 1000 }),
      event({ kind: 'start', cart: 'M0002', at: BASE + 2000 }),
      event({ kind: 'end', cart: 'M0002', at: BASE + 3000 }),
    ]);
    expect(rebuilt.airings.map((each) => each.cart)).toEqual(['M0001', 'M0002']);
  });

  it('handles two carts overlapping on air, which a segue does', () => {
    const rebuilt = stream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'start', cart: 'M0002', at: BASE + 1000 }),
      event({ kind: 'end', cart: 'M0001', at: BASE + 1500 }),
      event({ kind: 'end', cart: 'M0002', at: BASE + 3000 }),
    ]);
    expect(rebuilt.airings).toHaveLength(2);
    expect(rebuilt.problems).toEqual([]);
  });

  it('rebuilds nothing from nothing', () => {
    const rebuilt = stream([]);
    expect(rebuilt.airings).toEqual([]);
    expect(rebuilt.problems).toEqual([]);
  });
});

describe('a start with no end', () => {
  it('keeps the airing with its length absent rather than guessed', () => {
    const rebuilt = stream([event({ kind: 'start', at: BASE })]);
    expect(rebuilt.airings).toHaveLength(1);
    expect(rebuilt.airings[0]?.length).toBeUndefined();
    expect(rebuilt.airings[0]?.endedAt).toBeUndefined();
  });

  it('warns about it', () => {
    expect(stream([event({ kind: 'start', at: BASE })]).problems[0]?.code).toBe(UNTERMINATED);
  });

  it('closes the first airing when the same cart starts again', () => {
    const rebuilt = stream([
      event({ kind: 'start', at: BASE }),
      event({ kind: 'start', at: BASE + 4000 }),
      event({ kind: 'end', at: BASE + 5000 }),
    ]);
    expect(rebuilt.airings).toHaveLength(2);
    expect(rebuilt.airings[0]?.length).toBeUndefined();
    expect(rebuilt.airings[1]?.length).toBe(1000);
  });

  it('separates the measured airings from the unmeasured', () => {
    const rebuilt = stream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'end', cart: 'M0001', at: BASE + 1000 }),
      event({ kind: 'start', cart: 'M0002', at: BASE + 2000 }),
    ]);
    expect(measured(rebuilt)).toHaveLength(1);
    expect(unmeasured(rebuilt)).toHaveLength(1);
    expect(totalAired(rebuilt)).toBe(1000);
  });
});

describe('an end with no start', () => {
  it('keeps it rather than losing the spin', () => {
    const rebuilt = stream([event({ kind: 'end', at: BASE })]);
    expect(rebuilt.airings).toHaveLength(1);
    expect(rebuilt.airings[0]?.orphan).toBe(true);
    expect(rebuilt.airings[0]?.length).toBe(0);
  });

  it('warns about it', () => {
    expect(stream([event({ kind: 'end', at: BASE })]).problems[0]?.code).toBe(ORPHAN_END);
  });
});

describe('a skip', () => {
  it('is not an airing, because nothing was broadcast', () => {
    const rebuilt = stream([event({ kind: 'skip', at: BASE })]);
    expect(rebuilt.airings).toEqual([]);
    expect(rebuilt.skipped).toHaveLength(1);
    expect(rebuilt.problems[0]?.code).toBe(SKIPPED);
  });

  it('closes an open start without producing an airing', () => {
    const rebuilt = stream([
      event({ kind: 'start', at: BASE }),
      event({ kind: 'skip', at: BASE + 500 }),
    ]);
    expect(rebuilt.airings).toEqual([]);
    expect(rebuilt.problems.map((each) => each.code)).toEqual([SKIPPED]);
  });
});

describe('an implausible pairing', () => {
  it('is kept but reported', () => {
    const rebuilt = stream([
      event({ kind: 'start', at: BASE }),
      event({ kind: 'end', at: BASE + MAX_PLAUSIBLE_MS + 1000 }),
    ]);
    expect(rebuilt.airings).toHaveLength(1);
    expect(rebuilt.problems[0]?.code).toBe(IMPLAUSIBLE_LENGTH);
  });

  it('says nothing about a long but possible cart', () => {
    const rebuilt = stream([
      event({ kind: 'start', at: BASE }),
      event({ kind: 'end', at: BASE + MAX_PLAUSIBLE_MS }),
    ]);
    expect(rebuilt.problems).toEqual([]);
  });
});

describe('reading the rebuild', () => {
  it('finds every airing of one cart', () => {
    const rebuilt = stream([
      event({ kind: 'start', cart: 'M0001', at: BASE }),
      event({ kind: 'end', cart: 'M0001', at: BASE + 1000 }),
      event({ kind: 'start', cart: 'M0002', at: BASE + 2000 }),
      event({ kind: 'end', cart: 'M0002', at: BASE + 3000 }),
      event({ kind: 'start', cart: 'M0001', at: BASE + 4000 }),
      event({ kind: 'end', cart: 'M0001', at: BASE + 5000 }),
    ]);
    expect(airingsOf(rebuilt, cart('M0001'))).toHaveLength(2);
    expect(airingsOf(rebuilt, cart('M9999'))).toEqual([]);
  });

  it('counts a joined event as a start', () => {
    const rebuilt = stream([
      event({ kind: 'joined', at: BASE }),
      event({ kind: 'end', at: BASE + 1000 }),
    ]);
    expect(rebuilt.airings).toHaveLength(1);
    expect(rebuilt.airings[0]?.length).toBe(1000);
  });

  it('totals nothing when nothing was measured', () => {
    expect(totalAired(stream([event({ kind: 'start', at: BASE })]))).toBe(0);
  });
});
