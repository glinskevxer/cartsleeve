/**
 * Era coding.
 *
 * A gold station lives or dies on era balance. Four records from the same five
 * years in a row is a themed set nobody asked for, and the era spread rule
 * exists to stop it, but the rule can only measure what the bands say.
 *
 * The bands are per station rather than fixed decades. A classic hits station
 * splits 1975 to 1989 into three, and a country station treats the whole of it
 * as one, because to its audience it is all the same era. Fixed decades would
 * make both of those wrong.
 */

import { ascending } from '../util/ordering.js';
import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { Check } from '../util/check.js';
import type { Result } from '../util/result.js';

export interface EraBand {
  readonly name: string;
  /** Inclusive. */
  readonly fromYear: number;
  /** Inclusive. */
  readonly toYear: number;
}

export interface EraMap {
  readonly bands: readonly EraBand[];
}

export interface EraBandInput {
  readonly name: string;
  readonly fromYear: number;
  readonly toYear: number;
}

const ERA = (n: number): string => codeFor('library', n);

export function makeEraMap(inputs: readonly EraBandInput[]): Result<EraMap, Problem[]> {
  const check = new Check();
  check.ensure(inputs.length > 0, ERA(70), 'era map', 'has no bands');
  const bands: EraBand[] = [];
  const names = new Set<string>();
  for (const input of inputs) {
    const name = input.name.trim();
    if (!check.ensure(name.length > 0, ERA(71), input.name, 'is a band with no name')) {
      continue;
    }
    if (!check.ensure(!names.has(name), ERA(72), name, 'is a band name used twice')) {
      continue;
    }
    const ordered = check.ensure(input.fromYear <= input.toYear, ERA(73), name, 'runs backwards', {
      from: input.fromYear,
      to: input.toYear,
    });
    if (!ordered) {
      continue;
    }
    names.add(name);
    bands.push({ name, fromYear: input.fromYear, toYear: input.toYear });
  }
  const sorted = [...bands].sort((a, b) => ascending(a.fromYear, b.fromYear));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    check.ensure(
      current.fromYear > previous.toYear,
      ERA(74),
      current.name,
      'overlaps the band before it',
      { previous: previous.name, at: current.fromYear },
    );
  }
  return check.result(() => ({ bands: sorted }));
}

export function bandFor(map: EraMap, year: number): EraBand | undefined {
  return map.bands.find((band) => year >= band.fromYear && year <= band.toYear);
}

export function eraOf(map: EraMap, year: number): string {
  return bandFor(map, year)?.name ?? 'unbanded';
}

/** Years no band claims. A gold library with a hole here schedules oddly. */
export function gaps(map: EraMap, fromYear: number, toYear: number): number[] {
  const out: number[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    if (bandFor(map, year) === undefined) {
      out.push(year);
    }
  }
  return out;
}

export function bandWidth(band: EraBand): number {
  return band.toYear - band.fromYear + 1;
}

/**
 * How many distinct eras a run of years touches. The spread rule reads this
 * over a rolling window, so four records from one band score one and the same
 * four spread across the decades score four.
 */
export function eraSpread(map: EraMap, years: readonly number[]): number {
  return new Set(years.map((year) => eraOf(map, year))).size;
}

export function describeBand(band: EraBand): string {
  return `${band.name} ${band.fromYear} to ${band.toYear}`;
}

export const CLASSIC_HITS_BANDS: readonly EraBandInput[] = [
  { name: 'early', fromYear: 1964, toYear: 1971 },
  { name: 'peak', fromYear: 1972, toYear: 1979 },
  { name: 'late', fromYear: 1980, toYear: 1986 },
  { name: 'tail', fromYear: 1987, toYear: 1994 },
];

export const COUNTRY_BANDS: readonly EraBandInput[] = [
  { name: 'traditional', fromYear: 1955, toYear: 1974 },
  { name: 'outlaw', fromYear: 1975, toYear: 1989 },
  { name: 'new country', fromYear: 1990, toYear: 2004 },
  { name: 'modern', fromYear: 2005, toYear: 2029 },
];
