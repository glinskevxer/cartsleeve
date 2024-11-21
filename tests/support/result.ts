import type { Result } from '../../src/util/result.js';

/** Unwrap a result in a test, failing loudly with the error if it is not ok. */
export function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Unwrap the error side, failing loudly with the value if it succeeded. */
export function expectErr<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    throw new Error(`expected an error, got value ${JSON.stringify(result.value)}`);
  }
  return result.error;
}
