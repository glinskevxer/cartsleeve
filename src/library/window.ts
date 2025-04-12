/**
 * Activation and retirement.
 *
 * A cart is not always playable. A current is embargoed until the label's
 * release date, a promo dies the day the contest ends, and a Christmas record
 * lives inside a window that comes back every year.
 *
 * The recurring case is the awkward one. A seasonal window is written as a month
 * and day rather than a date, it may wrap the end of the year, and asking
 * whether a cart is live has to be answered against the broadcast day rather
 * than against an instant, or a record goes dead at midnight in the middle of an
 * overnight shift that is still filed under the day before.
 */

import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { Check } from '../util/check.js';
import type { Result } from '../util/result.js';
import { daysFromCivil, daysInMonth } from '../util/time.js';
import type { BroadcastDay } from '../util/time.js';
import type { CartNumber } from '../util/ids.js';

export interface DateWindow {
  /** Absent means it has always been live. */
  readonly from?: BroadcastDay;
  /** Absent means it is live until somebody retires it. Inclusive. */
  readonly to?: BroadcastDay;
}

export interface SeasonWindow {
  readonly fromMonth: number;
  readonly fromDay: number;
  readonly toMonth: number;
  readonly toDay: number;
}

export interface CartWindow {
  readonly cart: CartNumber;
  readonly dates?: DateWindow;
  readonly season?: SeasonWindow;
}

const WIN = (n: number): string => codeFor('library', n);

function ordinalOf(day: BroadcastDay): number {
  return daysFromCivil(day.year, day.month, day.day);
}

/** Month and day as one comparable number, so 12 25 sorts after 12 01. */
function seasonKey(month: number, day: number): number {
  return month * 100 + day;
}

export function makeWindow(
  cart: CartNumber,
  dates: DateWindow | undefined,
  season: SeasonWindow | undefined,
): Result<CartWindow, Problem[]> {
  const check = new Check();
  if (dates?.from !== undefined && dates.to !== undefined) {
    check.ensure(
      ordinalOf(dates.from) <= ordinalOf(dates.to),
      WIN(110),
      cart,
      'is retired before it is activated',
    );
  }
  if (season !== undefined) {
    for (const [month, day, side] of [
      [season.fromMonth, season.fromDay, 'start'],
      [season.toMonth, season.toDay, 'end'],
    ] as const) {
      const monthOk = check.ensure(
        Number.isInteger(month) && month >= 1 && month <= 12,
        WIN(111),
        cart,
        `has a season ${side} in no month`,
        { month },
      );
      if (monthOk) {
        check.ensure(
          Number.isInteger(day) && day >= 1 && day <= daysInMonth(2024, month),
          WIN(112),
          cart,
          `has a season ${side} on no such day`,
          { month, day },
        );
      }
    }
  }
  return check.result(() => ({
    cart,
    ...(dates === undefined ? {} : { dates }),
    ...(season === undefined ? {} : { season }),
  }));
}

export function withinDates(window: DateWindow, day: BroadcastDay): boolean {
  const at = ordinalOf(day);
  if (window.from !== undefined && at < ordinalOf(window.from)) {
    return false;
  }
  if (window.to !== undefined && at > ordinalOf(window.to)) {
    return false;
  }
  return true;
}

/**
 * Whether the day falls inside the season. A season whose end sorts before its
 * start wraps the new year, so December to January is one window and not two.
 */
export function withinSeason(season: SeasonWindow, day: BroadcastDay): boolean {
  const at = seasonKey(day.month, day.day);
  const from = seasonKey(season.fromMonth, season.fromDay);
  const to = seasonKey(season.toMonth, season.toDay);
  return from <= to ? at >= from && at <= to : at >= from || at <= to;
}

export function isLive(window: CartWindow, day: BroadcastDay): boolean {
  if (window.dates !== undefined && !withinDates(window.dates, day)) {
    return false;
  }
  if (window.season !== undefined && !withinSeason(window.season, day)) {
    return false;
  }
  return true;
}

export interface WindowMap {
  readonly byCart: ReadonlyMap<CartNumber, CartWindow>;
}

export function makeWindowMap(windows: readonly CartWindow[]): WindowMap {
  return { byCart: new Map(windows.map((window) => [window.cart, window])) };
}

export const NO_WINDOWS: WindowMap = { byCart: new Map<CartNumber, CartWindow>() };

/** A cart with no window is always live, which is the common case. */
export function liveOn(map: WindowMap, cart: CartNumber, day: BroadcastDay): boolean {
  const window = map.byCart.get(cart);
  return window === undefined || isLive(window, day);
}

export function liveCarts(
  map: WindowMap,
  carts: readonly CartNumber[],
  day: BroadcastDay,
): CartNumber[] {
  return carts.filter((cart) => liveOn(map, cart, day));
}

export const CHRISTMAS: SeasonWindow = { fromMonth: 12, fromDay: 1, toMonth: 12, toDay: 26 };
export const HOLIDAYS: SeasonWindow = { fromMonth: 12, fromDay: 20, toMonth: 1, toDay: 2 };
