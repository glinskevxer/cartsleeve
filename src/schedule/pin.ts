/**
 * Pins.
 *
 * A director puts a specific cart in a specific slot: a new single at 08:20 on
 * launch day, a request, a record the label is chasing. The scheduler has to
 * honour it, and honouring it is not the same as agreeing with it.
 *
 * A pin bypasses the candidate search entirely, so every guard the search
 * provides has to be applied here or not at all. That is the whole reason the
 * eligibility rule exists as a rule rather than only as a filter: a pinned cart
 * that is retired, or restricted out of that hour, is a licensing problem, and
 * the filter it would normally have gone through was never consulted.
 *
 * A pin that breaches a taste rule is honoured and reported. A pin that breaks a
 * tier zero rule is refused, because those are not preferences.
 */

import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { error, warning } from '../util/problem.js';
import type { CartNumber } from '../util/ids.js';
import type { BroadcastDay } from '../util/time.js';
import { evaluate } from '../rules/rule.js';
import type { RuleContext, RuleSet } from '../rules/rule.js';
import { HARD_TIER } from '../rules/tiers.js';
import type { LibraryEntry } from '../library/library.js';
import { lookup } from '../library/library.js';
import type { Library } from '../library/library.js';

export const PIN_MISSING = codeFor('schedule', 40);
export const PIN_REFUSED = codeFor('schedule', 41);
export const PIN_BREACHES = codeFor('schedule', 42);

export interface Pin {
  readonly day: BroadcastDay;
  /** Which hour of the broadcast day, indexed from the day start. */
  readonly hourIndex: number;
  /** Which element of that hour's clock. */
  readonly position: number;
  readonly cart: CartNumber;
  readonly note: string;
}

export interface PinMap {
  readonly byKey: ReadonlyMap<string, Pin>;
}

export function pinKey(day: BroadcastDay, hourIndex: number, position: number): string {
  return `${day.year}-${day.month}-${day.day}:${hourIndex}:${position}`;
}

export function makePinMap(pins: readonly Pin[]): PinMap {
  return { byKey: new Map(pins.map((pin) => [pinKey(pin.day, pin.hourIndex, pin.position), pin])) };
}

export const NO_PINS: PinMap = { byKey: new Map<string, Pin>() };

export function pinAt(
  map: PinMap,
  day: BroadcastDay,
  hourIndex: number,
  position: number,
): Pin | undefined {
  return map.byKey.get(pinKey(day, hourIndex, position));
}

export type PinOutcome =
  | { readonly honoured: true; readonly entry: LibraryEntry; readonly problems: readonly Problem[] }
  | { readonly honoured: false; readonly problems: readonly Problem[] };

/**
 * Decide a pin. Refused only when a rule the relaxation ladder can never drop
 * objects, or when the cart is not in the library at all.
 */
export function resolvePin(
  pin: Pin,
  library: Library,
  rules: RuleSet,
  contextFor: (entry: LibraryEntry) => RuleContext,
): PinOutcome {
  const found = lookup(library, pin.cart);
  if (found === undefined) {
    return {
      honoured: false,
      problems: [error(PIN_MISSING, `pin ${pin.cart}`, 'names a cart the library does not have')],
    };
  }
  const context = contextFor(found);
  const hard = evaluate(rules, HARD_TIER, context);
  if (!hard.passed) {
    return {
      honoured: false,
      problems: hard.failures.map((failure) =>
        error(PIN_REFUSED, `pin ${pin.cart}`, `cannot be honoured: ${failure.message}`, {
          rule: failure.rule,
          note: pin.note,
        }),
      ),
    };
  }
  const full = evaluate(rules, Number.MAX_SAFE_INTEGER, context);
  if (full.passed) {
    return { honoured: true, entry: found, problems: [] };
  }
  return {
    honoured: true,
    entry: found,
    problems: full.failures.map((failure) =>
      warning(PIN_BREACHES, `pin ${pin.cart}`, `was honoured but ${failure.message}`, {
        rule: failure.rule,
        tier: failure.tier,
        note: pin.note,
      }),
    ),
  };
}

export function withPin(map: PinMap, pin: Pin): PinMap {
  const byKey = new Map(map.byKey);
  byKey.set(pinKey(pin.day, pin.hourIndex, pin.position), pin);
  return { byKey };
}

export function withoutPin(
  map: PinMap,
  day: BroadcastDay,
  hourIndex: number,
  position: number,
): PinMap {
  const byKey = new Map(map.byKey);
  byKey.delete(pinKey(day, hourIndex, position));
  return { byKey };
}

/** Every pin on a given day, in hour and position order. */
export function pinsOn(map: PinMap, day: BroadcastDay): Pin[] {
  const prefix = `${day.year}-${day.month}-${day.day}:`;
  return [...map.byKey.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, pin]) => pin)
    .sort((a, b) => a.hourIndex - b.hourIndex || a.position - b.position);
}
