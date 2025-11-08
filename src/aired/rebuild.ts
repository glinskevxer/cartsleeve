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

export function rebuildAired(stream: EventStream): Rebuild {
  const airings: Airing[] = [];
  const skipped: AutomationEvent[] = [];
  const problems: Problem[] = [];
  const open = new Map<CartNumber, AutomationEvent>();

  for (const event of stream.events) {
    if (event.kind === 'skip') {
      skipped.push(event);
      problems.push(info(SKIPPED, event.cart, 'was loaded and never played', { note: event.note }));
      open.delete(event.cart);
      continue;
    }
    if (event.kind === 'start' || event.kind === 'joined') {
      const already = open.get(event.cart);
      if (already !== undefined) {
        airings.push(openAiring(already));
        problems.push(
          warning(UNTERMINATED, already.cart, 'started again before it reported an end', {
            at: already.at,
          }),
        );
      }
      open.set(event.cart, event);
      continue;
    }
    if (event.kind === 'end') {
      const started = open.get(event.cart);
      if (started === undefined) {
        airings.push({
          cart: event.cart,
          startedAt: event.at,
          endedAt: event.at,
          length: 0,
          orphan: true,
          note: event.note,
          ...(event.position === undefined ? {} : { position: event.position }),
        });
        problems.push(
          warning(ORPHAN_END, event.cart, 'reported an end with no start before it', {
            at: event.at,
          }),
        );
        continue;
      }
      open.delete(event.cart);
      const length = event.at - started.at;
      if (length > MAX_PLAUSIBLE_MS) {
        problems.push(
          warning(IMPLAUSIBLE_LENGTH, event.cart, 'aired for longer than any cart could', {
            minutes: Math.round(length / 60_000),
          }),
        );
      }
      airings.push({
        cart: started.cart,
        startedAt: started.at,
        endedAt: event.at,
        length,
        orphan: false,
        note: started.note.length > 0 ? started.note : event.note,
        ...(started.position === undefined ? {} : { position: started.position }),
      });
    }
  }

  for (const started of open.values()) {
    airings.push(openAiring(started));
    problems.push(
      warning(UNTERMINATED, started.cart, 'started and never reported an end', { at: started.at }),
    );
  }

  return {
    airings: airings.sort((a, b) => ascending(a.startedAt, b.startedAt)),
    skipped,
    problems,
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
