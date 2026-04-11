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
import { BAD_PARAMS, refuse, succeed } from './envelope.js';
import type { ApiRequest, ApiResponse } from './envelope.js';
import type { Route } from './dispatch.js';
import { error } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { makeDaypart } from '../domain/daypart.js';
import type { Daypart } from '../domain/daypart.js';
import type { CartNumber, CategoryCode } from '../util/ids.js';
import type { Play } from '../rotation/rest.js';
import { breachSummary, renderBreaches } from '../report/breach-report.js';
import { firstRemedy, renderHealth } from '../report/health-report.js';
import type { CycleLength } from '../report/health-report.js';
import type { StationService } from '../service/station-service.js';
import type { ReportService } from '../service/report-service.js';
import { NOT_FOUND } from '../service/guard.js';
import type { ScheduleSession } from './schedule-handlers.js';

const spanSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1),
  fromHour: z.number().int().min(0).max(24),
  toHour: z.number().int().min(0).max(24),
});

const healthSchema = z.object({
  dayparts: z
    .array(z.object({ name: z.string().min(1), spans: z.array(spanSchema).min(1) }))
    .min(1),
  cycles: z.array(z.object({ category: z.string(), hours: z.number() })).default([]),
});

const breachSchema = z.object({
  detailLimit: z.number().int().min(1).optional(),
  summaryOnly: z.boolean().optional(),
});

function paramProblems(issues: readonly z.ZodIssue[]): Problem[] {
  return issues.map((issue) =>
    error(BAD_PARAMS, issue.path.length === 0 ? 'params' : issue.path.join('.'), issue.message),
  );
}

function noDay(request: ApiRequest): ApiResponse<never> {
  return refuse(request, [error(NOT_FOUND, 'schedule', 'has not run in this session yet')]);
}

export function reportRoutes(
  station: StationService,
  reports: ReportService,
  session: ScheduleSession,
): Route[] {
  return [
    {
      op: 'report.breaches',
      summary: 'the rules the last day relaxed, grouped by rule',
      writes: false,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const outcome = session.outcome();
        if (outcome === undefined) {
          return noDay(request);
        }
        const params = breachSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const input = {
          breaches: outcome.day.breaches,
          holes: outcome.day.holes,
          station: station.current().station.callSign,
          period: session.label(),
          ...(params.data.detailLimit === undefined
            ? {}
            : { detailLimit: params.data.detailLimit }),
        };
        return succeed(request, {
          summary: breachSummary(input),
          lines: params.data.summaryOnly === true ? [] : renderBreaches(input),
        });
      },
    },
    {
      op: 'report.health',
      summary: 'whether the rotation is spread, and what to fix first',
      writes: false,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const outcome = session.outcome();
        if (outcome === undefined) {
          return noDay(request);
        }
        const params = healthSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const dayparts: Daypart[] = [];
        const problems: Problem[] = [];
        for (const spec of params.data.dayparts) {
          const built = makeDaypart(spec.name, spec.spans);
          if (built.ok) {
            dayparts.push(built.value);
          } else {
            problems.push(...built.error);
          }
        }
        if (problems.length > 0) {
          return refuse(request, problems);
        }
        const plays: Play[] = outcome.day.placed.map((placed) => ({
          cart: placed.cart,
          at: placed.position,
          cell: placed.cell,
        }));
        const carts = [...new Set(plays.map((play) => play.cart))] as CartNumber[];
        const cycles: CycleLength[] = params.data.cycles.map((cycle) => ({
          category: cycle.category as CategoryCode,
          hours: cycle.hours,
        }));
        const input = {
          plays,
          dayparts,
          carts,
          cycles,
          station: station.current().station.callSign,
          period: session.label(),
        };
        return succeed(request, { remedy: firstRemedy(input), lines: renderHealth(input) });
      },
    },
    {
      op: 'report.filings',
      summary: 'what has been filed from this journal, and whether it was filable',
      writes: false,
      handler: (request: ApiRequest): ApiResponse<unknown> =>
        succeed(request, reports.filingHistory()),
    },
  ];
}
