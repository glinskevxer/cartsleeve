/**
 * Scheduling operations.
 *
 * Assembling a day pass takes eleven things: a library, categories, clocks, a
 * grid, restrictions, windows, rotation state, play history, a rule set, a
 * scoring configuration and the day itself. Every caller needs all of them and
 * no caller wants to know that, so this is where they are put together.
 *
 * It also owns the one piece of state a schedule pass cannot be pure about: the
 * rotation position. A day scheduled without carrying the packet cursor forward
 * from yesterday opens on the same record every morning, so the service holds it
 * between runs and writes it to the journal, which makes a restart reproduce
 * rather than restart the rotation.
 */

import { codeFor, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { tenths } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { daysFromCivil } from '../util/time.js';
import type { BroadcastDay } from '../util/time.js';
import type { Clock } from '../domain/clock.js';
import type { Placed, RuleContext, RuleSet, Slot } from '../rules/rule.js';
import { makeScheduleView } from '../rules/schedule-view.js';
import { standardRuleSet } from '../rules/tiers.js';
import type { RestrictionMap } from '../library/restriction.js';
import { NO_RESTRICTIONS } from '../library/restriction.js';
import type { WindowMap } from '../library/window.js';
import { NO_WINDOWS } from '../library/window.js';
import { EMPTY_SOUND_INDEX } from '../library/sounds.js';
import type { SoundIndex } from '../library/sounds.js';
import { COUNTRY_BANDS, makeEraMap } from '../library/era.js';
import type { EraMap } from '../library/era.js';
import { inCategory } from '../library/library.js';
import type { LibraryEntry } from '../library/library.js';
import { POSITIONS_PER_DAY, fillDay } from '../schedule/day.js';
import type { DayOutcome } from '../schedule/day.js';
import type { Journal } from '../store/append.js';
import type { StationState } from './station-service.js';

const SCH = (n: number): string => codeFor('schedule', n);

export const NO_CLOCK = SCH(60);
export const SCHEDULED = SCH(61);

export interface ScheduleOptions {
  readonly restrictions?: RestrictionMap;
  readonly windows?: WindowMap;
  readonly sounds?: SoundIndex;
  readonly eras?: EraMap;
  readonly rules?: RuleSet;
  readonly floor?: number;
  /** How many hours the day holds. Twenty three or twenty five at a transition. */
  readonly hours?: number;
  /**
   * Override the position space this day occupies. Only for a caller running
   * two passes over the same day that must not see each other.
   */
  readonly positionOffset?: number;
}

/**
 * Positions are numbered from the day itself, so two days scheduled in separate
 * calls never share the space.
 *
 * The rules identify the slot they are filling by comparing positions, so a
 * collision makes yesterday's placement invisible to today's and every
 * separation rule silently stops working across the boundary. Deriving the
 * offset from the calendar rather than from a counter keeps it stable across a
 * restart, which a counter in memory would not be.
 */
export function offsetForDay(day: BroadcastDay): number {
  return daysFromCivil(day.year, day.month, day.day) * POSITIONS_PER_DAY;
}

export interface ScheduleOutcome {
  readonly day: DayOutcome;
  readonly problems: readonly Problem[];
}

export class ScheduleService {
  constructor(private readonly journal: Journal) {}

  /**
   * Schedule one broadcast day.
   *
   * The clock for each hour comes from the caller, because the grid lives above
   * this and a caller rescheduling a single day may want to override it.
   */
  scheduleDay(
    state: StationState,
    day: BroadcastDay,
    weekday: number,
    clockFor: (hourIndex: number) => Clock | undefined,
    carried: readonly Placed[],
    options: ScheduleOptions = {},
  ): ScheduleOutcome {
    const restrictions = options.restrictions ?? NO_RESTRICTIONS;
    const windows = options.windows ?? NO_WINDOWS;
    const sounds = options.sounds ?? EMPTY_SOUND_INDEX;
    const eras = options.eras ?? fallbackEras();
    const rules = options.rules ?? standardRuleSet(restrictions, windows);

    const outcome = fillDay({
      day,
      weekday,
      dayStartHour: state.station.dayStartHour,
      hours: options.hours ?? 24,
      positionOffset: options.positionOffset ?? offsetForDay(day),
      clockFor,
      hourInputFor: (_hourIndex, clock, startsAt, cell) => ({
        clock,
        library: state.library,
        rules,
        day,
        cell,
        startsAt,
        carried,
        candidatesFor: (slot: Slot): readonly LibraryEntry[] =>
          inCategory(state.library, slot.category),
        contextFor: (slot: Slot, candidate: LibraryEntry): RuleContext => ({
          station: state.station,
          categories: state.categories,
          sounds,
          eras,
          schedule: makeScheduleView([]),
          slot,
          candidate,
        }),
        scoring: { plays: [], dayparts: [], daypart: -1 },
        ...(options.floor === undefined ? {} : { floor: options.floor }),
      }),
    });

    const problems: Problem[] = [];
    for (const hourIndex of outcome.missingClocks) {
      problems.push(
        warning(NO_CLOCK, `hour ${hourIndex}`, 'has no clock and was left unscheduled', {
          day: `${day.year}-${day.month}-${day.day}`,
        }),
      );
    }

    this.journal.append(
      'schedule.day',
      {
        day: `${day.year}-${day.month}-${day.day}`,
        hours: outcome.hours.length,
        placed: outcome.placed.length,
        breaches: outcome.breaches.length,
        holes: outcome.holes.length,
      },
      Date.now(),
    );

    return { day: outcome, problems };
  }

  /** Where the day ends, which is what the next day starts from. */
  endsAt(outcome: ScheduleOutcome): Tenths {
    return tenths(outcome.day.endsAt);
  }

  /** Everything the day placed, for a caller carrying it into tomorrow. */
  placed(outcome: ScheduleOutcome): readonly Placed[] {
    return outcome.day.placed;
  }
}

/** The era bands used when the caller names none. Shared with the api. */
export function fallbackEras(): EraMap {
  const built = makeEraMap(COUNTRY_BANDS);
  return built.ok ? built.value : { bands: [] };
}
