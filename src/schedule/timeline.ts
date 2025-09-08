/**
 * The running clock a pass advances as it places things.
 *
 * Both the hour pass and anything that reschedules part of one need the same
 * arithmetic: where does the next item start, given where the last one ended and
 * how the two segue. It was inline in the hour pass, which meant a reschedule
 * had to either duplicate it or accept different times for the same music.
 *
 * Pulling it out also makes the one subtle rule explicit. A hole does not segue.
 * Nothing played, so there is no tail for the next record to start over, and the
 * next item begins exactly where the cursor sits. Leaving the previous timing in
 * place across a hole would overlap the next record into a record that never
 * aired.
 */

import { segueOverlap } from '../domain/segue.js';
import type { Timing } from '../domain/segue.js';
import { tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';

export interface Timeline {
  /** Where the next item would start if it had no intro to overlap. */
  readonly cursor: Tenths;
  /** The timing of the last item placed, absent after a hole or at the start. */
  readonly previous?: Timing;
}

export function startTimeline(at: Tenths): Timeline {
  return { cursor: at };
}

/** Where an item with this timing would start, given what came before it. */
export function startOf(timeline: Timeline, timing: Timing): Tenths {
  const overlap = timeline.previous === undefined ? 0 : segueOverlap(timeline.previous, timing);
  return tenths(timeline.cursor - overlap);
}

/** Place an item and advance. Returns where it starts and the new timeline. */
export function advance(
  timeline: Timeline,
  timing: Timing,
  length: Tenths,
): { at: Tenths; next: Timeline } {
  const at = startOf(timeline, timing);
  return { at, next: { cursor: tenths(at + length), previous: timing } };
}

/**
 * Record a hole. The cursor does not move, because nothing occupied any time,
 * and the previous timing is cleared so the next item does not overlap into a
 * record that never aired.
 */
export function hole(timeline: Timeline): Timeline {
  return { cursor: timeline.cursor };
}

/** How much the segues have saved against a naive sum, so far. */
export function savedBy(timeline: Timeline, naiveEnd: Tenths): Tenths {
  return tenths(naiveEnd - timeline.cursor);
}
