/**
 * Rotation health.
 *
 * The report that answers the complaint a listener actually makes, which is
 * never "your artist separation is inadequate" and is always "you keep playing
 * that record at the same time every morning".
 *
 * Three things go wrong here and not one of them is a rule breach, so the
 * breach report cannot show any of them. A cart can be stuck in one daypart, so
 * one audience hears it four times and three hear it never. It can be clumped on
 * one hour of the day. And a category's cycle length can lock every cart in it
 * to a fixed hour, which is not a property of any cart at all and cannot be
 * found by looking at them one at a time.
 *
 * The three compose. A cart stuck and clumped at once is not two
 * problems on one cart, it is the arithmetic case: its category cycles in step
 * with the day, so the same slot comes round to it every day, and the daypart
 * follows from the hour. Those are listed on their own because the remedy is
 * different. Spreading a stuck cart by hand fixes it for a week. Changing the
 * cycle length fixes every cart in the category for good.
 */

import { renderFrame } from './frame.js';
import type { Column } from '../util/table.js';
import { percent } from '../util/table.js';
import { compareText } from '../util/ordering.js';
import type { CartNumber, CategoryCode } from '../util/ids.js';
import type { Daypart } from '../domain/daypart.js';
import type { Play } from '../rotation/rest.js';
import type { Balance } from '../rotation/balance.js';
import { concentration, meanImbalance } from '../rotation/balance.js';
import { spreadsFor as daypartSpreads, stuck } from '../rotation/horizontal.js';
import type { DaypartBalance } from '../rotation/horizontal.js';
import {
  spreadsFor as hourSpreads,
  clumped,
  locksToHour,
  repeatDays,
} from '../rotation/vertical.js';

const STUCK_COLUMNS: readonly Column[] = [
  { heading: 'cart', align: 'left' },
  { heading: 'plays', align: 'right' },
  { heading: 'spread', align: 'right' },
  { heading: 'never heard in', align: 'left', width: 34 },
];

const CLUMPED_COLUMNS: readonly Column[] = [
  { heading: 'cart', align: 'left' },
  { heading: 'plays', align: 'right' },
  { heading: 'hour', align: 'right' },
  { heading: 'in that hour', align: 'right' },
];

const CYCLE_COLUMNS: readonly Column[] = [
  { heading: 'cat', align: 'left' },
  { heading: 'cycle', align: 'right' },
  { heading: 'returns', align: 'left', width: 26 },
];

const BOTH_COLUMNS: readonly Column[] = [
  { heading: 'cart', align: 'left' },
  { heading: 'hour', align: 'right' },
  { heading: 'reading', align: 'left', width: 40 },
];

/** Above this share of its plays in one part of the week a cart is stuck. */
export const STUCK_THRESHOLD = 0.6;

/** Above this share of its plays in one hour of the day a cart is clumped. */
export const CLUMP_THRESHOLD = 0.5;

/** Rows past this are cut from a section, worst first. */
export const SECTION_LIMIT = 20;

export interface CycleLength {
  readonly category: CategoryCode;
  readonly hours: number;
}

export interface HealthInput {
  readonly plays: readonly Play[];
  readonly dayparts: readonly Daypart[];
  readonly carts: readonly CartNumber[];
  readonly cycles: readonly CycleLength[];
  readonly station: string;
  readonly period: string;
}

export interface Health {
  readonly stuck: readonly DaypartBalance[];
  readonly clumped: readonly Balance[];
  readonly locking: readonly CycleLength[];
  /** Carts stuck in a daypart and clumped on an hour at the same time. */
  readonly both: readonly CartNumber[];
  readonly daypartSpread: number;
}

function worstFirst<T extends Balance>(balances: readonly T[], score: (item: T) => number): T[] {
  return [...balances].sort((a, b) => score(b) - score(a) || compareText(a.cart, b.cart));
}

/** Read the health of a rotation without printing anything. */
export function measureHealth(input: HealthInput): Health {
  const byDaypart = daypartSpreads(input.plays, input.dayparts, input.carts);
  const byHour = hourSpreads(input.plays, input.carts);
  const stuckRows = worstFirst(stuck(byDaypart, STUCK_THRESHOLD), (row) => row.imbalance);
  const clumpedRows = worstFirst(clumped(byHour, CLUMP_THRESHOLD), concentration);
  const clumpedCarts = new Set(clumpedRows.map((row) => row.cart));
  return {
    stuck: stuckRows,
    clumped: clumpedRows,
    locking: input.cycles.filter((cycle) => locksToHour(cycle.hours)),
    both: stuckRows.map((row) => row.cart).filter((cart) => clumpedCarts.has(cart)),
    daypartSpread: meanImbalance(byDaypart),
  };
}

export function describeReturn(cycleHours: number): string {
  const days = repeatDays(cycleHours);
  if (!Number.isFinite(days)) {
    return 'never to the same hour';
  }
  return days === 1 ? 'same hour every day' : `same hour every ${days} days`;
}

function carts(count: number): string {
  return count === 1 ? '1 cart' : `${count} carts`;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function readingFor(health: Health): string {
  return health.locking.length > 0
    ? 'cycle locks the hour, daypart follows'
    : 'fixed hour and one audience';
}

export function renderHealth(input: HealthInput): string[] {
  const health = measureHealth(input);
  const clumpedByCart = new Map(health.clumped.map((row) => [row.cart, row]));

  return renderFrame({
    title: 'ROTATION HEALTH',
    heading: [
      ['station', input.station],
      ['period', input.period],
      ['carts', String(input.carts.length)],
      ['plays', String(input.plays.length)],
    ],
    summary: [
      ['daypart spread', percent(health.daypartSpread, 1)],
      ['stuck', String(health.stuck.length)],
      ['clumped', String(health.clumped.length)],
      ['both at once', String(health.both.length)],
      ['locking cycles', String(health.locking.length)],
    ],
    sections: [
      {
        title: 'STUCK IN ONE DAYPART',
        columns: STUCK_COLUMNS,
        rows: health.stuck
          .slice(0, SECTION_LIMIT)
          .map((row) => [
            row.cart,
            String(row.plays),
            percent(row.imbalance, 1),
            row.unheardNames.filter((name) => name.length > 0).join(' '),
          ]),
      },
      {
        title: 'CLUMPED ON ONE HOUR',
        columns: CLUMPED_COLUMNS,
        rows: health.clumped
          .slice(0, SECTION_LIMIT)
          .map((row) => [
            row.cart,
            String(row.plays),
            hourLabel(row.heaviest),
            percent(row.heaviestCount, row.plays),
          ]),
      },
      {
        title: 'BOTH AT ONCE',
        columns: BOTH_COLUMNS,
        rows: health.both
          .slice(0, SECTION_LIMIT)
          .map((cart) => [
            cart,
            hourLabel(clumpedByCart.get(cart)?.heaviest ?? 0),
            readingFor(health),
          ]),
      },
      {
        title: 'CATEGORY CYCLES',
        columns: CYCLE_COLUMNS,
        rows: input.cycles.map((cycle) => [
          cycle.category,
          `${cycle.hours}h`,
          describeReturn(cycle.hours),
        ]),
      },
    ],
  });
}

/** Whether the rotation can be left alone this week. */
export function isHealthy(input: HealthInput): boolean {
  const health = measureHealth(input);
  return health.stuck.length === 0 && health.clumped.length === 0 && health.locking.length === 0;
}

/**
 * What to do first. A locking cycle outranks any number of stuck carts, because
 * hand spreading a cart whose category returns to the same hour every day undoes
 * itself by the end of the week.
 */
export function firstRemedy(input: HealthInput): string {
  const health = measureHealth(input);
  if (health.locking.length > 0) {
    const codes = health.locking.map((cycle) => cycle.category).join(' ');
    return `change the cycle length for ${codes}`;
  }
  if (health.both.length > 0) {
    return `spread ${carts(health.both.length)} stuck and clumped at once`;
  }
  if (health.clumped.length > 0) {
    return `spread ${carts(health.clumped.length)} clumped on one hour across the day`;
  }
  if (health.stuck.length > 0) {
    return `spread ${carts(health.stuck.length)} stuck in one daypart across the week`;
  }
  return 'nothing, the rotation is healthy';
}
