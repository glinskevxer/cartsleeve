/**
 * Rebuilding the as aired log from automation events.
 *
 * A start and its matching end become one airing. That is the whole idea, and
 * everything hard about it is what to do when the two do not pair up cleanly.
 *
 * A start with no end means the automation stopped reporting: a restart, a
 * network drop, or the log simply ending mid record. The airing is real and its
 * length is not known, so it is kept with the length marked absent rather than
 * guessed at from the cart's runtime. Guessing would put a number in the royalty
 * report that nothing observed.
 *
 * An end with no start is the same event from the other side, and it is kept for
 * the opposite reason: something aired, and dropping it would lose a spin.
 *
 * A skip is not an airing at all. The automation loaded the cart and moved on
 * without playing it, which happens when the operator sees a break coming and
 * dumps the record. Nothing was broadcast, so nothing is owed.
 */

import { codeFor, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { ascending } from '../util/ordering.js';
import type { CartNumber } from '../util/ids.js';
import type { AutomationEvent, EventStream } from './event.js';

const REB = (n: number): string => codeFor('aired', n);

export const UNTERMINATED = REB(10);
export const ORPHAN_END = REB(11);
export const SKIPPED = REB(12);
export const IMPLAUSIBLE_LENGTH = REB(13);

export interface Airing {
  readonly cart: CartNumber;
  readonly startedAt: number;
  /** Absent when the automation never reported an end. */
  readonly endedAt?: number;
  /** Milliseconds on air, absent for the same reason. */
  readonly length?: number;
  /** The scheduled slot, when the automation knew it. */
  readonly position?: number;
  /** True when nothing started it, so only the end was seen. */
  readonly orphan: boolean;
  readonly note: string;
}

export interface Rebuild {
  readonly airings: readonly Airing[];
  readonly skipped: readonly AutomationEvent[];
  readonly problems: readonly Problem[];
}

/** Longer than this and the pairing is almost certainly wrong. */
export const MAX_PLAUSIBLE_MS = 30 * 60 * 1000;

/**
 * What the reader knows part way through a stream.
 *
 * Pulling this out of the loop is not cosmetic. The old version carried three
 * mutable locals and decided what to do with a switch, and the branch that
 * closed an open start appeared twice with slightly different handling. A state
 * plus one handler per kind makes the second copy impossible, and makes it
 * obvious that only three of the five kinds touch what is open.
 */
export interface RebuildState {
  readonly airings: readonly Airing[];
  readonly skipped: readonly AutomationEvent[];
  readonly problems: readonly Problem[];
  /** Starts waiting for an end, by cart. */
  readonly open: ReadonlyMap<CartNumber, AutomationEvent>;
}

export const EMPTY_REBUILD_STATE: RebuildState = {
  airings: [],
  skipped: [],
  problems: [],
  open: new Map<CartNumber, AutomationEvent>(),
};

function withoutOpen(state: RebuildState, cart: CartNumber): Map<CartNumber, AutomationEvent> {
  const open = new Map(state.open);
  open.delete(cart);
  return open;
}

function onSkip(state: RebuildState, event: AutomationEvent): RebuildState {
  return {
    airings: state.airings,
    skipped: [...state.skipped, event],
    problems: [
      ...state.problems,
      info(SKIPPED, event.cart, 'was loaded and never played', { note: event.note }),
    ],
    open: withoutOpen(state, event.cart),
  };
}

function onStart(state: RebuildState, event: AutomationEvent): RebuildState {
  const already = state.open.get(event.cart);
  const open = new Map(state.open);
  open.set(event.cart, event);
  if (already === undefined) {
    return { ...state, open };
  }
  return {
    airings: [...state.airings, openAiring(already)],
    skipped: state.skipped,
    problems: [
      ...state.problems,
      warning(UNTERMINATED, already.cart, 'started again before it reported an end', {
        at: already.at,
      }),
    ],
    open,
  };
}

function onEnd(state: RebuildState, event: AutomationEvent): RebuildState {
  const started = state.open.get(event.cart);
  if (started === undefined) {
    return {
      airings: [
        ...state.airings,
        {
          cart: event.cart,
          startedAt: event.at,
          endedAt: event.at,
          length: 0,
          orphan: true,
          note: event.note,
          ...(event.position === undefined ? {} : { position: event.position }),
        },
      ],
      skipped: state.skipped,
      problems: [
        ...state.problems,
        warning(ORPHAN_END, event.cart, 'reported an end with no start before it', {
          at: event.at,
        }),
      ],
      open: state.open,
    };
  }
  const length = event.at - started.at;
  const problems =
    length > MAX_PLAUSIBLE_MS
      ? [
          ...state.problems,
          warning(IMPLAUSIBLE_LENGTH, event.cart, 'aired for longer than any cart could', {
            minutes: Math.round(length / 60_000),
          }),
        ]
      : state.problems;
  return {
    airings: [
      ...state.airings,
      {
        cart: started.cart,
        startedAt: started.at,
        endedAt: event.at,
        length,
        orphan: false,
        note: started.note.length > 0 ? started.note : event.note,
        ...(started.position === undefined ? {} : { position: started.position }),
      },
    ],
    skipped: state.skipped,
    problems,
    open: withoutOpen(state, event.cart),
  };
}

/** Apply one event. Only start, joined, skip and end change anything. */
export function applyEvent(state: RebuildState, event: AutomationEvent): RebuildState {
  switch (event.kind) {
    case 'skip':
      return onSkip(state, event);
    case 'start':
    case 'joined':
      return onStart(state, event);
    case 'end':
      return onEnd(state, event);
    case 'error':
      return state;
  }
}

/** Close whatever is still open once the stream runs out. */
export function closeState(state: RebuildState): RebuildState {
  let closed = state;
  for (const started of state.open.values()) {
    closed = {
      airings: [...closed.airings, openAiring(started)],
      skipped: closed.skipped,
      problems: [
        ...closed.problems,
        warning(UNTERMINATED, started.cart, 'started and never reported an end', {
          at: started.at,
        }),
      ],
      open: new Map<CartNumber, AutomationEvent>(),
    };
  }
  return closed;
}

export function rebuildAired(stream: EventStream): Rebuild {
  let state = EMPTY_REBUILD_STATE;
  for (const event of stream.events) {
    state = applyEvent(state, event);
  }
  const closed = closeState(state);
  return {
    airings: [...closed.airings].sort((a, b) => ascending(a.startedAt, b.startedAt)),
    skipped: closed.skipped,
    problems: closed.problems,
  };
}

function openAiring(started: AutomationEvent): Airing {
  return {
    cart: started.cart,
    startedAt: started.at,
    orphan: false,
    note: started.note,
    ...(started.position === undefined ? {} : { position: started.position }),
  };
}

/** Airings whose length the automation actually observed. */
export function measured(rebuild: Rebuild): Airing[] {
  return rebuild.airings.filter((airing) => airing.length !== undefined);
}

export function unmeasured(rebuild: Rebuild): Airing[] {
  return rebuild.airings.filter((airing) => airing.length === undefined);
}

/** Total time on air, counting only what was measured. */
export function totalAired(rebuild: Rebuild): number {
  return measured(rebuild).reduce((sum, airing) => sum + (airing.length ?? 0), 0);
}

export function airingsOf(rebuild: Rebuild, cart: CartNumber): Airing[] {
  return rebuild.airings.filter((airing) => airing.cart === cart);
}
