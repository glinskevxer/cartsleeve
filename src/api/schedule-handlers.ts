/**
 * Scheduling over the envelope.
 *
 * One request schedules one broadcast day, and the answer is a count of what
 * happened rather than the log itself. A day is two or three hundred
 * placements and nobody reads that off a response; what they read is how many
 * holes there are and how many rules were relaxed to avoid more.
 *
 * The session holds the last day scheduled. That is not a cache, it is what
 * makes the reports askable. A music director schedules Tuesday, looks at the
 * breaches, changes a category and schedules it again, and asking them to
 * resend three hundred placements to see the second half of that is not a
 * design, it is a dare.
 */

import { z } from 'zod';
import { BAD_PARAMS, refuse, succeed } from './envelope.js';
import type { ApiRequest, ApiResponse } from './envelope.js';
import type { Route } from './dispatch.js';
import { route } from './handler.js';
import { error } from '../util/problem.js';
import { formatDuration, tenths } from '../util/duration.js';
import type { BroadcastDay } from '../util/time.js';
import type { Clock } from '../domain/clock.js';
import type { Placed } from '../rules/rule.js';
import type { ScheduleOutcome } from '../service/schedule-service.js';
import type { ScheduleService } from '../service/schedule-service.js';
import type { StationService } from '../service/station-service.js';
import { NOT_FOUND } from '../service/guard.js';

const daySchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

const scheduleSchema = z.object({
  day: daySchema,
  weekday: z.number().int().min(0).max(6),
  /** One clock for every hour, or a clock per hour index. */
  clock: z.string().optional(),
  clocks: z.record(z.string()).optional(),
  hours: z.number().int().min(1).max(25).optional(),
  floor: z.number().optional(),
  /** Carry yesterday's placements so separation reaches across midnight. */
  carry: z.boolean().optional(),
});

/**
 * What the session remembers between requests. Only the last day, on purpose:
 * a session that accumulated days would grow without anybody deciding to.
 */
export class ScheduleSession {
  private last: ScheduleOutcome | undefined;
  private lastDay: BroadcastDay | undefined;

  remember(day: BroadcastDay, outcome: ScheduleOutcome): void {
    this.last = outcome;
    this.lastDay = day;
  }

  outcome(): ScheduleOutcome | undefined {
    return this.last;
  }

  day(): BroadcastDay | undefined {
    return this.lastDay;
  }

  /** Everything the last day placed, for the next day to separate against. */
  carried(): readonly Placed[] {
    return this.last?.day.placed ?? [];
  }

  label(): string {
    const day = this.lastDay;
    return day === undefined
      ? 'no day scheduled'
      : `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
  }
}

function summarise(outcome: ScheduleOutcome): Record<string, unknown> {
  return {
    hours: outcome.day.hours.length,
    placed: outcome.day.placed.length,
    breaches: outcome.day.breaches.length,
    holes: outcome.day.holes.length,
    endsAt: formatDuration(tenths(outcome.day.endsAt)),
    missingClocks: outcome.day.missingClocks.length,
  };
}

export function scheduleRoutes(
  station: StationService,
  schedule: ScheduleService,
  session: ScheduleSession,
): Route[] {
  /** Both readers want the same refusal when nothing has been scheduled yet. */
  const noDay = (request: ApiRequest): ApiResponse<never> =>
    refuse(request, [error(NOT_FOUND, 'schedule', 'has not run in this session yet')]);

  return [
    route({
      op: 'schedule.day',
      summary: 'schedule one broadcast day',
      writes: true,
      params: scheduleSchema,
      answer: (params, request) => {
        const state = station.current();
        const named = params.clock;
        const perHour = params.clocks ?? {};
        if (named === undefined && Object.keys(perHour).length === 0) {
          return refuse(request, [
            error(BAD_PARAMS, 'clock', 'was not given, and neither was a clock for any hour'),
          ]);
        }
        const wanted = new Set([
          ...(named === undefined ? [] : [named]),
          ...Object.values(perHour),
        ]);
        const missing = [...wanted].filter((name) => !state.clocks.has(name)).sort();
        if (missing.length > 0) {
          return refuse(
            request,
            missing.map((name) => error(NOT_FOUND, name, 'is not a defined clock')),
          );
        }
        const clockFor = (hourIndex: number): Clock | undefined => {
          const name = perHour[String(hourIndex)] ?? named;
          return name === undefined ? undefined : state.clocks.get(name);
        };
        const outcome = schedule.scheduleDay(
          state,
          params.day,
          params.weekday,
          clockFor,
          params.carry === true ? session.carried() : [],
          {
            ...(params.hours === undefined ? {} : { hours: params.hours }),
            ...(params.floor === undefined ? {} : { floor: params.floor }),
          },
        );
        session.remember(params.day, outcome);
        return succeed(request, summarise(outcome), outcome.problems);
      },
    }),
    route({
      op: 'schedule.last',
      summary: 'what the last scheduled day came to',
      writes: false,
      params: z.object({}),
      answer: (_params, request) => {
        const outcome = session.outcome();
        return outcome === undefined
          ? noDay(request)
          : succeed(request, { day: session.label(), ...summarise(outcome) });
      },
    }),
    route({
      op: 'schedule.holes',
      summary: 'the slots the last day could not fill, and why',
      writes: false,
      params: z.object({}),
      answer: (_params, request) => {
        const outcome = session.outcome();
        if (outcome === undefined) {
          return noDay(request);
        }
        return succeed(
          request,
          outcome.day.holes.map((hole) => ({
            position: hole.position,
            category: hole.category,
            cause: hole.diagnosis.cause,
          })),
        );
      },
    }),
  ];
}
