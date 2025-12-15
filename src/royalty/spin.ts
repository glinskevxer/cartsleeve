/**
 * A spin.
 *
 * One performance of one recording. It is the unit a rights society pays on and
 * the only thing in this system that leaves the building as a financial claim,
 * which is why it is built from the as aired log and never from the schedule.
 *
 * A spin is not a cart play. Two carts carrying one master produce two cart
 * plays and two spins of the same ISRC, which is correct: the recording was
 * performed twice. And a cart with no recording coded produces no spin at all,
 * because there is nothing to claim against, which is a library problem showing
 * up as a reporting one.
 *
 * The duration is what was actually on air, not the cart runtime. A record faded
 * out early was performed for as long as it was audible and no longer, and a
 * society that samples will notice the difference.
 */

import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { CartNumber, Isrc } from '../util/ids.js';
import type { Library } from '../library/library.js';
import { lookup } from '../library/library.js';
import type { Recording } from '../domain/recording.js';
import type { Credit } from '../domain/artist.js';
import type { Airing } from '../aired/rebuild.js';

const SPN = (n: number): string => codeFor('royalty', n);

export const NO_RECORDING = SPN(20);
export const NO_LENGTH = SPN(21);
export const UNKNOWN_CART = SPN(22);

export interface Spin {
  readonly isrc: Isrc;
  readonly cart: CartNumber;
  /** When it started, in milliseconds. */
  readonly at: number;
  /** How long it was on air. Absent when the automation never said. */
  readonly length?: number;
  readonly recording: Recording;
  readonly credits: readonly Credit[];
}

export interface SpinOutcome {
  readonly spins: readonly Spin[];
  readonly problems: readonly Problem[];
  /** Airings that produced no spin, which is a shortfall in the claim. */
  readonly unclaimed: readonly Airing[];
}

/**
 * Turn airings into spins.
 *
 * Anything that cannot become a spin is reported rather than dropped, because
 * every one of them is a performance the station will not be paid for.
 */
export function spinsFrom(airings: readonly Airing[], library: Library): SpinOutcome {
  const spins: Spin[] = [];
  const problems: Problem[] = [];
  const unclaimed: Airing[] = [];

  for (const airing of airings) {
    const found = lookup(library, airing.cart);
    if (found === undefined) {
      problems.push(
        error(
          UNKNOWN_CART,
          airing.cart,
          'aired but is not in the library, so it cannot be claimed',
        ),
      );
      unclaimed.push(airing);
      continue;
    }
    if (!found.cart.music) {
      continue;
    }
    const recording = found.recording;
    if (recording === undefined) {
      problems.push(
        error(NO_RECORDING, airing.cart, 'is music with no recording coded and cannot be claimed'),
      );
      unclaimed.push(airing);
      continue;
    }
    if (airing.length === undefined) {
      problems.push(
        warning(NO_LENGTH, airing.cart, 'aired for a length the automation never reported', {
          at: airing.startedAt,
        }),
      );
    }
    spins.push({
      isrc: recording.isrc,
      cart: airing.cart,
      at: airing.startedAt,
      ...(airing.length === undefined ? {} : { length: airing.length }),
      recording,
      credits: found.cart.credits,
    });
  }

  return { spins, problems, unclaimed };
}

/** Spins of one recording, whichever cart carried it. */
export function spinsOf(outcome: SpinOutcome, isrc: Isrc): Spin[] {
  return outcome.spins.filter((spin) => spin.isrc === isrc);
}

export function spinCounts(outcome: SpinOutcome): Map<Isrc, number> {
  const counts = new Map<Isrc, number>();
  for (const spin of outcome.spins) {
    counts.set(spin.isrc, (counts.get(spin.isrc) ?? 0) + 1);
  }
  return counts;
}

/** Total time performed, counting only what the automation measured. */
export function totalPerformed(outcome: SpinOutcome): number {
  return outcome.spins.reduce((sum, spin) => sum + (spin.length ?? 0), 0);
}

/** Spins whose length was never observed, which a society may query. */
export function unmeasuredSpins(outcome: SpinOutcome): Spin[] {
  return outcome.spins.filter((spin) => spin.length === undefined);
}
