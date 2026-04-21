/**
 * Traffic over the envelope.
 *
 * This is the operation the traffic layer exists for, so it is worth saying
 * what it does rather than what it is called. The music pass built the day
 * against each break's budgeted length. Traffic then says what actually sold,
 * and almost no break comes out at budget. The merge puts the real lengths in
 * and everything after each break moves. Separation is a wall clock rule, so a
 * pair that cleared forty five minutes on the budget can be under it on the log
 * that airs, and no amount of care in the music pass could have seen it.
 *
 * So the answer to a merge is not "it worked". It is how far the day drifted,
 * and which rules are breached now that were not breached before. The second
 * number is the one that gets a record moved before air.
 */

import { z } from 'zod';
import { succeed } from './envelope.js';
import type { ApiResponse } from './envelope.js';
import type { ApiRequest } from './envelope.js';
import type { Route } from './dispatch.js';
import { built, route } from './handler.js';
import { refuse } from './envelope.js';
import { error } from '../util/problem.js';
import { COMMA, PIPE, TAB } from '../util/delimited.js';
import type { DelimitedOptions } from '../util/delimited.js';
import { formatDuration, tenths } from '../util/duration.js';
import { readTrafficLog, breakNames, hoursUsed, spotsFor } from '../traffic/log-reader.js';
import type { TrafficLog } from '../traffic/log-reader.js';
import { mergeDay } from '../traffic/day-merge.js';
import { mergedMusic, worstMove } from '../traffic/merge.js';
import { newlyBreached, remeasure } from '../traffic/remeasure.js';
import type { MergedSlot } from '../traffic/merge.js';
import { standardRuleSet } from '../rules/tiers.js';
import { makeScheduleView } from '../rules/schedule-view.js';
import type { Placed, RuleContext, Slot } from '../rules/rule.js';
import { NO_RESTRICTIONS } from '../library/restriction.js';
import { NO_WINDOWS } from '../library/window.js';
import { EMPTY_SOUND_INDEX } from '../library/sounds.js';
import { fallbackEras } from '../service/schedule-service.js';
import { NOT_FOUND } from '../service/guard.js';
import type { StationService } from '../service/station-service.js';
import type { ScheduleSession } from './schedule-handlers.js';

const DELIMITERS: Record<string, DelimitedOptions> = {
  comma: COMMA,
  pipe: PIPE,
  tab: TAB,
};

const logSchema = built(
  z.object({
    text: z.string().min(1),
    delimiter: z.enum(['comma', 'pipe', 'tab']).default('comma'),
  }),
  (input) => readTrafficLog(input.text, { delimiter: DELIMITERS[input.delimiter] ?? COMMA }),
);

const mergeSchema = z.object({
  log: logSchema,
  /** The tier the music pass settled at, so nothing already relaxed is counted. */
  tier: z.number().int().min(0).default(0),
  allowOverfill: z.boolean().optional(),
});

function describeLog(log: TrafficLog): Record<string, unknown> {
  return {
    spots: log.spots.length,
    lines: log.linesRead,
    hours: hoursUsed(log).join(' '),
    breaks: breakNames(log).join(' '),
  };
}

export function trafficRoutes(station: StationService, session: ScheduleSession): Route[] {
  const noDay = (request: ApiRequest): ApiResponse<never> =>
    refuse(request, [error(NOT_FOUND, 'schedule', 'has not run in this session yet')]);

  return [
    route({
      op: 'traffic.load',
      summary: 'read a traffic log and say what is in it',
      writes: false,
      params: z.object({ log: logSchema }),
      answer: (params, request) => succeed(request, describeLog(params.log), params.log.problems),
    }),
    route({
      op: 'traffic.merge',
      summary: 'put the real break lengths into the last day and remeasure the rules',
      writes: false,
      params: mergeSchema,
      answer: (params, request) => {
        const outcome = session.outcome();
        if (outcome === undefined) {
          return noDay(request);
        }
        const state = station.current();
        const merged = mergeDay({
          hours: outcome.day.hours,
          dayStartHour: state.station.dayStartHour,
          spotsFor: (clockHour, breakName) => spotsFor(params.log, clockHour, breakName),
          ...(params.allowOverfill === undefined ? {} : { allowOverfill: params.allowOverfill }),
        });
        const slots: MergedSlot[] = merged.hours.flatMap((hour) => mergedMusic(hour.outcome));
        const checked = remeasure({
          slots,
          rules: standardRuleSet(NO_RESTRICTIONS, NO_WINDOWS),
          tier: params.tier,
          contextFor: (slot: Slot, placed: Placed): RuleContext => ({
            station: state.station,
            categories: state.categories,
            sounds: EMPTY_SOUND_INDEX,
            eras: fallbackEras(),
            // remeasure builds the real view from the other placements.
            schedule: makeScheduleView([]),
            slot,
            candidate: placed.entry,
          }),
        });
        const caused = newlyBreached(outcome.day.breaches, checked.breaches);
        const worst = merged.hours.reduce(
          (most, hour) => Math.max(most, Math.abs(worstMove(hour.outcome))),
          0,
        );
        return succeed(
          request,
          {
            day: session.label(),
            spots: params.log.spots.length,
            hours: merged.hours.length,
            music: slots.length,
            drifted: formatDuration(tenths(Math.abs(merged.driftedBy))),
            worstMove: formatDuration(tenths(worst)),
            breachesBefore: outcome.day.breaches.length,
            breachesAfter: checked.breaches.length,
            causedByTraffic: caused.length,
          },
          [...params.log.problems, ...merged.problems, ...checked.problems],
        );
      },
    }),
  ];
}
