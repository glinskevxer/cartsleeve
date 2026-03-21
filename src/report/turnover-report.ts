/**
 * The turnover report.
 *
 * What a programme director opens first. One line per category saying how long
 * it takes to come round, how big it is on paper, how big it really is once the
 * restrictions are off, and how far apart the fastest and slowest carts in it
 * are.
 *
 * That last column is the one worth having and the one no scheduling system
 * prints. The category turnover is an average, and an average over a category
 * where half the carts are restricted out of daytime says nothing useful: the
 * unrestricted half is playing twice as often as the figure claims and the
 * restricted half half as often. The spread is what shows it.
 */

import { renderFrame } from './frame.js';
import type { Section } from './frame.js';
import type { Column } from '../util/table.js';
import { percent } from '../util/table.js';
import type { CartNumber, CategoryCode } from '../util/ids.js';
import type { DemandProfile } from '../rotation/turnover.js';
import { nominalTurnover, playsPerWeek } from '../rotation/turnover.js';
import type { RestrictionMap } from '../library/restriction.js';
import { effectiveTurnover, exposureSpread, unreachable } from '../rotation/effective.js';

const COLUMNS: readonly Column[] = [
  { heading: 'cat', align: 'left' },
  { heading: 'size', align: 'right' },
  { heading: 'slots', align: 'right' },
  { heading: 'days', align: 'right' },
  { heading: 'plays', align: 'right' },
  { heading: 'spread', align: 'right' },
];

const UNREACHABLE_COLUMNS: readonly Column[] = [
  { heading: 'cat', align: 'left' },
  { heading: 'cart', align: 'left' },
];

export interface CategoryRow {
  readonly category: CategoryCode;
  readonly size: number;
  readonly slotsPerWeek: number;
  readonly days: number;
  readonly playsPerWeek: number;
  /** Slowest over fastest, so one means every cart plays the same. */
  readonly spread: number;
  readonly unreachable: readonly CartNumber[];
}

export interface TurnoverInput {
  readonly profile: DemandProfile;
  readonly restrictions: RestrictionMap;
  readonly categories: readonly { code: CategoryCode; carts: readonly CartNumber[] }[];
}

export function turnoverRows(input: TurnoverInput): CategoryRow[] {
  return input.categories.map((category) => {
    const size = category.carts.length;
    const nominal = nominalTurnover(input.profile, category.code, size);
    const effective = effectiveTurnover({
      profile: input.profile,
      restrictions: input.restrictions,
      category: category.code,
      carts: category.carts,
    });
    const spread = exposureSpread({
      profile: input.profile,
      restrictions: input.restrictions,
      category: category.code,
      carts: category.carts,
    });
    const ratio =
      Number.isFinite(spread.fastest) && spread.fastest > 0 && Number.isFinite(spread.slowest)
        ? spread.slowest / spread.fastest
        : 1;
    return {
      category: category.code,
      size,
      slotsPerWeek: nominal.slotsPerWeek,
      days: effective.days,
      playsPerWeek: playsPerWeek(input.profile, category.code, size),
      spread: ratio,
      unreachable: unreachable({
        profile: input.profile,
        restrictions: input.restrictions,
        category: category.code,
        carts: category.carts,
      }),
    };
  });
}

function days(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : 'never';
}

function plays(value: number): string {
  return value === 0 ? '0' : value.toFixed(1);
}

export function renderTurnover(rows: readonly CategoryRow[], station: string): string[] {
  const unreachableRows = rows.flatMap((row) =>
    row.unreachable.map((cart) => [row.category, cart]),
  );
  const sections: Section[] = [
    {
      title: 'CATEGORIES',
      columns: COLUMNS,
      rows: rows.map((row) => [
        row.category,
        String(row.size),
        String(row.slotsPerWeek),
        days(row.days),
        plays(row.playsPerWeek),
        row.spread > 1.05 ? `${row.spread.toFixed(1)}x` : 'even',
      ]),
    },
    { title: 'UNREACHABLE', columns: UNREACHABLE_COLUMNS, rows: unreachableRows },
  ];
  const rotating = rows.filter((row) => row.size > 0);
  return renderFrame({
    title: 'TURNOVER',
    heading: [
      ['station', station],
      ['categories', String(rows.length)],
    ],
    summary: [
      ['carts', String(rows.reduce((sum, row) => sum + row.size, 0))],
      [
        'uneven',
        percent(rotating.filter((row) => row.spread > 1.05).length, Math.max(1, rotating.length)),
      ],
      ['unreachable', String(unreachableRows.length)],
    ],
    sections,
  });
}

/** Categories whose spread is wide enough that the average is misleading. */
export function misleading(rows: readonly CategoryRow[], threshold = 1.5): CategoryRow[] {
  return rows.filter((row) => row.spread >= threshold);
}
