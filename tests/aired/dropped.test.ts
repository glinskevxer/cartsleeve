import { describe, expect, it } from 'vitest';
import {
  DROPPED,
  actionable,
  byReason,
  findDrops,
  severityOf,
  toProblem,
} from '../../src/aired/dropped.js';
import type { Drop } from '../../src/aired/dropped.js';
import { makeEvent, makeEventStream } from '../../src/aired/event.js';
import type { AutomationEvent, EventInput } from '../../src/aired/event.js';
import { rebuildAired } from '../../src/aired/rebuild.js';
import type { CartNumber } from '../../src/util/ids.js';
import { expectOk } from '../support/result.js';

const cart = (value: string): CartNumber => value as CartNumber;
const BASE = 1_700_000_000_000;

const event = (over: Partial<EventInput> = {}): AutomationEvent =>
  expectOk(makeEvent({ kind: 'start', cart: 'M0001', at: BASE, ...over }));

const SCHEDULED = [
  { position: 0, cart: cart('M0001') },
  { position: 1, cart: cart('M0002') },
  { position: 2, cart: cart('M0003') },
];

function drops(events: readonly AutomationEvent[]): Drop[] {
  const stream = makeEventStream(events);
  return findDrops({ scheduled: SCHEDULED, stream, rebuild: rebuildAired(stream) });
}

describe('findDrops', () => {
  it('finds nothing when everything aired', () => {
    const events = SCHEDULED.flatMap((item, index) => [
      event({ kind: 'start', cart: item.cart, at: BASE + index * 2000 }),
      event({ kind: 'end', cart: item.cart, at: BASE + index * 2000 + 1000 }),
    ]);
    expect(drops(events)).toEqual([]);
  });

  it('calls a skipped cart a deliberate skip', () => {
    const found = drops([event({ kind: 'skip', cart: 'M0002', at: BASE, note: 'made the news' })]);
    const dropped = found.find((each) => each.cart === 'M0002');
    expect(dropped?.reason).toBe('skipped by operator');
    expect(dropped?.evidence).toBe('made the news');
  });

  it('falls back to naming the event when the operator left no note', () => {
    const found = drops([event({ kind: 'skip', cart: 'M0002', at: BASE })]);
    expect(found.find((each) => each.cart === 'M0002')?.evidence).toBe('a skip event');
  });

  it('calls a cart with an error event an automation error', () => {
    const found = drops([event({ kind: 'error', cart: 'M0002', at: BASE, note: 'file missing' })]);
    const dropped = found.find((each) => each.cart === 'M0002');
    expect(dropped?.reason).toBe('automation error');
    expect(dropped?.evidence).toBe('file missing');
  });

  it('prefers a skip over an error when both are present', () => {
    const found = drops([
      event({ kind: 'error', cart: 'M0002', at: BASE }),
      event({ kind: 'skip', cart: 'M0002', at: BASE + 1000 }),
    ]);
    expect(found.find((each) => each.cart === 'M0002')?.reason).toBe('skipped by operator');
  });

  it('calls a cart with no event at all never reached', () => {
    const found = drops([]);
    expect(found).toHaveLength(3);
    expect(found.every((each) => each.reason === 'never reached')).toBe(true);
    expect(found[0]?.evidence).toBe('no event at all');
  });

  it('calls a cart with events but no airing unknown', () => {
    const found = drops([event({ kind: 'joined', cart: 'M0002', at: BASE })]);
    const dropped = found.find((each) => each.cart === 'M0002');
    expect(dropped).toBeUndefined();
  });

  it('keeps the scheduled position on every drop', () => {
    expect(drops([]).map((each) => each.position)).toEqual([0, 1, 2]);
  });

  it('finds nothing when nothing was scheduled', () => {
    const stream = makeEventStream([]);
    expect(findDrops({ scheduled: [], stream, rebuild: rebuildAired(stream) })).toEqual([]);
  });
});

describe('severity', () => {
  it('treats a deliberate skip as information only', () => {
    expect(severityOf('skipped by operator')).toBe('info');
  });

  it('treats an automation error as an error', () => {
    expect(severityOf('automation error')).toBe('error');
  });

  it('treats the rest as warnings', () => {
    expect(severityOf('never reached')).toBe('warning');
    expect(severityOf('unknown')).toBe('warning');
  });

  it('raises a problem at the matching severity', () => {
    const found = drops([event({ kind: 'skip', cart: 'M0002', at: BASE })]);
    const skip = found.find((each) => each.cart === 'M0002') as Drop;
    expect(toProblem(skip).severity).toBe('info');
    expect(toProblem({ ...skip, reason: 'automation error' }).severity).toBe('error');
    expect(toProblem({ ...skip, reason: 'never reached' }).severity).toBe('warning');
  });

  it('says the cart, the slot and the reason on the problem', () => {
    const found = drops([]);
    const problem = toProblem(found[0] as Drop);
    expect(problem.code).toBe(DROPPED);
    expect(problem.subject).toBe('slot 0');
    expect(problem.detail?.['cart']).toBe('M0001');
    expect(problem.detail?.['reason']).toBe('never reached');
  });
});

describe('grouping the drops', () => {
  it('groups by reason', () => {
    const found = drops([
      event({ kind: 'skip', cart: 'M0002', at: BASE }),
      event({ kind: 'error', cart: 'M0003', at: BASE + 1000 }),
    ]);
    const grouped = byReason(found);
    expect(grouped.get('skipped by operator')).toHaveLength(1);
    expect(grouped.get('automation error')).toHaveLength(1);
    expect(grouped.get('never reached')).toHaveLength(1);
  });

  it('leaves the deliberate skips out of what is actionable', () => {
    const found = drops([
      event({ kind: 'skip', cart: 'M0001', at: BASE }),
      event({ kind: 'skip', cart: 'M0002', at: BASE + 1000 }),
      event({ kind: 'error', cart: 'M0003', at: BASE + 2000 }),
    ]);
    expect(actionable(found).map((each) => each.cart)).toEqual(['M0003']);
  });

  it('groups nothing from nothing', () => {
    expect(byReason([]).size).toBe(0);
    expect(actionable([])).toEqual([]);
  });
});
