import { describe, expect, it } from 'vitest';
import { InvariantError, invariant, required, unreachable } from '../../src/util/assert.js';

describe('invariant', () => {
  it('passes a truthy condition through', () => {
    expect(() => {
      invariant(1 === 1, 'never');
    }).not.toThrow();
  });

  it('throws InvariantError with the message on a falsy condition', () => {
    expect(() => {
      invariant(false, 'clock must have elements');
    }).toThrow(InvariantError);
    expect(() => {
      invariant(0, 'slot count');
    }).toThrow('slot count');
  });

  it('narrows the type after the call', () => {
    const value: string | undefined = 'KHRT';
    invariant(value !== undefined, 'call sign');
    expect(value.length).toBe(4);
  });
});

describe('required', () => {
  it('returns the value when present', () => {
    expect(required('A', 'category')).toBe('A');
    expect(required(0, 'offset')).toBe(0);
    expect(required(false, 'flag')).toBe(false);
  });

  it('rejects undefined and null by name', () => {
    expect(() => required(undefined, 'daypart')).toThrow('daypart is required');
    expect(() => required(null, 'clock')).toThrow('clock is required');
  });
});

describe('unreachable', () => {
  it('reports the offending value and the context', () => {
    expect(() => unreachable('X' as never, 'end type')).toThrow('end type');
    expect(() => unreachable('X' as never, 'end type')).toThrow('"X"');
  });
});
