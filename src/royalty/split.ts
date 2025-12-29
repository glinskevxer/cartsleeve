/**
 * Splitting a spin across its credited artists.
 *
 * One performance, several people owed. A collaboration credits everybody on it,
 * and the society expects one line per featured artist, so a spin of a track by
 * three people becomes three lines carrying a third each.
 *
 * This is where the two halves of the system finally disagree in public. The
 * separation rules counted that spin as one play by one artist, or as three,
 * depending on the station's credit policy. Royalty has no policy: it always
 * counts three, because all three performed. So a station on the billed policy
 * has a log that says one and a report that says three, and both are right.
 *
 * The shares are equal because that is what a station can defend. Anything else
 * needs a contract nobody sends the station, and a made up weighting is worse
 * than an even one.
 */

import { codeFor, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { royaltyKeys, separationKeys } from '../domain/artist.js';
import type { CreditPolicy } from '../domain/station.js';
import type { Isrc } from '../util/ids.js';
import type { Spin } from './spin.js';

const SPL = (n: number): string => codeFor('royalty', n);

export const NO_CREDITS = SPL(30);
export const MANY_CREDITS = SPL(31);

/** More than this on one track and somebody has miscoded the artist field. */
export const SUSPICIOUS_CREDIT_COUNT = 6;

export interface Share {
  readonly isrc: Isrc;
  readonly artistKey: string;
  readonly artistName: string;
  readonly featured: boolean;
  /** Parts of the spin owed to this artist, out of `of`. */
  readonly parts: number;
  readonly of: number;
  readonly at: number;
}

/**
 * Split one spin. Shares are held as a numerator over a denominator rather than
 * a fraction, because a third of a spin summed over a quarter has to come back
 * to a whole number of spins and floating point will not.
 */
export function splitSpin(spin: Spin): Share[] {
  const keys = royaltyKeys(spin.credits);
  if (keys.length === 0) {
    return [];
  }
  return spin.credits.map((credit) => ({
    isrc: spin.isrc,
    artistKey: credit.key,
    artistName: credit.name,
    featured: credit.role === 'featured',
    parts: 1,
    of: keys.length,
    at: spin.at,
  }));
}

export function splitAll(spins: readonly Spin[]): Share[] {
  return spins.flatMap((spin) => splitSpin(spin));
}

export function auditSplits(spins: readonly Spin[]): Problem[] {
  const problems: Problem[] = [];
  for (const spin of spins) {
    const keys = royaltyKeys(spin.credits);
    if (keys.length === 0) {
      problems.push(
        warning(NO_CREDITS, spin.cart, 'aired with no credited artist, so nobody can be paid', {
          isrc: spin.isrc,
        }),
      );
      continue;
    }
    if (keys.length > SUSPICIOUS_CREDIT_COUNT) {
      problems.push(
        warning(MANY_CREDITS, spin.cart, 'credits more artists than a track plausibly has', {
          credits: keys.length,
          allowed: SUSPICIOUS_CREDIT_COUNT,
        }),
      );
    }
  }
  return problems;
}

/** Whole spins owed to an artist, summed exactly over the parts. */
export function spinsOwed(shares: readonly Share[], artistKey: string): number {
  let total = 0;
  for (const share of shares) {
    if (share.artistKey === artistKey) {
      total += share.parts / share.of;
    }
  }
  return total;
}

export function byArtist(shares: readonly Share[]): Map<string, Share[]> {
  const grouped = new Map<string, Share[]>();
  for (const share of shares) {
    const bucket = grouped.get(share.artistKey);
    if (bucket === undefined) {
      grouped.set(share.artistKey, [share]);
    } else {
      bucket.push(share);
    }
  }
  return grouped;
}

/**
 * How far the two counts diverge for a station.
 *
 * Under the billed policy the log counts a collaboration once and the report
 * counts it per artist, so the two figures differ by exactly the featured
 * credits. Under strict credit they agree. A director who does not know which
 * policy they are on can read it off this number.
 */
export function creditDivergence(spins: readonly Spin[], policy: CreditPolicy): number {
  let logged = 0;
  let reported = 0;
  for (const spin of spins) {
    logged += separationKeys(spin.credits, policy).length;
    reported += royaltyKeys(spin.credits).length;
  }
  return reported - logged;
}

/** Every artist the report will name, which is more than the log ever does. */
export function artistsNamed(shares: readonly Share[]): string[] {
  return [...new Set(shares.map((share) => share.artistKey))].sort();
}
