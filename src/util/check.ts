/**
 * One place to accumulate problems while building something.
 *
 * Every constructor in the domain had grown the same twelve lines: declare an
 * array, push an error per failing field, then a compound condition repeating
 * every parse result so TypeScript could narrow, then build. The compound
 * condition was the part that kept going wrong, because adding a field meant
 * remembering to add it in two places and nothing failed if you did not.
 *
 * A check does all of it. Parse results go in through `require`, which records
 * the problem and returns undefined, and `result` builds only when nothing was
 * recorded, so the builder can read the values back knowing they are there.
 */

import { required } from './assert.js';
import { error, warning } from './problem.js';
import type { Problem, Severity } from './problem.js';
import { err, ok } from './result.js';
import type { Result } from './result.js';

export class Check {
  private readonly found: Problem[] = [];

  fail(
    code: string,
    subject: string,
    message: string,
    detail?: Readonly<Record<string, string | number>>,
  ): void {
    this.found.push(error(code, subject, message, detail));
  }

  warn(
    code: string,
    subject: string,
    message: string,
    detail?: Readonly<Record<string, string | number>>,
  ): void {
    this.found.push(warning(code, subject, message, detail));
  }

  /** Record a failure unless the condition holds. Returns whether it held. */
  ensure(
    condition: boolean,
    code: string,
    subject: string,
    message: string,
    detail?: Readonly<Record<string, string | number>>,
  ): boolean {
    if (!condition) {
      this.fail(code, subject, message, detail);
    }
    return condition;
  }

  /**
   * Take the value out of a result, recording its error as a problem. Returns
   * undefined on failure, so a caller that needs the value can stop, and a
   * caller that only needs the check recorded can carry on.
   */
  require<T, E>(
    result: Result<T, E>,
    code: string,
    subject: string,
    describe: (error: E) => string,
  ): T | undefined {
    if (result.ok) {
      return result.value;
    }
    this.fail(code, subject, describe(result.error));
    return undefined;
  }

  /** Fold in problems raised somewhere else, such as a nested builder. */
  absorb(problems: readonly Problem[]): void {
    this.found.push(...problems);
  }

  get problems(): readonly Problem[] {
    return this.found;
  }

  get ok(): boolean {
    return !this.found.some((item) => item.severity === 'error');
  }

  count(severity: Severity): number {
    return this.found.filter((item) => item.severity === severity).length;
  }

  /**
   * Build the value, but only if nothing failed. The builder may read back
   * anything `require` returned, through `take`, without a null check.
   */
  result<T>(build: () => T): Result<T, Problem[]> {
    if (!this.ok) {
      return err([...this.found]);
    }
    return ok(build());
  }
}

/**
 * Read a value the check already validated. Throwing here means a builder read
 * a field whose parse failed, which the check should have stopped, so it is an
 * invariant rather than a user facing error.
 */
export function take<T>(value: T | undefined, name: string): T {
  return required(value, name);
}
