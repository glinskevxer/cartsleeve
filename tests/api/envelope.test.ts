import { describe, expect, it } from 'vitest';
import {
  BAD_PARAMS,
  MALFORMED,
  UNKNOWN_OP,
  fromResult,
  isClean,
  nearestOp,
  parseRequest,
  problemsAtLeast,
  refuse,
  succeed,
  unknownOp,
} from '../../src/api/envelope.js';
import type { ApiRequest } from '../../src/api/envelope.js';
import { error, warning } from '../../src/util/problem.js';
import { err, ok } from '../../src/util/result.js';
import { expectErr, expectOk } from '../support/result.js';

const REQUEST: ApiRequest = {
  op: 'library.add',
  id: 'r1',
  at: 1_700_000_000_000,
  params: { cart: 'M0001' },
};

describe('parseRequest', () => {
  it('reads a well formed envelope', () => {
    const parsed = expectOk(
      parseRequest({ op: 'library.add', id: 'r1', at: 12, params: { cart: 'M0001' } }),
    );
    expect(parsed.op).toBe('library.add');
    expect(parsed.id).toBe('r1');
    expect(parsed.at).toBe(12);
    expect(parsed.params['cart']).toBe('M0001');
  });

  it('defaults the params to an empty object', () => {
    const parsed = expectOk(parseRequest({ op: 'station.state', id: 'r2', at: 0 }));
    expect(parsed.params).toEqual({});
  });

  it('refuses an envelope with no operation', () => {
    const problems = expectErr(parseRequest({ id: 'r3', at: 0 }));
    expect(problems.every((item) => item.code === MALFORMED)).toBe(true);
    expect(problems.some((item) => item.subject === 'op')).toBe(true);
  });

  it('names every field that is wrong, not just the first', () => {
    const problems = expectErr(parseRequest({ op: '', id: '', at: -1 }));
    const subjects = problems.map((item) => item.subject);
    expect(subjects).toContain('op');
    expect(subjects).toContain('id');
    expect(subjects).toContain('at');
  });

  it('refuses a fractional timestamp rather than rounding it', () => {
    const problems = expectErr(parseRequest({ op: 'a', id: 'b', at: 1.5 }));
    expect(problems.some((item) => item.subject === 'at')).toBe(true);
  });

  it('refuses something that is not an object at all', () => {
    expect(parseRequest('library.add').ok).toBe(false);
    expect(parseRequest(null).ok).toBe(false);
    expect(parseRequest([]).ok).toBe(false);
  });

  it('names the whole request when nothing about it is readable', () => {
    const problems = expectErr(parseRequest(7));
    expect(problems[0]?.subject).toBe('request');
  });
});

describe('succeed', () => {
  it('echoes the operation and the caller id', () => {
    const response = succeed(REQUEST, { cart: 'M0001' });
    expect(response.ok).toBe(true);
    expect(response.op).toBe('library.add');
    expect(response.id).toBe('r1');
    expect(response.at).toBe(REQUEST.at);
  });

  it('carries warnings on an answer that worked', () => {
    const response = succeed(REQUEST, 1, [warning('SCH900', 'hour 6', 'relaxed a separation')]);
    expect(response.ok).toBe(true);
    expect(response.problems).toHaveLength(1);
  });
});

describe('refuse', () => {
  it('carries no data', () => {
    const response = refuse(REQUEST, [error(BAD_PARAMS, 'cart', 'is not a cart number')]);
    expect(response.ok).toBe(false);
    expect(response.data).toBeUndefined();
    expect(response.problems).toHaveLength(1);
  });
});

describe('fromResult', () => {
  it('passes a service success through with its warnings', () => {
    const response = fromResult(REQUEST, ok(4), [warning('LIB900', 'M0001', 'has no ISRC')]);
    expect(response.ok).toBe(true);
    expect(response.data).toBe(4);
    expect(response.problems).toHaveLength(1);
  });

  it('passes a service failure through as a refusal', () => {
    const response = fromResult(REQUEST, err([error('LIB030', 'M0001', 'is not in the library')]));
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.code).toBe('LIB030');
  });

  it('drops the warnings on a failure, because there is nothing to warn about', () => {
    const response = fromResult(REQUEST, err([error('LIB030', 'M0001', 'is missing')]), [
      warning('LIB900', 'M0001', 'has no ISRC'),
    ]);
    expect(response.problems).toHaveLength(1);
  });
});

describe('isClean', () => {
  it('is true for a success with nothing to say', () => {
    expect(isClean(succeed(REQUEST, 1))).toBe(true);
  });

  it('is true for a success carrying only warnings', () => {
    expect(isClean(succeed(REQUEST, 1, [warning('SCH900', 'hour 6', 'relaxed')]))).toBe(true);
  });

  it('is false for a success carrying an error a handler recovered from', () => {
    expect(isClean(succeed(REQUEST, 1, [error('SCH901', 'hour 6', 'left a hole')]))).toBe(false);
  });

  it('is false for a refusal', () => {
    expect(isClean(refuse(REQUEST, []))).toBe(false);
  });
});

describe('problemsAtLeast', () => {
  it('filters an answer down to what an operator asked to see', () => {
    const response = succeed(REQUEST, 1, [
      warning('SCH900', 'hour 6', 'relaxed'),
      error('SCH901', 'hour 7', 'left a hole'),
    ]);
    expect(problemsAtLeast(response, 'error')).toHaveLength(1);
    expect(problemsAtLeast(response, 'warning')).toHaveLength(2);
  });
});

describe('nearestOp', () => {
  const KNOWN = ['library.add', 'library.remove', 'clock.add', 'schedule.day'];

  it('finds the name a typo was aiming at', () => {
    expect(nearestOp('libary.add', KNOWN)).toBe('library.add');
    expect(nearestOp('schedule.dy', KNOWN)).toBe('schedule.day');
  });

  it('offers nothing for a name that is not close to any of them', () => {
    expect(nearestOp('royalty.file', KNOWN)).toBeUndefined();
  });

  it('offers nothing when there is nothing registered', () => {
    expect(nearestOp('library.add', [])).toBeUndefined();
  });

  it('returns the name itself when it is exact', () => {
    expect(nearestOp('clock.add', KNOWN)).toBe('clock.add');
  });
});

describe('unknownOp', () => {
  it('refuses and names the operation that was asked for', () => {
    const response = unknownOp({ ...REQUEST, op: 'library.ad' }, ['library.add']);
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.code).toBe(UNKNOWN_OP);
    expect(response.problems[0]?.subject).toBe('library.ad');
    expect(response.problems[0]?.message).toContain('library.add');
  });

  it('does not guess when nothing is close', () => {
    const response = unknownOp({ ...REQUEST, op: 'quit' }, ['library.add']);
    expect(response.problems[0]?.message).not.toContain('did you mean');
  });
});
