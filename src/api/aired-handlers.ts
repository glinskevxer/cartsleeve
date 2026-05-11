/**
 * What actually aired, and what gets filed.
 *
 * The last two things the station does with a day, and until now the only two
 * it could not do through the api. Both take the automation's own account of the
 * hour, which is a stream of starts and ends with no obligation to agree with
 * anything the scheduler decided.
 *
 * Reconciliation compares the two and says what was dropped, what ran that
 * nobody scheduled, and how far the timing slipped. The filing goes further and
 * ignores the schedule entirely: a performance report is a list of what was
 * broadcast, so it is built from the rebuild rather than from the log, and a
 * cart that never aired is worth nothing to it however carefully it was placed.
 */

import { z } from 'zod';
import { refuse, succeed } from './envelope.js';
import type { ApiRequest, ApiResponse } from './envelope.js';
import type { Route } from './dispatch.js';
import { built, defined, route } from './handler.js';
import { error } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { toMillis } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { makeEvent, makeEventStream } from '../aired/event.js';
import { measured, rebuildAired } from '../aired/rebuild.js';
import type { PlannedStart } from '../aired/timing.js';
import { NOT_FOUND } from '../service/guard.js';
import type { ReportService } from '../service/report-service.js';
import type { StationService } from '../service/station-service.js';
import type { ScheduleSession } from './schedule-handlers.js';

const eventSchema = built(
  z.object({
    kind: z.string(),
    cart: z.string(),
    at: z.number(),
    note: z.string().optional(),
    position: z.number().int().optional(),
  }),
  (input) => makeEvent(defined(input)),
);

const daySchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

const reconcileSchema = z.object({
  events: z.array(eventSchema).min(1),
  hour: z.string().min(1),
});

const fileSchema = z.object({
  events: z.array(eventSchema).min(1),
  period: z.object({ from: daySchema, to: daySchema, label: z.string().min(1) }),
});

/**
 * When each placement was meant to start, in milliseconds.
 *
 * The day's own times are tenths from the top of the broadcast day, and the
 * automation reports wall clock milliseconds. The base is the caller's clock
 * rather than the calendar, because a reconciliation is run against the log the
 * automation just sent and the two have to share an origin or every deviation
 * comes out as the offset between them.
 */
export function plannedFrom(
  placed: readonly { cart: PlannedStart['cart']; position: number; at: Tenths }[],
  base: number,
): PlannedStart[] {
  return placed.map((item) => ({
    cart: item.cart,
    position: item.position,
    at: base + toMillis(item.at),
  }));
}

export function airedRoutes(
  station: StationService,
  reports: ReportService,
  session: ScheduleSession,
): Route[] {
  const noDay = (request: ApiRequest): ApiResponse<never> =>
    refuse(request, [error(NOT_FOUND, 'schedule', 'has not run in this session yet')]);

  return [
    route({
      op: 'aired.reconcile',
      summary: 'compare the last day against what the automation says aired',
      writes: true,
      params: reconcileSchema,
      answer: (params, request) => {
        const outcome = session.outcome();
        const day = session.day();
        if (outcome === undefined || day === undefined) {
          return noDay(request);
        }
        const stream = makeEventStream(params.events);
        const result = reports.reconcileHour({
          planned: plannedFrom(outcome.day.placed, request.at),
          stream,
          library: station.current().library,
          station: station.current().station.callSign,
          day,
          hour: params.hour,
        });
        return succeed(
          request,
          {
            dropped: result.reconciliation.dropped.length,
            unscheduled: result.reconciliation.unscheduled.length,
            lines: result.lines,
          },
          result.problems,
        );
      },
    }),
    route({
      op: 'royalty.file',
      summary: 'build the performance report from what aired',
      writes: true,
      params: fileSchema,
      answer: (params, request) => {
        const state = station.current();
        const rebuild = rebuildAired(makeEventStream(params.events));
        const airings = measured(rebuild);
        if (airings.length === 0) {
          return refuse(request, [
            error(NOT_FOUND, params.period.label, 'has nothing in it that finished airing'),
          ]);
        }
        const result = reports.buildFiling({
          airings,
          library: state.library,
          station: state.station.callSign,
          period: params.period,
          policy: state.station.creditPolicy,
        });
        const problems: Problem[] = [...rebuild.problems, ...result.problems];
        return succeed(
          request,
          {
            recordings: result.report.recordings,
            spins: result.report.totalSpins,
            filable: result.validation.filable ? 'yes' : 'no',
            lines: result.lines,
          },
          problems,
        );
      },
    }),
  ];
}
