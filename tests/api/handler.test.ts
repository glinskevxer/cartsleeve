import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { answering, built, defined, idField, paramProblems, route } from '../../src/api/handler.js';
import { BAD_PARAMS, succeed } from '../../src/api/envelope.js';
import type { ApiRequest } from '../../src/api/envelope.js';
import { error } from '../../src/util/problem.js';
import { parseCartNumber } from '../../src/util/ids.js';
import { err, ok } from '../../src/util/result.js';

function request(params: Record<string, unknown>, at = 1_700_000_000_000): ApiRequest {
  return { op: 'test.op', id: 'r1', at, params };
}

describe('defined', () => {
  it('drops the keys whose value is undefined', () => {
    expect(defined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });

  it('keeps a key whose value is null, because that is a value', () => {
    expect(defined({ a: null })).toEqual({ a: null });
  });

  it('keeps a key whose value is an empty string', () => {
    expect(defined({ a: '' })).toEqual({ a: '' });
  });

  it('leaves an object with nothing missing alone', () => {
    expect(defined({ a: 1 })).toEqual({ a: 1 });
  });
});

describe('paramProblems', () => {
  it('names the field a schema issue is about', () => {
    const parsed = z.object({ cart: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }
    const problems = paramProblems(parsed.error.issues);
    expect(problems[0]?.subject).toBe('cart');
    expect(problems[0]?.code).toBe(BAD_PARAMS);
  });

  it('names the whole params object when the issue is about no field', () => {
    const parsed = z.object({}).safeParse('a string');
    if (parsed.success) {
      throw new Error('a string is not an object');
    }
    expect(paramProblems(parsed.error.issues)[0]?.subject).toBe('params');
  });
});

describe('idField', () => {
  const schema = z.object({ cart: idField(parseCartNumber) });

  it('yields the branded id when it parses', () => {
    const parsed = schema.safeParse({ cart: 'M0001' });
    expect(parsed.success && parsed.data.cart).toBe('M0001');
  });

  it('reports the reason the id would not parse', () => {
    const parsed = schema.safeParse({ cart: 'not a cart' });
    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }
    const problems = paramProblems(parsed.error.issues);
    expect(problems[0]?.subject).toBe('cart');
    expect(problems[0]?.message.length).toBeGreaterThan(0);
  });
});

describe('built', () => {
  const doubled = built(z.object({ n: z.number() }), (input) =>
    input.n > 0 ? ok(input.n * 2) : err([error('TST001', 'n', 'is not positive')]),
  );

  it('yields the built value', () => {
    expect(doubled.safeParse({ n: 3 })).toMatchObject({ success: true, data: 6 });
  });

  it('carries the diagnostic code through rather than flattening it', () => {
    const parsed = doubled.safeParse({ n: -1 });
    if (parsed.success) {
      throw new Error('a negative number should not build');
    }
    const problems = paramProblems(parsed.error.issues);
    expect(problems[0]?.code).toBe('TST001');
    expect(problems[0]?.message).toContain('is not positive');
  });

  it('reports every reason the builder gave, not the first', () => {
    const fussy = built(z.object({ n: z.number() }), () =>
      err([error('TST001', 'n', 'is wrong'), error('TST002', 'n', 'is also wrong')]),
    );
    const parsed = fussy.safeParse({ n: 1 });
    if (parsed.success) {
      throw new Error('the builder always refuses');
    }
    expect(paramProblems(parsed.error.issues)).toHaveLength(2);
  });
});

describe('route', () => {
  const doubling = route({
    op: 'test.op',
    summary: 'double a number',
    writes: false,
    params: z.object({ n: z.number() }),
    answer: (params, input) => succeed(input, { doubled: params.n * 2 }),
  });

  it('carries the name, the summary and whether it writes', () => {
    expect(doubling.op).toBe('test.op');
    expect(doubling.summary).toBe('double a number');
    expect(doubling.writes).toBe(false);
  });

  it('hands the answer values that are already parsed', () => {
    expect(doubling.handler(request({ n: 4 })).data).toEqual({ doubled: 8 });
  });

  it('refuses before the answer runs when the params are wrong', () => {
    let ran = false;
    const counted = route({
      op: 'test.op',
      summary: 'never runs',
      writes: false,
      params: z.object({ n: z.number() }),
      answer: (_params, input) => {
        ran = true;
        return succeed(input, {});
      },
    });
    const response = counted.handler(request({ n: 'four' }));
    expect(response.ok).toBe(false);
    expect(ran).toBe(false);
  });

  it('builds the schema from the request when it is given one that needs to', () => {
    const clocked = route({
      op: 'test.op',
      summary: 'read a year against the caller clock',
      writes: false,
      params: (input: ApiRequest) =>
        z.object({ year: z.number().max(new Date(input.at).getUTCFullYear()) }),
      answer: (params, input) => succeed(input, params),
    });
    // The request clock is in 2023, so 2024 has not happened yet.
    expect(clocked.handler(request({ year: 2023 })).ok).toBe(true);
    expect(clocked.handler(request({ year: 2024 })).ok).toBe(false);
  });
});

describe('answering', () => {
  it('maps a success into the body the caller wants', () => {
    const response = answering(request({}), ok({ code: 'A', extra: 1 }), (value) => ({
      code: value.code,
    }));
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ code: 'A' });
  });

  it('passes a failure through without calling the body', () => {
    let ran = false;
    const response = answering(request({}), err([error('TST001', 'x', 'failed')]), () => {
      ran = true;
      return {};
    });
    expect(response.ok).toBe(false);
    expect(ran).toBe(false);
    expect(response.problems[0]?.code).toBe('TST001');
  });

  it('carries warnings onto a success', () => {
    const response = answering(request({}), ok(1), (value) => value, [
      error('TST002', 'x', 'is worth mentioning'),
    ]);
    expect(response.ok).toBe(true);
    expect(response.problems).toHaveLength(1);
  });

  it('drops the warnings on a failure', () => {
    const response = answering(request({}), err([error('TST001', 'x', 'failed')]), () => 1, [
      error('TST002', 'x', 'is worth mentioning'),
    ]);
    expect(response.problems).toHaveLength(1);
    expect(response.problems[0]?.code).toBe('TST001');
  });
});
