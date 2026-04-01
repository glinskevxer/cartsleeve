/**
 * The request and response envelope.
 *
 * Everything above the service layer talks to it through one shape, so the
 * command line, a batch file of overnight jobs and anything a station group
 * bolts on later all get the same answers and the same refusals.
 *
 * The envelope carries problems on a success as well as on a failure, and that
 * is the whole reason it exists rather than a plain return value. A scheduling
 * run that fills every slot but relaxes a separation rule twice has succeeded
 * and has two things the music director needs to see. An envelope that only
 * carried problems when it failed would throw both away, and the operator would
 * find out on the air.
 */

import { z } from 'zod';
import { error } from '../util/problem.js';
import type { Problem, Severity } from '../util/problem.js';
import { atLeast, hasErrors } from '../util/problem.js';
import type { Result } from '../util/result.js';

const API = (n: number): string => `API${String(n).padStart(3, '0')}`;

export const MALFORMED = API(10);
export const UNKNOWN_OP = API(11);
export const BAD_PARAMS = API(12);
export const HANDLER_THREW = API(13);

export interface ApiRequest {
  readonly op: string;
  /** The caller's own id, echoed back so a batch can pair up its answers. */
  readonly id: string;
  /** Milliseconds. Every write is stamped with the caller's clock, not ours. */
  readonly at: number;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ApiResponse<T> {
  readonly ok: boolean;
  readonly op: string;
  readonly id: string;
  readonly at: number;
  readonly data?: T;
  readonly problems: readonly Problem[];
}

const requestSchema = z.object({
  op: z.string().min(1),
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
  params: z.record(z.unknown()).default({}),
});

function issueSubject(path: readonly (string | number)[]): string {
  return path.length === 0 ? 'request' : path.join('.');
}

/**
 * Read an envelope off the wire. The caller's id is not available when the
 * request will not parse, so a malformed one comes back with an empty id rather
 * than a made up one, and the caller matches it by position.
 */
export function parseRequest(raw: unknown): Result<ApiRequest, Problem[]> {
  const parsed = requestSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    error: parsed.error.issues.map((issue) =>
      error(MALFORMED, issueSubject(issue.path), issue.message, { kind: issue.code }),
    ),
  };
}

/** An answer that worked, carrying anything worth saying about how it worked. */
export function succeed<T>(
  request: ApiRequest,
  data: T,
  problems: readonly Problem[] = [],
): ApiResponse<T> {
  return { ok: true, op: request.op, id: request.id, at: request.at, data, problems };
}

/** An answer that did not work. There is no data on a refusal, by construction. */
export function refuse<T>(request: ApiRequest, problems: readonly Problem[]): ApiResponse<T> {
  return { ok: false, op: request.op, id: request.id, at: request.at, problems };
}

/**
 * Turn a service result into a response. Services already report failure as a
 * list of problems, so this is the only place the two vocabularies meet.
 */
export function fromResult<T>(
  request: ApiRequest,
  result: Result<T, readonly Problem[]>,
  warnings: readonly Problem[] = [],
): ApiResponse<T> {
  return result.ok ? succeed(request, result.value, warnings) : refuse(request, result.error);
}

/** The problems on a response at or above a floor, for a quiet command line. */
export function problemsAtLeast(
  response: ApiResponse<unknown>,
  floor: Severity,
): readonly Problem[] {
  return atLeast(response.problems, floor);
}

/**
 * Whether an answer is worth acting on. A response can be ok and still carry
 * errors if a handler reports one it recovered from, so this asks both.
 */
export function isClean(response: ApiResponse<unknown>): boolean {
  return response.ok && !hasErrors(response.problems);
}

export function unknownOp(request: ApiRequest, known: readonly string[]): ApiResponse<never> {
  const near = nearestOp(request.op, known);
  return refuse(request, [
    error(
      UNKNOWN_OP,
      request.op,
      near === undefined ? 'is not an operation' : `is not an operation, did you mean ${near}`,
      { known: known.length },
    ),
  ]);
}

/**
 * The closest known operation, if one is close enough to be a typo rather than
 * a different request. Cheap to compute and it saves a support call.
 */
export function nearestOp(op: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    const distance = editDistance(op, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= Math.max(2, Math.floor(op.length / 3)) ? best : undefined;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current.push(Math.min(substitution, deletion, insertion));
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}
