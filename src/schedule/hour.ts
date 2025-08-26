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

import { segueOverlap } from '../domain/segue.js';
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
}

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

const NO_TIMING: Timing = { intro: tenths(0), endType: 'cold', tail: tenths(0) };

/** How long a non music element occupies. */
function lengthOf(element: ClockElement, library: Library): { length: Tenths; timing: Timing } {
  switch (element.kind) {
    case 'fixed': {
      const found = lookup(library, element.cart);
      return found === undefined
        ? { length: tenths(0), timing: NO_TIMING }
        : { length: found.cart.runtime, timing: found.cart.timing };
    }
    case 'stopset':
      return { length: element.budget, timing: NO_TIMING };
    case 'news':
      return { length: element.length, timing: NO_TIMING };
    case 'music':
      return { length: tenths(0), timing: NO_TIMING };
  }
}

export function fillHour(input: HourInput): HourOutcome {
  const bounds = musicBounds(input.clock);
  const slots: FilledSlot[] = [];
  const placed: Placed[] = [];
  let cursor = input.startsAt;
  let previous: Timing | undefined;
  let holes = 0;
  let breaches = 0;

  for (const element of input.clock.elements) {
    if (element.kind !== 'music') {
      const { length, timing } = lengthOf(element, input.library);
      const overlap = previous === undefined ? 0 : segueOverlap(previous, timing);
      const at = tenths(cursor - overlap);
      slots.push({
        element,
        at,
        length,
        ...(element.kind === 'fixed' ? { cart: element.cart } : {}),
      });
      cursor = tenths(at + length);
      previous = timing;
      continue;
    }

    const slot: Slot = {
      position: element.position,
      at: cursor,
      category: element.category,
      cell: input.cell,
      day: input.day,
      opensHour: bounds.first === element.position,
      closesHour: bounds.last === element.position,
    };
    const candidates = input.candidatesFor(slot);
    const view = makeScheduleView(placed);
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
      slots.push({ element, at: cursor, length: tenths(0), hole: outcome.hole });
      previous = undefined;
      continue;
    }

    const entry = outcome.placement.entry;
    const overlap = previous === undefined ? 0 : segueOverlap(previous, entry.cart.timing);
    const at = tenths(cursor - overlap);
    if (outcome.placement.relaxedBy > 0) {
      breaches += 1;
    }
    placed.push({
      cart: entry.cart.number,
      entry,
      position: element.position,
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
    cursor = tenths(at + entry.cart.runtime);
    previous = entry.cart.timing;
  }

  return { slots, placed, holes, breaches, endsAt: cursor };
}

/** The music slots of an hour, for a report that only cares about them. */
export function musicSlots(outcome: HourOutcome): FilledSlot[] {
  return outcome.slots.filter((slot) => slot.element.kind === 'music');
}

export function isCleanHour(outcome: HourOutcome): boolean {
  return outcome.holes === 0 && outcome.breaches === 0;
}
