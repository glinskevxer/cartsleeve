/**
 * Validating a whole library.
 *
 * Per cart checks already live on the cart and the recording. What this adds is
 * everything that can only be seen across the library: a master carded twice, a
 * category too small to rotate, an artist so heavily represented that the
 * separation rule cannot be satisfied, a sound code nobody has placed.
 *
 * The last of those is the one that matters most and is easiest to miss. If a
 * category holds forty carts and eleven of them are by one artist, an hour
 * asking for four of that category cannot always keep them seventy five minutes
 * apart, and the scheduler will report breaches every day until somebody looks
 * at the library rather than at the log.
 */

import { countBy } from '../util/ordering.js';
import { codeFor, error, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { auditCart } from '../domain/cart.js';
import { auditRecording } from '../domain/recording.js';
import { separationKeys } from '../domain/artist.js';
import type { Category } from '../domain/category.js';
import type { CategoryCode } from '../util/ids.js';
import type { Station } from '../domain/station.js';
import { TENTHS_PER_MINUTE } from '../util/duration.js';
import { doubleCarded, inCategory } from './library.js';
import type { Library, LibraryEntry } from './library.js';
import { unfamilied } from './sounds.js';
import type { SoundIndex } from './sounds.js';

const VAL = (n: number): string => codeFor('library', n);

export interface ValidationOptions {
  readonly station: Station;
  readonly categories: ReadonlyMap<CategoryCode, Category>;
  readonly sounds: SoundIndex;
  readonly currentYear: number;
  /** Below this a rotating category cannot hold a sensible rotation. */
  readonly minimumCategorySize?: number;
}

export interface ValidationReport {
  readonly problems: readonly Problem[];
  readonly carts: number;
  readonly music: number;
  readonly coded: number;
}

/**
 * The most plays of one artist a category can carry before its own separation
 * minimum is arithmetically impossible. With n carts and a minimum of m minutes,
 * one artist can hold at most one cart per m minutes of the rotation cycle.
 */
export function artistCeiling(categorySize: number, separationMinutes: number): number {
  if (separationMinutes <= 0) {
    return categorySize;
  }
  // A category cycles roughly once every categorySize plays, and a play takes
  // about four minutes, so this is how many slots the minimum spans.
  const slotsSpanned = Math.ceil(separationMinutes / 4);
  return Math.max(1, Math.floor(categorySize / Math.max(1, slotsSpanned)));
}

function auditCategory(
  entries: readonly LibraryEntry[],
  category: Category,
  station: Station,
  minimumSize: number,
): Problem[] {
  const problems: Problem[] = [];
  if (!category.music) {
    return problems;
  }
  if (entries.length === 0) {
    problems.push(error(VAL(100), category.code, 'is a rotating category with nothing in it'));
    return problems;
  }
  if (entries.length < minimumSize) {
    problems.push(
      warning(VAL(101), category.code, 'is too small to rotate sensibly', {
        size: entries.length,
        wanted: minimumSize,
      }),
    );
  }
  if (entries.length < category.packets) {
    problems.push(
      error(VAL(102), category.code, 'has fewer carts than packets', {
        size: entries.length,
        packets: category.packets,
      }),
    );
  }
  const minutes = category.separation.artist / TENTHS_PER_MINUTE;
  const ceiling = artistCeiling(entries.length, minutes);
  const counts = countBy(
    entries.flatMap((entry) => separationKeys(entry.cart.credits, station.creditPolicy)),
    (key) => key,
  );
  for (const [artist, count] of counts) {
    if (count > ceiling) {
      problems.push(
        warning(VAL(103), category.code, 'holds more of one artist than separation allows', {
          artist,
          count,
          ceiling,
        }),
      );
    }
  }
  return problems;
}

export function validateLibrary(library: Library, options: ValidationOptions): ValidationReport {
  const problems: Problem[] = [];
  const minimumSize = options.minimumCategorySize ?? 12;
  let coded = 0;
  const usedSounds: string[] = [];
  for (const entry of library.entries) {
    problems.push(...auditCart(entry.cart));
    if (entry.recording !== undefined) {
      problems.push(...auditRecording(entry.recording, options.currentYear));
    } else if (entry.cart.music) {
      problems.push(warning(VAL(104), entry.cart.number, 'is music with no recording coded'));
    }
    if (entry.attributes !== undefined) {
      coded += 1;
      usedSounds.push(...entry.attributes.sounds);
    } else if (entry.cart.music) {
      problems.push(info(VAL(105), entry.cart.number, 'is music with no attributes coded'));
    }
    if (!options.categories.has(entry.cart.category)) {
      problems.push(
        error(VAL(106), entry.cart.number, 'is carded into a category nothing defines', {
          category: entry.cart.category,
        }),
      );
    }
  }
  for (const category of options.categories.values()) {
    problems.push(
      ...auditCategory(inCategory(library, category.code), category, options.station, minimumSize),
    );
  }
  for (const group of doubleCarded(library)) {
    problems.push(
      info(VAL(107), group[0]?.recording?.isrc ?? '', 'is carded more than once', {
        carts: group.map((entry) => entry.cart.number).join(' '),
      }),
    );
  }
  for (const code of unfamilied(options.sounds, usedSounds)) {
    problems.push(info(VAL(108), code, 'is a sound code in no family, so it separates alone'));
  }
  return {
    problems,
    carts: library.entries.length,
    music: library.entries.filter((entry) => entry.cart.music).length,
    coded,
  };
}
