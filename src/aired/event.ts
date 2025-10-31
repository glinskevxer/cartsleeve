/**
 * Automation events.
 *
 * What the playout system says happened. Every other record in this system is a
 * plan; this is the only one that is evidence, and it is the only thing a rights
 * society will accept as the basis for a performance report.
 *
 * It is also messy in ways a plan never is. Events arrive out of order because
 * the automation buffers them. Clocks drift, so a start time can be a second
 * before the event that preceded it. A song can start and never report an end
 * because the machine was restarted. And a jock firing something manually
 * produces an event with no scheduled slot behind it at all.
 *
 * So the reader is permissive about shape and strict about meaning: anything it
 * cannot interpret is reported rather than dropped, because a missing event is a
 * missing spin and a missing spin is a royalty underpayment.
 */

import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { Check, take } from '../util/check.js';
import type { Result } from '../util/result.js';
import { parseCartNumber } from '../util/ids.js';
import type { CartNumber } from '../util/ids.js';
import { ascending } from '../util/ordering.js';

const EVT = (n: number): string => codeFor('aired', n);

export const EVENT_KINDS = ['start', 'end', 'skip', 'error', 'joined'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface AutomationEvent {
  readonly kind: EventKind;
  readonly cart: CartNumber;
  /** Milliseconds since the epoch, as the automation reported it. */
  readonly at: number;
  /** Whatever the automation said about why, free text and often empty. */
  readonly note: string;
  /** Present when the automation knows which scheduled slot this was. */
  readonly position?: number;
}

export interface EventInput {
  readonly kind: string;
  readonly cart: string;
  readonly at: number;
  readonly note?: string;
  readonly position?: number;
}

export function parseEventKind(raw: string): EventKind | undefined {
  const trimmed = raw.trim().toLowerCase();
  return (EVENT_KINDS as readonly string[]).includes(trimmed) ? (trimmed as EventKind) : undefined;
}

export function makeEvent(input: EventInput): Result<AutomationEvent, Problem[]> {
  const check = new Check();
  const kind = parseEventKind(input.kind);
  check.ensure(kind !== undefined, EVT(1), input.cart, 'has an event kind nothing understands', {
    given: input.kind,
  });
  const cart = check.require(
    parseCartNumber(input.cart),
    EVT(2),
    input.cart,
    (problem) => problem.reason,
  );
  check.ensure(
    Number.isFinite(input.at) && input.at > 0,
    EVT(3),
    input.cart,
    'has no usable timestamp',
    { given: input.at },
  );
  return check.result(() => ({
    kind: take(kind, 'kind'),
    cart: take(cart, 'cart'),
    at: input.at,
    note: (input.note ?? '').trim(),
    ...(input.position === undefined ? {} : { position: input.position }),
  }));
}

export interface EventStream {
  readonly events: readonly AutomationEvent[];
  readonly byCart: ReadonlyMap<CartNumber, readonly AutomationEvent[]>;
}

/**
 * Order the events by time, then by kind so a start always precedes the end that
 * shares its timestamp. Automation clocks have one second resolution, so a very
 * short cart really can report both in the same tick.
 */
const KIND_ORDER: Record<EventKind, number> = {
  start: 0,
  joined: 1,
  skip: 2,
  error: 3,
  end: 4,
};

export function makeEventStream(events: readonly AutomationEvent[]): EventStream {
  const ordered = [...events].sort(
    (a, b) => ascending(a.at, b.at) || ascending(KIND_ORDER[a.kind], KIND_ORDER[b.kind]),
  );
  const byCart = new Map<CartNumber, AutomationEvent[]>();
  for (const event of ordered) {
    const bucket = byCart.get(event.cart);
    if (bucket === undefined) {
      byCart.set(event.cart, [event]);
    } else {
      bucket.push(event);
    }
  }
  return { events: ordered, byCart };
}

export const EMPTY_STREAM: EventStream = {
  events: [],
  byCart: new Map<CartNumber, readonly AutomationEvent[]>(),
};

export function eventsOfKind(stream: EventStream, kind: EventKind): AutomationEvent[] {
  return stream.events.filter((event) => event.kind === kind);
}

export function eventsBetween(stream: EventStream, from: number, to: number): AutomationEvent[] {
  return stream.events.filter((event) => event.at >= from && event.at <= to);
}

/** Starts with no matching end, which is what a restart mid song looks like. */
export function unterminated(stream: EventStream): AutomationEvent[] {
  const out: AutomationEvent[] = [];
  for (const events of stream.byCart.values()) {
    let open: AutomationEvent | undefined;
    for (const event of events) {
      if (event.kind === 'start') {
        if (open !== undefined) {
          out.push(open);
        }
        open = event;
        continue;
      }
      if (event.kind === 'end' || event.kind === 'skip') {
        open = undefined;
      }
    }
    if (open !== undefined) {
      out.push(open);
    }
  }
  return out.sort((a, b) => ascending(a.at, b.at));
}

export function withEvent(stream: EventStream, event: AutomationEvent): EventStream {
  return makeEventStream([...stream.events, event]);
}
