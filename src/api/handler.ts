/**
 * What every handler was doing by hand.
 *
 * Four files of handlers had the same eight lines at the top of every one of
 * them: parse the params, turn the schema issues into problems, refuse. Then in
 * the middle, parse the cart number, refuse. Then parse the category code,
 * refuse. Then build the domain value, refuse. Then call the service and turn
 * its result into a response.
 *
 * All of that except the service call is parsing, and parsing belongs in the
 * schema. So a cart number is a schema that yields a CartNumber, a cart is a
 * schema that yields a Cart, and a handler receives values that are already
 * what they claim to be. The early returns go with them, which is the real
 * gain: there were eleven of them and every one was a chance to refuse without
 * saying why, or worse, to carry on.
 *
 * The one thing worth keeping from the hand written version is the diagnostic
 * code. A domain builder refusing a runtime says LIB030 and an operator can
 * look that up, so the code rides along on the schema issue and is put back on
 * the problem at the other end rather than being flattened to "bad params".
 */

import { z } from 'zod';
import { BAD_PARAMS, refuse, succeed } from './envelope.js';
import type { ApiRequest, ApiResponse } from './envelope.js';
import type { Route } from './dispatch.js';
import { error } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { Result } from '../util/result.js';
import type { IdProblem } from '../util/ids.js';

/**
 * A schema that allows a field to be missing yields an object with the key
 * present and the value undefined, and the domain builders are compiled with
 * exact optional properties, which is not the same thing. Dropping the empty
 * keys is the difference between "the caller said nothing" and "the caller said
 * nothing on purpose", and the builders read the first one.
 */
export type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

export function defined<T extends Record<string, unknown>>(value: T): Defined<T> {
  const kept: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      kept[key] = item;
    }
  }
  return kept as Defined<T>;
}

function subjectOf(path: readonly (string | number)[]): string {
  return path.length === 0 ? 'params' : path.join('.');
}

function codeOf(issue: z.ZodIssue): string {
  if (issue.code !== z.ZodIssueCode.custom) {
    return BAD_PARAMS;
  }
  const carried: unknown = (issue.params as Record<string, unknown> | undefined)?.['code'];
  return typeof carried === 'string' ? carried : BAD_PARAMS;
}

/** Schema issues as problems, keeping the domain code where there was one. */
export function paramProblems(issues: readonly z.ZodIssue[]): Problem[] {
  return issues.map((issue) => error(codeOf(issue), subjectOf(issue.path), issue.message));
}

/** A string field that yields a branded id, refusing the ones that are not. */
export function idField<T>(
  parse: (raw: string) => Result<T, IdProblem>,
): z.ZodType<T, z.ZodTypeDef, string> {
  return z.string().transform((raw, ctx) => {
    const parsed = parse(raw);
    if (parsed.ok) {
      return parsed.value;
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error.reason });
    return z.NEVER;
  });
}

/**
 * A field that yields a built domain value. Every problem the builder reported
 * becomes an issue, so a cart with a bad runtime and no title is refused once
 * with both reasons rather than twice with one each.
 */
export function built<In, Out>(
  schema: z.ZodType<In, z.ZodTypeDef, unknown>,
  build: (input: In) => Result<Out, readonly Problem[]>,
): z.ZodType<Out, z.ZodTypeDef, unknown> {
  return schema.transform((input, ctx) => {
    const outcome = build(input);
    if (outcome.ok) {
      return outcome.value;
    }
    for (const problem of outcome.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${problem.subject} ${problem.message}`,
        params: { code: problem.code },
      });
    }
    return z.NEVER;
  });
}

export type Answer<P> = (params: P, request: ApiRequest) => ApiResponse<unknown>;

export interface RouteSpec<S extends z.ZodType<unknown, z.ZodTypeDef, unknown>> {
  readonly op: string;
  readonly summary: string;
  readonly writes: boolean;
  /**
   * The schema, or a schema built from the request. One operation needs the
   * second form: reading a release year is only meaningful against the caller's
   * own clock, and the clock arrives with the request.
   */
  readonly params: S | ((request: ApiRequest) => S);
  readonly answer: Answer<z.infer<S>>;
}

/** Build a route whose handler never sees an unparsed param. */
export function route<S extends z.ZodType<unknown, z.ZodTypeDef, unknown>>(
  spec: RouteSpec<S>,
): Route {
  return {
    op: spec.op,
    summary: spec.summary,
    writes: spec.writes,
    handler: (request: ApiRequest): ApiResponse<unknown> => {
      const schema = typeof spec.params === 'function' ? spec.params(request) : spec.params;
      const parsed = schema.safeParse(request.params);
      if (!parsed.success) {
        return refuse(request, paramProblems(parsed.error.issues));
      }
      return spec.answer(parsed.data as z.infer<S>, request);
    },
  };
}

/** A service result as a response, with the body the caller wants on success. */
export function answering<T, U>(
  request: ApiRequest,
  result: Result<T, readonly Problem[]>,
  body: (value: T) => U,
  warnings: readonly Problem[] = [],
): ApiResponse<U> {
  return result.ok ? succeed(request, body(result.value), warnings) : refuse(request, result.error);
}

/** The params of an operation that takes none. */
export const NO_PARAMS = z.object({}).passthrough();
