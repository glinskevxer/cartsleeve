/** Invariants that hold by construction. A failure here is a bug in cartsleeve. */

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new InvariantError(message);
  }
}

export function unreachable(value: never, context: string): never {
  throw new InvariantError(`${context}: unreachable value ${JSON.stringify(value)}`);
}

export function required<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) {
    throw new InvariantError(`${name} is required`);
  }
  return value;
}
