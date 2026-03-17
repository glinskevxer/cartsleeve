import { describe, expect, it } from 'vitest';
import {
  ALREADY_THERE,
  NOT_FOUND,
  problemsOf,
  requireAbsent,
  requirePresent,
} from '../../src/service/guard.js';
import { expectErr, expectOk } from '../support/result.js';

describe('requirePresent', () => {
  it('hands back a value that is there', () => {
    expect(expectOk(requirePresent('M0001', 'M0001', 'in the library'))).toBe('M0001');
  });

  it('hands back a falsy value that is there', () => {
    expect(expectOk(requirePresent(0, 'count', 'set'))).toBe(0);
    expect(expectOk(requirePresent(false, 'flag', 'set'))).toBe(false);
  });

  it('refuses an absent value, naming it and what was wanted', () => {
    const problems = expectErr(requirePresent(undefined, 'M0001', 'in the library'));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe(NOT_FOUND);
    expect(problems[0]?.subject).toBe('M0001');
    expect(problems[0]?.message).toBe('is not in the library');
  });
});

describe('requireAbsent', () => {
  it('passes when nothing is there', () => {
    expect(expectOk(requireAbsent(false, 'M0001', 'in the library'))).toBe(true);
  });

  it('refuses when something already is', () => {
    const problems = expectErr(requireAbsent(true, 'M0001', 'in the library'));
    expect(problems[0]?.code).toBe(ALREADY_THERE);
    expect(problems[0]?.message).toBe('is already in the library');
  });

  it('gives the two guards different codes', () => {
    expect(NOT_FOUND).not.toBe(ALREADY_THERE);
  });
});

describe('problemsOf', () => {
  it('gathers the problems of several guards', () => {
    const problems = problemsOf([
      requirePresent(undefined, 'a', 'there'),
      requireAbsent(true, 'b', 'there'),
      requirePresent('c', 'c', 'there'),
    ]);
    expect(problems).toHaveLength(2);
    expect(problems.map((each) => each.subject)).toEqual(['a', 'b']);
  });

  it('gathers nothing when every guard passed', () => {
    expect(problemsOf([requirePresent('a', 'a', 'there')])).toEqual([]);
    expect(problemsOf([])).toEqual([]);
  });
});
