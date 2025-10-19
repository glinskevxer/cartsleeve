/**
 * Filling one hour.
 *
 * The clock says what goes where; this walks it and fills the music elements in
 * order, carrying the schedule under construction forward so each slot is
 * decided against everything already in the hour.
 *
 * The feedback is the whole point. Element three is placed, its runtime and
 * segue decide when element four starts, and that start time is what element
 * four's separation rules measure against. A longer record at three moves four
 * later, which can make a placement legal that would not have been, and a
 * shorter one can do the reverse. So the hour cannot be filled by picking each
 * slot independently and it cannot be parallelised, and the times are not a
 * presentation detail applied afterwards.
 *
 * Non music elements take their time from their own length: a fixed cart from
 * its runtime, a stopset from its budget until traffic replaces it, news from
 * its length. Those are what push the music around.
 */

import type { Timing } from '../domain/segue.js';
import { tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import type { Clock, ClockElement } from '../domain/clock.js';
import { musicBounds } from '../domain/clock.js';
import type { WeekCell } from '../domain/daypart.js';
import type { BroadcastDay } from '../util/time.js';
import type { CartNumber } from '../util/ids.js';
import type { Library, LibraryEntry } from '../library/library.js';
import { lookup } from '../library/library.js';
import type { Placed, RuleContext, RuleSet, Slot } from '../rules/rule.js';
import { makeScheduleView } from '../rules/schedule-view.js';
import { NO_SEGUE, Walk } from './timeline.js';
import { fillSlot } from './search.js';
import type { Hole, Placement } from './search.js';
import type { ScoreInput } from './score.js';

export interface HourInput {
  readonly clock: Clock;
  readonly library: Library;
  readonly rules: RuleSet;
  readonly day: BroadcastDay;
  readonly cell: WeekCell;
  /** Where the hour starts, in tenths from the beginning of the broadcast day. */
  readonly startsAt: Tenths;
  /** Candidates for a music slot, given the slot it is filling. */
  readonly candidatesFor: (slot: Slot) => readonly LibraryEntry[];
  /** Build a rule context from a slot, a candidate and the log so far. */
  readonly contextFor: (
    slot: Slot,
    candidate: LibraryEntry,
    placed: readonly Placed[],
  ) => RuleContext;
  readonly scoring: Omit<ScoreInput, 'context'>;
  readonly floor?: number;
  /**
   * Everything scheduled before this hour started.
   *
   * The rules have to see across the hour boundary: a cart played at 07:55 is
   * not free again at 08:00 just because a new hour began. The hour builds its
   * reader over this plus whatever it has placed itself, so a caller that
   * passes nothing gets an hour scheduled in isolation, which is only ever
   * right for the first hour of a run.
   */
  readonly carried?: readonly Placed[];
  /**
   * What to add to each element position so the slot is identified uniquely
   * across the whole run.
   *
   * A clock numbers its elements from zero, so hour two's slot zero and hour
   * one's slot zero are the same number. The rules skip the slot they are
   * filling by comparing positions, so without an offset a cart placed at
   * position zero last hour is invisible to the slot at position zero this
   * hour, and the separation rules silently stop working across the boundary.
   */
  readonly positionOffset?: number;
}

/** Positions reserved per hour. No clock comes close to this many elements. */
export const POSITIONS_PER_HOUR = 1000;

export interface FilledSlot {
  readonly element: ClockElement;
  readonly at: Tenths;
  readonly length: Tenths;
  readonly placement?: Placement;
  readonly hole?: Hole;
  readonly cart?: CartNumber;
}

export interface HourOutcome {
  readonly slots: readonly FilledSlot[];
  readonly placed: readonly Placed[];
  readonly holes: number;
  readonly breaches: number;
  /** Where the hour ends, in tenths from the start of the broadcast day. */
  readonly endsAt: Tenths;
}

/** How long a non music element occupies. */
function lengthOf(element: ClockElement, library: Library): { length: Tenths; timing: Timing } {
  switch (element.kind) {
    case 'fixed': {
      const found = lookup(library, element.cart);
      return found === undefined
        ? { length: tenths(0), timing: NO_SEGUE }
        : { length: found.cart.runtime, timing: found.cart.timing };
    }
    case 'stopset':
      return { length: element.budget, timing: NO_SEGUE };
    case 'news':
      return { length: element.length, timing: NO_SEGUE };
    case 'music':
      return { length: tenths(0), timing: NO_SEGUE };
  }
}

export function fillHour(input: HourInput): HourOutcome {
  const bounds = musicBounds(input.clock);
  const offset = input.positionOffset ?? 0;
  const slots: FilledSlot[] = [];
  const placed: Placed[] = [];
  const walk = new Walk(input.startsAt);
  let holes = 0;
  let breaches = 0;

  for (const element of input.clock.elements) {
    if (element.kind !== 'music') {
      const { length, timing } = lengthOf(element, input.library);
      const at = walk.place(timing, length);
      slots.push({
        element,
        at,
        length,
        ...(element.kind === 'fixed' ? { cart: element.cart } : {}),
      });
      continue;
    }

    const slot: Slot = {
      position: offset + element.position,
      at: walk.cursor,
      category: element.category,
      cell: input.cell,
      day: input.day,
      opensHour: bounds.first === element.position,
      closesHour: bounds.last === element.position,
    };
    const candidates = input.candidatesFor(slot);
    const view = makeScheduleView([...(input.carried ?? []), ...placed]);
    const outcome = fillSlot({
      slot,
      candidates,
      rules: input.rules,
      contextFor: (candidate) => ({
        ...input.contextFor(slot, candidate, placed),
        schedule: view,
        slot,
      }),
      scoring: input.scoring,
      ...(input.floor === undefined ? {} : { floor: input.floor }),
    });

    if (!outcome.filled) {
      holes += 1;
      slots.push({ element, at: walk.skip(), length: tenths(0), hole: outcome.hole });
      continue;
    }

    const entry = outcome.placement.entry;
    const at = walk.place(entry.cart.timing, entry.cart.runtime);
    if (outcome.placement.relaxedBy > 0) {
      breaches += 1;
    }
    placed.push({
      cart: entry.cart.number,
      entry,
      position: offset + element.position,
      at,
      category: element.category,
      cell: input.cell,
    });
    slots.push({
      element,
      at,
      length: entry.cart.runtime,
      placement: outcome.placement,
      cart: entry.cart.number,
    });
  }

  return { slots, placed, holes, breaches, endsAt: walk.endsAt };
}

/** The music slots of an hour, for a report that only cares about them. */
export function musicSlots(outcome: HourOutcome): FilledSlot[] {
  return outcome.slots.filter((slot) => slot.element.kind === 'music');
}

export function isCleanHour(outcome: HourOutcome): boolean {
  return outcome.holes === 0 && outcome.breaches === 0;
}
