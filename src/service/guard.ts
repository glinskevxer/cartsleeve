/**
 * The check every service operation starts with.
 *
 * Six operations on the station service opened with a variation on the same four
 * lines: look the thing up, build an error naming it, wrap it in an array,
 * return it. The variations were not deliberate. Two of them said "is not in the
 * library" about a category, one built the problem with a different code than
 * the others, and the array wrapping was inconsistent enough that a caller could
 * not rely on the shape.
 *
 * Stating the guard once fixes all of that and makes the operations read as what
 * they actually are: a precondition and a change.
 */

import { codeFor, error } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';

const GRD = (n: number): string => codeFor('store', n);

export const NOT_FOUND = GRD(30);
export const ALREADY_THERE = GRD(31);

/** Require that something is there, and hand it back if it is. */
export function requirePresent<T>(
  value: T | undefined,
  subject: string,
  what: string,
): Result<T, Problem[]> {
  if (value === undefined) {
    return err([error(NOT_FOUND, subject, `is not ${what}`)]);
  }
  return ok(value);
}

/** Require that something is not there yet. */
export function requireAbsent(
  present: boolean,
  subject: string,
  what: string,
): Result<true, Problem[]> {
  if (present) {
    return err([error(ALREADY_THERE, subject, `is already ${what}`)]);
  }
  return ok(true);
}

/** Every problem from a guard, so a caller can gather several at once. */
export function problemsOf(results: readonly Result<unknown, Problem[]>[]): Problem[] {
  return results.flatMap((result) => (result.ok ? [] : result.error));
}
