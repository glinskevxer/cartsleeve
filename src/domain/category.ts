/**
 * Rotation categories.
 *
 * A category is a bucket of carts that rotate together under one set of
 * separation minimums. The letter carries meaning everyone in the building
 * agrees on: A is the heaviest current rotation, B and C are lighter currents,
 * R is recurrent, G is gold, and X is anything that does not rotate at all.
 *
 * The separation minimums live here rather than on the station because a gold
 * cut and a power current do not need the same distance. A station wide default
 * exists, and a category that does not set its own inherits it.
 */

import { parseCategoryCode } from '../util/ids.js';
import type { CategoryCode } from '../util/ids.js';
import { fromMinutes } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { Result } from '../util/result.js';
import { Check, take } from '../util/check.js';

export interface Separation {
  /** Minimum time between two carts by the same artist. */
  readonly artist: Tenths;
  /** Minimum time between two plays of the same title, cover or not. */
  readonly title: Tenths;
  /** Minimum time between two plays of the same recording. */
  readonly recording: Tenths;
  /** Minimum time between two carts sharing a sound code. */
  readonly sound: Tenths;
}

export interface Category {
  readonly code: CategoryCode;
  readonly name: string;
  /** How many groups the category is split into for rotation. */
  readonly packets: number;
  /** Carts in this category are music and count toward rotation figures. */
  readonly music: boolean;
  readonly separation: Separation;
  /** Lower runs first when two categories compete for the same slot. */
  readonly priority: number;
}

export interface CategoryInput {
  readonly code: string;
  readonly name: string;
  readonly packets?: number;
  readonly music?: boolean;
  readonly artistMinutes?: number;
  readonly titleMinutes?: number;
  readonly recordingMinutes?: number;
  readonly soundMinutes?: number;
  readonly priority?: number;
}

export const DEFAULT_SEPARATION: Separation = {
  artist: fromMinutes(60),
  title: fromMinutes(150),
  recording: fromMinutes(150),
  sound: fromMinutes(20),
};

const CAT = (n: number): string => codeFor('library', n);

export function makeCategory(input: CategoryInput): Result<Category, Problem[]> {
  const check = new Check();
  const code = check.require(
    parseCategoryCode(input.code),
    CAT(10),
    input.code,
    (problem) => problem.reason,
  );
  const name = input.name.trim();
  check.ensure(name.length > 0, CAT(11), input.code, 'has no name');
  const packets = input.packets ?? 1;
  check.ensure(
    Number.isInteger(packets) && packets >= 1,
    CAT(12),
    input.code,
    'has a packet count below one',
    { given: packets },
  );
  const given: Record<keyof Separation, number | undefined> = {
    artist: input.artistMinutes,
    title: input.titleMinutes,
    recording: input.recordingMinutes,
    sound: input.soundMinutes,
  };
  const separation: Record<string, Tenths> = {};
  for (const field of Object.keys(given) as (keyof Separation)[]) {
    const minutes = given[field];
    if (minutes === undefined) {
      separation[field] = DEFAULT_SEPARATION[field];
      continue;
    }
    check.ensure(minutes >= 0, CAT(13), input.code, `has a negative ${field} separation`, {
      given: minutes,
    });
    separation[field] = fromMinutes(minutes);
  }
  return check.result(() => ({
    code: take(code, 'code'),
    name,
    packets,
    music: input.music ?? true,
    separation: {
      artist: take(separation['artist'], 'artist'),
      title: take(separation['title'], 'title'),
      recording: take(separation['recording'], 'recording'),
      sound: take(separation['sound'], 'sound'),
    },
    priority: input.priority ?? 50,
  }));
}

/** The categories a music station is built on, before anyone customises them. */
export const STANDARD_CATEGORIES: readonly CategoryInput[] = [
  { code: 'A', name: 'Power current', packets: 2, artistMinutes: 75, priority: 10 },
  { code: 'B', name: 'Secondary current', packets: 2, artistMinutes: 70, priority: 20 },
  { code: 'C', name: 'Light current', artistMinutes: 65, priority: 30 },
  { code: 'R', name: 'Recurrent', packets: 3, artistMinutes: 60, priority: 40 },
  { code: 'G', name: 'Gold', packets: 4, artistMinutes: 45, priority: 50 },
  { code: 'X', name: 'Non rotating', music: false, priority: 90 },
];

export function isRotating(category: Category): boolean {
  return category.music && category.code !== 'X';
}

export function describeCategory(category: Category): string {
  const packets = category.packets === 1 ? 'one packet' : `${category.packets} packets`;
  return `${category.code} ${category.name} (${packets})`;
}
