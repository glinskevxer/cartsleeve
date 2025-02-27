/**
 * Sound codes and the families they belong to.
 *
 * A sound code is a tag a music director hangs on a cart for something the
 * category cannot say: a fiddle break, a drum machine, a duet vocal. The
 * separation rule keeps them apart so an hour does not turn into four fiddle
 * records in a row.
 *
 * Matching on the code alone is not enough. A director who codes one cart
 * STEELGTR and another PEDALSTEEL has made two codes for one sound, and they
 * will happily play back to back. So codes belong to families, the rule
 * separates on the family, and a code nobody has placed in a family is its own
 * family of one, which degrades to exact matching rather than to nothing.
 */

import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { Check } from '../util/check.js';
import type { Result } from '../util/result.js';
import { normaliseSound } from './attributes.js';

export interface SoundFamily {
  readonly name: string;
  readonly codes: ReadonlySet<string>;
}

export interface SoundIndex {
  readonly families: readonly SoundFamily[];
  /** Code to family name. A code not here is its own family. */
  readonly familyOf: ReadonlyMap<string, string>;
}

const SND = (n: number): string => codeFor('library', n);

export function makeSoundIndex(
  definitions: Readonly<Record<string, readonly string[]>>,
): Result<SoundIndex, Problem[]> {
  const check = new Check();
  const familyOf = new Map<string, string>();
  const families: SoundFamily[] = [];
  for (const [rawName, rawCodes] of Object.entries(definitions)) {
    const name = rawName.trim().toUpperCase();
    if (!check.ensure(name.length > 0, SND(60), rawName, 'is a sound family with no name')) {
      continue;
    }
    const codes = new Set<string>();
    for (const raw of rawCodes) {
      const code = normaliseSound(raw);
      if (!check.ensure(code.length > 0, SND(61), name, 'has an empty sound code')) {
        continue;
      }
      const already = familyOf.get(code);
      const free = check.ensure(
        already === undefined || already === name,
        SND(62),
        code,
        'is claimed by two sound families',
        { first: already ?? '', second: name },
      );
      if (free) {
        familyOf.set(code, name);
        codes.add(code);
      }
    }
    check.ensure(codes.size > 0, SND(63), name, 'is a sound family with no codes');
    families.push({ name, codes });
  }
  return check.result(() => ({ families, familyOf }));
}

export const EMPTY_SOUND_INDEX: SoundIndex = {
  families: [],
  familyOf: new Map<string, string>(),
};

/** The family a code belongs to, or the code itself when it has none. */
export function familyFor(index: SoundIndex, code: string): string {
  const normalised = normaliseSound(code);
  return index.familyOf.get(normalised) ?? normalised;
}

export function familiesFor(index: SoundIndex, codes: readonly string[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    const family = familyFor(index, code);
    if (family.length > 0 && !out.includes(family)) {
      out.push(family);
    }
  }
  return out;
}

/** Families the two carts share, which is what the separation rule fires on. */
export function sharedFamilies(
  index: SoundIndex,
  a: readonly string[],
  b: readonly string[],
): string[] {
  const left = familiesFor(index, a);
  const right = new Set(familiesFor(index, b));
  return left.filter((family) => right.has(family));
}

export function clash(index: SoundIndex, a: readonly string[], b: readonly string[]): boolean {
  return sharedFamilies(index, a, b).length > 0;
}

/**
 * Codes nobody has placed in a family. Not an error, but a director wants the
 * list, because an uncoded code separates only against itself.
 */
export function unfamilied(index: SoundIndex, used: readonly string[]): string[] {
  const out: string[] = [];
  for (const code of used) {
    const normalised = normaliseSound(code);
    if (normalised.length > 0 && !index.familyOf.has(normalised) && !out.includes(normalised)) {
      out.push(normalised);
    }
  }
  return out;
}

export const STANDARD_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  steel: ['steel gtr', 'pedal steel', 'dobro', 'lap steel'],
  fiddle: ['fiddle', 'violin', 'strings'],
  banjo: ['banjo', 'clawhammer'],
  duet: ['duet', 'harmony vocal', 'trio'],
  machine: ['drum machine', 'loop', 'programmed'],
};
