/**
 * Reports over the envelope.
 *
 * The reports read the day the session last scheduled rather than taking one in
 * the request, which is the only arrangement that makes the loop an operator
 * actually works in cheap: schedule, read the breaches, change something,
 * schedule again.
 *
 * Every report answers with rendered lines rather than a structure. They are
 * printed reports; they have column widths and a page width, and a caller that
 * wanted the numbers instead has the counts in the schedule response already.
 */

import { z } from 'zod';
import { refuse, succeed } from './envelope.js';
import type { ApiRequest, ApiResponse } from './envelope.js';
import type { Route } from './dispatch.js';
import { built, route } from './handler.js';
import { error } from '../util/problem.js';
import { makeDaypart } from '../domain/daypart.js';
import type { CategoryCode } from '../util/ids.js';
import type { Play } from '../rotation/rest.js';
import { breachSummary, renderBreaches } from '../report/breach-report.js';
import { firstRemedy, renderHealth } from '../report/health-report.js';
import type { StationService } from '../service/station-service.js';
import type { ReportService } from '../service/report-service.js';
import { NOT_FOUND } from '../service/guard.js';
import type { ScheduleSession } from './schedule-handlers.js';

const spanSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1),
  fromHour: z.number().int().min(0).max(24),
  toHour: z.number().int().min(0).max(24),
});

const daypartSchema = built(
  z.object({ name: z.string().min(1), spans: z.array(spanSchema).min(1) }),
  (input) => makeDaypart(input.name, input.spans),
);

const healthSchema = z.object({
  dayparts: z.array(daypartSchema).min(1),
  cycles: z.array(z.object({ category: z.string(), hours: z.number() })).default([]),
});

const breachSchema = z.object({
  detailLimit: z.number().int().min(1).optional(),
  summaryOnly: z.boolean().optional(),
});

function noDay(request: ApiRequest): ApiResponse<never> {
  return refuse(request, [error(NOT_FOUND, 'schedule', 'has not run in this session yet')]);
}

export function reportRoutes(
  station: StationService,
  reports: ReportService,
  session: ScheduleSession,
): Route[] {
  return [
    route({
      op: 'report.breaches',
      summary: 'the rules the last day relaxed, grouped by rule',
      writes: false,
      params: breachSchema,
      answer: (params, request) => {
        const outcome = session.outcome();
        if (outcome === undefined) {
          return noDay(request);
        }
        const input = {
          breaches: outcome.day.breaches,
          holes: outcome.day.holes,
          station: station.current().station.callSign,
          period: session.label(),
          ...(params.detailLimit === undefined ? {} : { detailLimit: params.detailLimit }),
        };
        return succeed(request, {
          summary: breachSummary(input),
          lines: params.summaryOnly === true ? [] : renderBreaches(input),
        });
      },
    }),
    route({
      op: 'report.health',
      summary: 'whether the rotation is spread, and what to fix first',
      writes: false,
      params: healthSchema,
      answer: (params, request) => {
        const outcome = session.outcome();
        if (outcome === undefined) {
          return noDay(request);
        }
        const plays: Play[] = outcome.day.placed.map((placed) => ({
          cart: placed.cart,
          at: placed.position,
          cell: placed.cell,
        }));
        const input = {
          plays,
          dayparts: params.dayparts,
          carts: [...new Set(plays.map((play) => play.cart))],
          cycles: params.cycles.map((cycle) => ({
            category: cycle.category as CategoryCode,
            hours: cycle.hours,
          })),
          station: station.current().station.callSign,
          period: session.label(),
        };
        return succeed(request, { remedy: firstRemedy(input), lines: renderHealth(input) });
      },
    }),
    route({
      op: 'report.filings',
      summary: 'what has been filed from this journal, and whether it was filable',
      writes: false,
      params: z.object({}),
      answer: (_params, request) => succeed(request, reports.filingHistory()),
    }),
  ];
}
