/**
 * Scoring a candidate that already passes.
 *
 * The search could take the first candidate that clears every rule, and for
 * most slots that is what it does. But the first legal cart is often legal by
 * two minutes, and taking it leaves the next slot with nothing, so the hour
 * degrades from the middle outward.
 *
 * So candidates that pass are scored on how much room they leave rather than on
 * whether they fit. Headroom on each separation rule, staleness in the daypart
 * the slot sits in, and smoothness of the tempo step. A cart that clears every
 * minimum by a wide margin scores above one that scrapes through, and the hour
 * holds together further down.
 *
 * The score is never a tie break of last resort. Two candidates that score
 * identically fall back to the cart number, so a rerun of the same day produces
 * the same log, which matters more than any of the above.
 */

import { artistHeadroom } from '../rules/artist-separation.js';
import { titleHeadroom } from '../rules/title-separation.js';
import { recordingHeadroom } from '../rules/recording-separation.js';
import { soundHeadroom } from '../rules/sound-separation.js';
import { tempoStepInto } from '../rules/flow.js';
import { staleness } from '../rotation/horizontal.js';
import type { Daypart } from '../domain/daypart.js';
import type { RuleContext } from '../rules/rule.js';
import type { Play } from '../rotation/rest.js';

export interface ScoreWeights {
  readonly artist: number;
  readonly title: number;
  readonly recording: number;
  readonly sound: number;
  readonly flow: number;
  readonly staleness: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  artist: 3,
  title: 2,
  recording: 2,
  sound: 1,
  flow: 1,
  staleness: 2,
};

/** Headroom runs to a cap; anything above it scores the same. */
export const HEADROOM_CAP = 3;

/** Staleness runs to infinity, so it is capped before it is weighted. */
export const STALENESS_CAP = 20;

/**
 * Normalise a raw part to 0 to 1 against its cap. An infinite value is the cap
 * rather than the cap unnormalised, which is worth stating because getting it
 * wrong lets one part outweigh every other by the size of its cap.
 */
function capped(value: number, cap: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(value, cap) / cap;
}

/** How smooth the tempo step into the slot is, from 0 for a jolt to 1 for none. */
export function flowScore(context: RuleContext): number {
  const step = tempoStepInto(context);
  if (step === undefined) {
    return 1;
  }
  return Math.max(0, 1 - step.step / 5);
}

export interface ScoreParts {
  readonly artist: number;
  readonly title: number;
  readonly recording: number;
  readonly sound: number;
  readonly flow: number;
  readonly staleness: number;
  readonly total: number;
}

export interface ScoreInput {
  readonly context: RuleContext;
  readonly plays: readonly Play[];
  readonly dayparts: readonly Daypart[];
  /** Which daypart the slot sits in, or -1 if none claims it. */
  readonly daypart: number;
  readonly weights?: ScoreWeights;
}

export function scoreCandidate(input: ScoreInput): ScoreParts {
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const artist = capped(artistHeadroom(input.context), HEADROOM_CAP);
  const title = capped(titleHeadroom(input.context), HEADROOM_CAP);
  const recording = capped(recordingHeadroom(input.context), HEADROOM_CAP);
  const sound = capped(soundHeadroom(input.context), HEADROOM_CAP);
  const flow = flowScore(input.context);
  const stale =
    input.daypart < 0
      ? 1
      : capped(
          staleness(
            input.plays,
            input.dayparts,
            input.context.candidate.cart.number,
            input.daypart,
          ),
          STALENESS_CAP,
        );
  const total =
    artist * weights.artist +
    title * weights.title +
    recording * weights.recording +
    sound * weights.sound +
    flow * weights.flow +
    stale * weights.staleness;
  return { artist, title, recording, sound, flow, staleness: stale, total };
}

/**
 * Order two scored candidates. Higher total first, then the cart number, so the
 * ordering is total and a rerun of the same day reproduces the same log.
 */
export function compareScored(
  a: { readonly total: number; readonly cart: string },
  b: { readonly total: number; readonly cart: string },
): number {
  if (a.total !== b.total) {
    return b.total - a.total;
  }
  return a.cart < b.cart ? -1 : a.cart > b.cart ? 1 : 0;
}

/** The best possible total, for reporting a score as a fraction of it. */
export function maximumScore(weights: ScoreWeights = DEFAULT_WEIGHTS): number {
  return (
    weights.artist +
    weights.title +
    weights.recording +
    weights.sound +
    weights.flow +
    weights.staleness
  );
}
