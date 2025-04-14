/**
 * Rest.
 *
 * How long a cart has been off the air. Rotation is nothing more than playing
 * the best rested eligible cart, so this is the number the whole scheduler is
 * built on and the number every argument about the log comes back to.
 *
 * Rest is measured two ways and they disagree, deliberately. Rest in hours is
 * wall clock and answers "when did the listener last hear this". Rest in plays
 * answers "how far through the category has it come round", and a cart in a
 * category that is asked for twice an hour rests far fewer hours per play than
 * one in a category asked for twice a day. A rotation that orders on one and
 * reports on the other looks broken and is not.
 *
 * This module holds the wall clock half.
 */

import type { CartNumber } from '../util/ids.js';
import { HOUR_MS } from '../util/time.js';

export interface Play {
  readonly cart: CartNumber;
  /** When it started, as an instant. */
  readonly at: number;
  /** Which cell of the week it landed in, for the horizontal balance rules. */
  readonly cell: number;
}

export interface PlayHistory {
  readonly plays: readonly Play[];
  readonly lastByCart: ReadonlyMap<CartNumber, number>;
  readonly countByCart: ReadonlyMap<CartNumber, number>;
}

export function makePlayHistory(plays: readonly Play[]): PlayHistory {
  const lastByCart = new Map<CartNumber, number>();
  const countByCart = new Map<CartNumber, number>();
  for (const play of plays) {
    const previous = lastByCart.get(play.cart);
    if (previous === undefined || play.at > previous) {
      lastByCart.set(play.cart, play.at);
    }
    countByCart.set(play.cart, (countByCart.get(play.cart) ?? 0) + 1);
  }
  return { plays, lastByCart, countByCart };
}

export const NO_PLAYS: PlayHistory = {
  plays: [],
  lastByCart: new Map<CartNumber, number>(),
  countByCart: new Map<CartNumber, number>(),
};

export function lastPlayed(history: PlayHistory, cart: CartNumber): number | undefined {
  return history.lastByCart.get(cart);
}

export function playCount(history: PlayHistory, cart: CartNumber): number {
  return history.countByCart.get(cart) ?? 0;
}

/**
 * Hours since the cart last played. A cart that has never played rests
 * infinitely, which puts it at the front of every rotation. That is correct: a
 * new record should go first, and a record nobody has ever aired is either new
 * or a mistake, and both want a director's attention.
 */
export function restHours(history: PlayHistory, cart: CartNumber, now: number): number {
  const last = history.lastByCart.get(cart);
  if (last === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return (now - last) / HOUR_MS;
}

export function restMillis(history: PlayHistory, cart: CartNumber, now: number): number {
  const last = history.lastByCart.get(cart);
  return last === undefined ? Number.POSITIVE_INFINITY : now - last;
}

/** Has the cart never aired at all. */
export function isUnplayed(history: PlayHistory, cart: CartNumber): boolean {
  return !history.lastByCart.has(cart);
}

/**
 * Plays inside a window ending now, which is what the separation rules read.
 * Kept in play order so the caller can look at the nearest one first.
 */
export function playsWithin(
  history: PlayHistory,
  cart: CartNumber,
  now: number,
  windowMillis: number,
): Play[] {
  const floor = now - windowMillis;
  return history.plays.filter((play) => play.cart === cart && play.at > floor && play.at <= now);
}

/** Every play in the window, whatever the cart. The rules walk this. */
export function allPlaysWithin(history: PlayHistory, now: number, windowMillis: number): Play[] {
  const floor = now - windowMillis;
  return history.plays.filter((play) => play.at > floor && play.at <= now);
}

export function withPlay(history: PlayHistory, play: Play): PlayHistory {
  return makePlayHistory([...history.plays, play]);
}

export function withPlays(history: PlayHistory, plays: readonly Play[]): PlayHistory {
  return makePlayHistory([...history.plays, ...plays]);
}

/** Drop everything older than the floor, so a long run does not grow forever. */
export function prune(history: PlayHistory, before: number): PlayHistory {
  return makePlayHistory(history.plays.filter((play) => play.at >= before));
}
