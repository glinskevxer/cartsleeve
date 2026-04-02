/**
 * Clock operations over the envelope.
 *
 * A clock is the one thing an operator edits that changes the sound of the
 * station without touching a single cart, so these handlers are more careful
 * than the library ones in one respect: replacing a clock reports what the
 * replacement did to the hour, not just that it worked.
 *
 * The music count and the stopset budget are returned on every write because
 * they are what a music director checks after an edit, and making them ask for
 * them in a second request means half the time they will not.
 */

import { z } from 'zod';
import { BAD_PARAMS, refuse, succeed } from './envelope.js';
import type { ApiRequest, ApiResponse } from './envelope.js';
import type { Route } from './dispatch.js';
import { error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import {
  HOUR_TENTHS,
  categoryDemand,
  describeElement,
  makeClock,
  musicCount,
  stopsetBudget,
} from '../domain/clock.js';
import type { Clock } from '../domain/clock.js';
import { formatDuration } from '../util/duration.js';
import type { StationService } from '../service/station-service.js';
import { NOT_FOUND } from '../service/guard.js';

const elementSchema = z.object({
  kind: z.enum(['music', 'fixed', 'stopset', 'news']),
  target: z.string(),
  category: z.string().optional(),
  cart: z.string().optional(),
  name: z.string().optional(),
  budget: z.string().optional(),
  length: z.string().optional(),
  noOpen: z.boolean().optional(),
  noClose: z.boolean().optional(),
});

const clockSchema = z.object({
  name: z.string().min(1),
  elements: z.array(elementSchema).min(1),
});

const nameSchema = z.object({ name: z.string().min(1) });

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

function defined<T extends Record<string, unknown>>(value: T): Defined<T> {
  const kept: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      kept[key] = item;
    }
  }
  return kept as Defined<T>;
}

function paramProblems(issues: readonly z.ZodIssue[]): Problem[] {
  return issues.map((issue) =>
    error(BAD_PARAMS, issue.path.length === 0 ? 'params' : issue.path.join('.'), issue.message),
  );
}

/** What the operator wants to see after an edit, without asking twice. */
function describeClock(clock: Clock): Record<string, unknown> {
  return {
    name: clock.name,
    elements: clock.elements.length,
    music: musicCount(clock),
    stopsetBudget: formatDuration(stopsetBudget(clock)),
    categories: [...categoryDemand(clock)].map(([code, count]) => `${code}x${count}`).join(' '),
  };
}

/**
 * A clock that leaves the hour short is legal and is sometimes what the
 * operator meant, so it is a warning on a success rather than a refusal.
 */
function shortHourWarning(clock: Clock): Problem[] {
  const music = musicCount(clock);
  if (music > 0) {
    return [];
  }
  return [warning(BAD_PARAMS, clock.name, 'has no music element and will fill nothing')];
}

export function clockRoutes(service: StationService): Route[] {
  return [
    {
      op: 'clock.add',
      summary: 'define a clock',
      writes: true,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = clockSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const clock = makeClock(
          params.data.name,
          params.data.elements.map((element) => defined(element)),
        );
        if (!clock.ok) {
          return refuse(request, clock.error);
        }
        const added = service.addClock(clock.value, request.at);
        return added.ok
          ? succeed(request, describeClock(clock.value), shortHourWarning(clock.value))
          : refuse(request, added.error);
      },
    },
    {
      op: 'clock.replace',
      summary: 'replace a clock, which changes every hour that runs it',
      writes: true,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = clockSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const clock = makeClock(
          params.data.name,
          params.data.elements.map((element) => defined(element)),
        );
        if (!clock.ok) {
          return refuse(request, clock.error);
        }
        const before = service.current().clocks.get(params.data.name);
        const replaced = service.replaceClock(clock.value, request.at);
        if (!replaced.ok) {
          return refuse(request, replaced.error);
        }
        return succeed(
          request,
          {
            ...describeClock(clock.value),
            musicWas: before === undefined ? 0 : musicCount(before),
          },
          shortHourWarning(clock.value),
        );
      },
    },
    {
      op: 'clock.get',
      summary: 'read one clock and its elements',
      writes: false,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = nameSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const clock = service.current().clocks.get(params.data.name);
        if (clock === undefined) {
          return refuse(request, [error(NOT_FOUND, params.data.name, 'is not a defined clock')]);
        }
        return succeed(request, {
          ...describeClock(clock),
          lines: clock.elements.map((element) => describeElement(element)),
        });
      },
    },
    {
      op: 'clock.list',
      summary: 'list the clocks the station has',
      writes: false,
      handler: (request: ApiRequest): ApiResponse<unknown> =>
        succeed(
          request,
          [...service.current().clocks.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((clock) => describeClock(clock)),
        ),
    },
    {
      op: 'clock.hour',
      summary: 'the length of an hour, for a caller checking its arithmetic',
      writes: false,
      handler: (request: ApiRequest): ApiResponse<unknown> =>
        succeed(request, { tenths: HOUR_TENTHS, length: formatDuration(HOUR_TENTHS) }),
    },
  ];
}
