import type { HourInput } from '../../src/schedule/hour.js';
import type { DayInput } from '../../src/schedule/day.js';
import type { Clock } from '../../src/domain/clock.js';
import { makeClock } from '../../src/domain/clock.js';
import type { ElementInput } from '../../src/domain/clock.js';
import { standardRuleSet } from '../../src/rules/tiers.js';
import { NO_RESTRICTIONS } from '../../src/library/restriction.js';
import { NO_WINDOWS } from '../../src/library/window.js';
import { STANDARD_FAMILIES, makeSoundIndex } from '../../src/library/sounds.js';
import { COUNTRY_BANDS, makeEraMap } from '../../src/library/era.js';
import { inCategory, makeLibrary } from '../../src/library/library.js';
import type { Library } from '../../src/library/library.js';
import { cellOf } from '../../src/domain/daypart.js';
import { tenths } from '../../src/util/duration.js';
import { CATEGORIES } from './context.js';
import { entry, station } from './fixtures.js';
import type { EntrySpec } from './fixtures.js';
import { expectOk } from './result.js';

export const HOUR_DAY = { year: 2025, month: 6, day: 10 };
export const HOUR_CELL = cellOf(2, 7);

export function clockOf(elements: readonly ElementInput[]): Clock {
  return expectOk(makeClock('TEST', elements));
}

/** A clock of `count` music slots in one category, four minutes apart. */
export function musicClock(count: number, category = 'A'): Clock {
  return clockOf(
    Array.from({ length: count }, (_, index) => ({
      kind: 'music' as const,
      target: `${index * 4}:00`,
      category,
    })),
  );
}

export function libraryOf(specs: readonly EntrySpec[]): Library {
  return makeLibrary(specs.map((spec) => entry(spec)));
}

export interface HourSpec {
  readonly clock: Clock;
  readonly library: Library;
  readonly floor?: number;
  readonly startsAt?: number;
}

/** Assemble a complete hour input, drawing candidates straight from a category. */
export function hourInput(spec: HourSpec): HourInput {
  const sounds = expectOk(makeSoundIndex(STANDARD_FAMILIES));
  const eras = expectOk(makeEraMap(COUNTRY_BANDS));
  return {
    clock: spec.clock,
    library: spec.library,
    rules: standardRuleSet(NO_RESTRICTIONS, NO_WINDOWS),
    day: HOUR_DAY,
    cell: HOUR_CELL,
    startsAt: tenths(spec.startsAt ?? 0),
    candidatesFor: (slot) => inCategory(spec.library, slot.category),
    contextFor: (slot, candidate) => ({
      station: station(),
      categories: CATEGORIES,
      sounds,
      eras,
      schedule: {
        before: () => [],
        after: () => [],
        within: () => [],
        previous: () => undefined,
        count: 0,
      },
      slot,
      candidate,
    }),
    scoring: { plays: [], dayparts: [], daypart: -1 },
    ...(spec.floor === undefined ? {} : { floor: spec.floor }),
  };
}

/**
 * A day input that runs one clock every hour, carrying the placed log forward
 * behind the schedule reader so the rules see across hour boundaries.
 */
export function dayInput(spec: {
  readonly clock: Clock;
  readonly library: Library;
  readonly hours: number;
  readonly weekday?: number;
  readonly dayStartHour?: number;
  readonly floor?: number;
}): DayInput {
  return {
    day: HOUR_DAY,
    weekday: spec.weekday ?? 2,
    dayStartHour: spec.dayStartHour ?? 5,
    hours: spec.hours,
    clockFor: () => spec.clock,
    hourInputFor: (_hourIndex, clock, startsAt, cell) => {
      const base = hourInput({
        clock,
        library: spec.library,
        ...(spec.floor === undefined ? {} : { floor: spec.floor }),
      });
      return { ...base, startsAt, cell };
    },
  };
}
