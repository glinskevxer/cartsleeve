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

/** Timing for something that has no segue of its own: a break, news, a hole. */
export const NO_SEGUE: Timing = { intro: tenths(0), endType: 'cold', tail: tenths(0) };

/**
 * A cursor walking an hour, placing items and skipping holes.
 *
 * Both the schedule pass and the traffic merge walk a list of slots advancing a
 * timeline, and both were carrying the same three lines at every branch: work
 * out where the item starts, remember it, move the cursor on. Wrapping it means
 * the two loops differ only in what they are placing, which is the only way they
 * should differ, and it makes the hole rule impossible to forget on one of them.
 */
export class Walk {
  private timeline: Timeline;

  constructor(startsAt: Tenths) {
    this.timeline = startTimeline(startsAt);
  }

  /** Where the next item would land, before anything is placed there. */
  get cursor(): Tenths {
    return this.timeline.cursor;
  }

  get endsAt(): Tenths {
    return this.timeline.cursor;
  }

  /** Place an item and return where it starts. */
  place(timing: Timing, length: Tenths): Tenths {
    const step = advance(this.timeline, timing, length);
    this.timeline = step.next;
    return step.at;
  }

  /** Record a hole. The cursor stays put and nothing overlaps into it. */
  skip(): Tenths {
    const at = this.timeline.cursor;
    this.timeline = hole(this.timeline);
    return at;
  }
}
