/**
 * Artists and credits.
 *
 * A cart carries one billed artist string, which is what appears on the log and
 * what the label delivered. It may name several people. Which of them count is
 * the question that separates the two halves of this system:
 *
 *   royalty always splits across every credited artist, because every one of
 *   them is a featured performer for reporting purposes;
 *
 *   separation counts only the billed primary unless the station opted into
 *   strict credit, because otherwise an artist who guests on nine records in
 *   the current library becomes unschedulable.
 *
 * So the same cart is one play to one rule and three to another, and the tests
 * here pin both readings rather than picking one.
 */

import { compareText } from '../util/ordering.js';
import type { CreditPolicy } from './station.js';

export type CreditRole = 'primary' | 'featured';

export interface Credit {
  /** Normalised, used for every comparison. */
  readonly key: string;
  /** As billed, used for every printed line. */
  readonly name: string;
  readonly role: CreditRole;
}

/**
 * The markers that introduce a featured credit. An ampersand is deliberately
 * not one of them: Hall & Oates and Earth, Wind & Fire are single acts, and a
 * parser that splits on the ampersand turns both of them into two artists who
 * then fail to separate against themselves.
 */
const FEATURE_MARKERS = [
  ' featuring ',
  ' feat. ',
  ' feat ',
  ' ft. ',
  ' ft ',
  ' duet with ',
  ' with ',
];

/** Secondary separators, valid only inside an already featured segment. */
const SECONDARY = /\s*(?:,|&|\band\b)\s*/i;

export function artistKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/^THE\s+/, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitOnMarker(billed: string): { primary: string; rest: string } {
  const lower = billed.toLowerCase();
  let best = -1;
  let bestLength = 0;
  for (const marker of FEATURE_MARKERS) {
    const at = lower.indexOf(marker);
    if (at >= 0 && (best === -1 || at < best)) {
      best = at;
      bestLength = marker.length;
    }
  }
  if (best === -1) {
    return { primary: billed, rest: '' };
  }
  return { primary: billed.slice(0, best), rest: billed.slice(best + bestLength) };
}

/**
 * Read a billed string into credits. The first name is the primary and
 * everything after a feature marker is featured, split further on commas and
 * ampersands because those genuinely do separate names once inside a feature.
 */
export function parseCredits(billed: string): Credit[] {
  const trimmed = billed.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const { primary, rest } = splitOnMarker(trimmed);
  const credits: Credit[] = [];
  const primaryName = primary.trim();
  if (primaryName.length > 0) {
    credits.push({ key: artistKey(primaryName), name: primaryName, role: 'primary' });
  }
  if (rest.trim().length > 0) {
    for (const piece of rest.split(SECONDARY)) {
      const name = piece.trim();
      if (name.length === 0) {
        continue;
      }
      const key = artistKey(name);
      if (key.length > 0 && !credits.some((credit) => credit.key === key)) {
        credits.push({ key, name, role: 'featured' });
      }
    }
  }
  return credits;
}

export function primaryOf(credits: readonly Credit[]): Credit | undefined {
  return credits.find((credit) => credit.role === 'primary');
}

export function featuredOf(credits: readonly Credit[]): Credit[] {
  return credits.filter((credit) => credit.role === 'featured');
}

/**
 * The keys separation should compare against, under the station's policy. This
 * is the function the whole composition turns on.
 */
export function separationKeys(credits: readonly Credit[], policy: CreditPolicy): string[] {
  if (policy === 'strict') {
    return credits.map((credit) => credit.key);
  }
  const primary = primaryOf(credits);
  return primary === undefined ? [] : [primary.key];
}

/** The keys royalty pays out on, which is every credit whatever the policy. */
export function royaltyKeys(credits: readonly Credit[]): string[] {
  return credits.map((credit) => credit.key);
}

export function formatCredits(credits: readonly Credit[]): string {
  const primary = primaryOf(credits);
  const featured = featuredOf(credits);
  if (primary === undefined) {
    return '';
  }
  if (featured.length === 0) {
    return primary.name;
  }
  return `${primary.name} feat. ${featured.map((credit) => credit.name).join(', ')}`;
}

export function sortCredits(credits: readonly Credit[]): Credit[] {
  return [...credits].sort((a, b) => {
    if (a.role !== b.role) {
      return a.role === 'primary' ? -1 : 1;
    }
    return compareText(a.name, b.name);
  });
}
