import { describe, expect, it } from 'vitest';
import { Check, take } from '../../src/util/check.js';
import { InvariantError } from '../../src/util/assert.js';
import { err, ok } from '../../src/util/result.js';
import { warning } from '../../src/util/problem.js';
import { expectErr, expectOk } from '../support/result.js';

describe('recording problems', () => {
  it('starts ok and with nothing found', () => {
    const check = new Check();
    expect(check.ok).toBe(true);
    expect(check.problems).toEqual([]);
  });

  it('goes not ok on a failure but not on a warning', () => {
    const check = new Check();
    check.warn('A-001', 's', 'm');
    expect(check.ok).toBe(true);
    check.fail('A-002', 's', 'm');
    expect(check.ok).toBe(false);
  });

  it('keeps the detail it was given', () => {
    const check = new Check();
    check.fail('A-001', 's', 'm', { given: 4 });
    expect(check.problems[0]?.detail).toEqual({ given: 4 });
  });

  it('counts by severity', () => {
    const check = new Check();
    check.warn('A-001', 's', 'm');
    check.warn('A-002', 's', 'm');
    check.fail('A-003', 's', 'm');
    expect(check.count('warning')).toBe(2);
    expect(check.count('error')).toBe(1);
    expect(check.count('info')).toBe(0);
  });
});

describe('ensure', () => {
  it('records nothing and returns true when the condition holds', () => {
    const check = new Check();
    expect(check.ensure(true, 'A-001', 's', 'm')).toBe(true);
    expect(check.problems).toEqual([]);
  });

  it('records and returns false when it does not', () => {
    const check = new Check();
    expect(check.ensure(false, 'A-001', 's', 'm', { given: 1 })).toBe(false);
    expect(check.problems[0]?.code).toBe('A-001');
  });
});

describe('require', () => {
  it('returns the value and records nothing on success', () => {
    const check = new Check();
    expect(check.require(ok(42), 'A-001', 's', String)).toBe(42);
    expect(check.problems).toEqual([]);
  });

  it('returns undefined and records the described error on failure', () => {
    const check = new Check();
    expect(
      check.require(err({ reason: 'is empty' }), 'A-001', 'M0001', (e) => e.reason),
    ).toBeUndefined();
    expect(check.problems[0]?.message).toBe('is empty');
    expect(check.problems[0]?.subject).toBe('M0001');
  });

  it('keeps going so every field is checked in one pass', () => {
    const check = new Check();
    check.require(err({ reason: 'a' }), 'A-001', 's', (e) => e.reason);
    check.require(err({ reason: 'b' }), 'A-002', 's', (e) => e.reason);
    check.require(ok(1), 'A-003', 's', String);
    expect(check.problems.map((p) => p.code)).toEqual(['A-001', 'A-002']);
  });
});

describe('absorb', () => {
  it('folds in problems raised elsewhere', () => {
    const check = new Check();
    check.absorb([warning('B-001', 's', 'm')]);
    expect(check.problems).toHaveLength(1);
    expect(check.ok).toBe(true);
  });
});

describe('result', () => {
  it('builds when nothing failed', () => {
    const check = new Check();
    const value = check.require(ok('M0001'), 'A-001', 's', String);
    expect(expectOk(check.result(() => ({ cart: take(value, 'cart') })))).toEqual({
      cart: 'M0001',
    });
  });

  it('returns every problem and never calls the builder when something did', () => {
    const check = new Check();
    let built = 0;
    check.fail('A-001', 's', 'first');
    check.fail('A-002', 's', 'second');
    const outcome = check.result(() => {
      built += 1;
      return 1;
    });
    expect(built).toBe(0);
    expect(expectErr(outcome).map((p) => p.code)).toEqual(['A-001', 'A-002']);
  });

  it('still builds when only warnings were recorded', () => {
    const check = new Check();
    check.warn('A-001', 's', 'm');
    expect(expectOk(check.result(() => 7))).toBe(7);
  });

  it('hands back a copy, so later failures do not change the error', () => {
    const check = new Check();
    check.fail('A-001', 's', 'm');
    const problems = expectErr(check.result(() => 1));
    check.fail('A-002', 's', 'm');
    expect(problems).toHaveLength(1);
  });
});

describe('take', () => {
  it('returns a value that is present, including a falsy one', () => {
    expect(take('x', 'field')).toBe('x');
    expect(take(0, 'field')).toBe(0);
    expect(take(false, 'field')).toBe(false);
  });

  it('throws an invariant error when the check should have stopped first', () => {
    expect(() => take(undefined, 'cart')).toThrow(InvariantError);
    expect(() => take(undefined, 'cart')).toThrow('cart is required');
  });
});
