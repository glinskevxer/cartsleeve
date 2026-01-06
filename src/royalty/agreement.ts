/**
 * Where the log and the filing disagree, and why that is fine.
 *
 * An auditor reads the music log, counts plays by artist, reads the performance
 * report, counts claims by artist, and finds two different numbers. On a station
 * running the billed credit policy they will always be different, and the
 * difference is not an error.
 *
 * They disagree on two separate things and it is worth keeping them apart.
 *
 * They disagree about WHO. The log counts what the separation rules counted,
 * which under `billed` is the primary artist only, so a guest who never appears
 * in the log appears in the report. Under `strict` the two name exactly the same
 * artists, and that is the thing this module can prove.
 *
 * And they disagree about HOW MUCH, under both policies. The log counts a whole
 * play for every artist it counts; royalty splits one performance across its
 * credits, so three collaborators are a third each. Those never reconcile and
 * were never meant to, because the log is counting airplay and the report is
 * dividing a payment.
 *
 * So the useful test is on the names, not on the totals, and an auditor asking
 * why the numbers differ is asking about the second thing while looking at the
 * first.
 */

import { codeFor, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { compareText } from '../util/ordering.js';
import { separationKeys } from '../domain/artist.js';
import type { CreditPolicy } from '../domain/station.js';
import type { Spin } from './spin.js';
import { splitAll, spinsOwed } from './split.js';

const AGR = (n: number): string => codeFor('royalty', n);

export const EXPECTED_DIVERGENCE = AGR(60);
export const UNEXPECTED_DIVERGENCE = AGR(61);

export interface ArtistAgreement {
  readonly artistKey: string;
  readonly artistName: string;
  /** Plays the music log counted for this artist, under the station policy. */
  readonly logged: number;
  /** Spins the report claims for them, which counts every credit. */
  readonly claimed: number;
  /** Claimed minus logged. Positive means the report says more. */
  readonly divergence: number;
}

export interface Agreement {
  readonly policy: CreditPolicy;
  readonly artists: readonly ArtistAgreement[];
  readonly totalLogged: number;
  readonly totalClaimed: number;
  /**
   * True when the log and the report name exactly the same artists. Strict
   * credit guarantees this; the billed policy breaks it on any collaboration.
   */
  readonly agrees: boolean;
}

export function measureAgreement(spins: readonly Spin[], policy: CreditPolicy): Agreement {
  const logged = new Map<string, number>();
  const names = new Map<string, string>();
  for (const spin of spins) {
    for (const key of separationKeys(spin.credits, policy)) {
      logged.set(key, (logged.get(key) ?? 0) + 1);
    }
    for (const credit of spin.credits) {
      names.set(credit.key, credit.name);
    }
  }

  const shares = splitAll(spins);
  const claimed = new Map<string, number>();
  for (const key of new Set(shares.map((share) => share.artistKey))) {
    claimed.set(key, spinsOwed(shares, key));
  }

  const keys = new Set([...logged.keys(), ...claimed.keys()]);
  const artists: ArtistAgreement[] = [];
  for (const key of keys) {
    const loggedCount = logged.get(key) ?? 0;
    const claimedCount = claimed.get(key) ?? 0;
    artists.push({
      artistKey: key,
      artistName: names.get(key) ?? key,
      logged: loggedCount,
      claimed: claimedCount,
      divergence: claimedCount - loggedCount,
    });
  }
  artists.sort(
    (a, b) =>
      Math.abs(b.divergence) - Math.abs(a.divergence) || compareText(a.artistKey, b.artistKey),
  );

  const totalLogged = [...logged.values()].reduce((sum, each) => sum + each, 0);
  const totalClaimed = [...claimed.values()].reduce((sum, each) => sum + each, 0);
  return {
    policy,
    artists,
    totalLogged,
    totalClaimed,
    // Agreement is about the names. The magnitudes never match, because the log
    // counts whole plays and the report splits one performance across credits.
    agrees: artists.every((artist) => artist.logged > 0 && artist.claimed > 0),
  };
}

/** Artists one side names and the other does not. */
export function diverging(agreement: Agreement): ArtistAgreement[] {
  return agreement.artists.filter((artist) => artist.logged === 0 || artist.claimed === 0);
}

/**
 * Explain a disagreement about who.
 *
 * Under the billed policy an artist in the report and not the log is expected
 * and is reported as information. Under strict credit there should be none, so
 * any at all is a defect somewhere and is reported as a warning.
 */
export function explain(agreement: Agreement): Problem[] {
  const apart = diverging(agreement);
  if (apart.length === 0) {
    return [];
  }
  if (agreement.policy === 'billed') {
    return [
      info(
        EXPECTED_DIVERGENCE,
        'report',
        'claims for more artists than the log counts, which is what the billed credit policy does',
        {
          artists: apart.length,
          logged: agreement.totalLogged,
          claimed: Math.round(agreement.totalClaimed),
        },
      ),
    ];
  }
  return [
    warning(
      UNEXPECTED_DIVERGENCE,
      'report',
      'disagrees with the log under strict credit, where the two should match exactly',
      { artists: apart.length, worst: apart[0]?.artistKey ?? '' },
    ),
  ];
}

/** The artists whose claim the log does not support at all. */
export function claimedOnly(agreement: Agreement): ArtistAgreement[] {
  return agreement.artists.filter((artist) => artist.logged === 0 && artist.claimed > 0);
}
