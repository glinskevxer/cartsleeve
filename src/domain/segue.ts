/**
 * Intros, end types and the segue.
 *
 * A cart's runtime is not the time it occupies in the hour. A song that fades
 * can have the next one started over its tail, and how far over is decided by
 * the next song's intro, the ramp before the vocal starts. Jocks talk over that
 * ramp and the automation overlaps it, so an hour of fourteen songs runs
 * shorter than the sum of fourteen runtimes, by a minute or more.
 *
 * Every downstream time in the log is built on this. Separation is a wall clock
 * rule in minutes, so a segue that overlaps two seconds further moves the whole
 * rest of the hour two seconds earlier, and a pair that was legal at 40 minutes
 * apart can fall under the minimum without any music decision changing.
 */

import { sumDurations, tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { codeFor, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';

/**
 * How a cart ends.
 *
 * `cold` stops dead and nothing can be started over it. `fade` has a tail the
 * next cart can be started into. `sustain` holds a note or a bed and the
 * automation may run the next cart over all of it.
 */
export type EndType = 'cold' | 'fade' | 'sustain';

export const END_TYPES: readonly EndType[] = ['cold', 'fade', 'sustain'];

export interface Timing {
  /** Seconds of ramp before the vocal starts, in tenths. */
  readonly intro: Tenths;
  readonly endType: EndType;
  /** How much of the ending is overlappable, in tenths. */
  readonly tail: Tenths;
}

export const DEFAULT_TIMING: Timing = {
  intro: tenths(0),
  endType: 'cold',
  tail: tenths(0),
};

export function parseEndType(raw: string): EndType | undefined {
  const trimmed = raw.trim().toLowerCase();
  switch (trimmed) {
    case 'c':
    case 'cold':
      return 'cold';
    case 'f':
    case 'fade':
      return 'fade';
    case 's':
    case 'sustain':
      return 'sustain';
    default:
      return undefined;
  }
}

/**
 * How far the next cart is started over the one before it.
 *
 * A cold ending overlaps nothing whatever the next intro is. Otherwise the
 * overlap is the smaller of the tail available and the ramp the next cart
 * offers, because starting further in than the ramp would talk over the vocal.
 */
export function segueOverlap(previous: Timing, next: Timing): Tenths {
  if (previous.endType === 'cold') {
    return tenths(0);
  }
  return tenths(Math.max(0, Math.min(previous.tail, next.intro)));
}

export interface TimedItem {
  readonly runtime: Tenths;
  readonly timing: Timing;
}

/**
 * Start offsets for a run of carts, each measured from the start of the run.
 * The list is one longer than the input: the last entry is where the run ends.
 */
export function segueOffsets(items: readonly TimedItem[]): Tenths[] {
  const offsets: Tenths[] = [tenths(0)];
  let cursor = 0;
  for (const [index, item] of items.entries()) {
    const previous = items[index - 1];
    const overlap = previous === undefined ? 0 : segueOverlap(previous.timing, item.timing);
    cursor = cursor - overlap + item.runtime;
    offsets[index] = tenths(cursor - item.runtime);
    offsets[index + 1] = tenths(cursor);
  }
  return offsets;
}

/** What the run really occupies, which is always at most the sum of runtimes. */
export function segueLength(items: readonly TimedItem[]): Tenths {
  const offsets = segueOffsets(items);
  return offsets[offsets.length - 1] ?? tenths(0);
}

/** How much the segues save against a naive sum of the runtimes. */
export function segueSaving(items: readonly TimedItem[]): Tenths {
  const naive = sumDurations(items.map((item) => item.runtime));
  return tenths(naive - segueLength(items));
}

const SEG = (n: number): string => codeFor('clock', n);

export function auditTiming(subject: string, runtime: Tenths, timing: Timing): Problem[] {
  const problems: Problem[] = [];
  if (timing.intro < 0) {
    problems.push(warning(SEG(20), subject, 'has a negative intro', { intro: timing.intro }));
  }
  if (timing.intro > runtime) {
    problems.push(
      warning(SEG(21), subject, 'has an intro longer than the cart', {
        intro: timing.intro,
        runtime,
      }),
    );
  }
  if (timing.tail > runtime) {
    problems.push(
      warning(SEG(22), subject, 'has a tail longer than the cart', { tail: timing.tail, runtime }),
    );
  }
  if (timing.endType === 'cold' && timing.tail > 0) {
    problems.push(warning(SEG(23), subject, 'ends cold but carries a tail', { tail: timing.tail }));
  }
  if (timing.endType !== 'cold' && timing.tail === 0) {
    problems.push(warning(SEG(24), subject, 'fades but has no tail coded'));
  }
  return problems;
}
