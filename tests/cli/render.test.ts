import { describe, expect, it } from 'vitest';
import {
  OK,
  REFUSED,
  exitCode,
  formatData,
  formatProblem,
  renderResponse,
} from '../../src/cli/render.js';
import { refuse, succeed } from '../../src/api/envelope.js';
import type { ApiRequest } from '../../src/api/envelope.js';
import { error, info, warning } from '../../src/util/problem.js';

const REQUEST: ApiRequest = { op: 'library.get', id: 'r1', at: 1_000, params: {} };

describe('formatProblem', () => {
  it('puts the code where an operator can read it', () => {
    const line = formatProblem(error('LIB030', 'M0001', 'is not in the library'));
    expect(line).toContain('LIB030');
    expect(line).toContain('M0001');
    expect(line).toContain('is not in the library');
  });

  it('marks the severity differently for each level', () => {
    const marks = new Set([
      formatProblem(info('A001', 'x', 'y')).slice(0, 4),
      formatProblem(warning('A001', 'x', 'y')).slice(0, 4),
      formatProblem(error('A001', 'x', 'y')).slice(0, 4),
    ]);
    expect(marks.size).toBe(3);
  });
});

describe('formatData', () => {
  it('prints a report exactly as it was laid out', () => {
    expect(formatData(['  ROTATION HEALTH', '', 'station: KRTQ'])).toEqual([
      '  ROTATION HEALTH',
      '',
      'station: KRTQ',
    ]);
  });

  it('prints a handful of counts as a key and value block', () => {
    const lines = formatData({ hours: 3, placed: 9 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('hours');
    expect(lines[0]).toContain('3');
  });

  it('prints a list of rows as a table with a heading', () => {
    const lines = formatData([
      { cart: 'M0001', plays: 4 },
      { cart: 'M0002', plays: 2 },
    ]);
    expect(lines[0]).toContain('cart');
    expect(lines[0]).toContain('plays');
    expect(lines).toHaveLength(4);
  });

  it('right aligns a column that is entirely numbers', () => {
    const lines = formatData([{ plays: 4 }, { plays: 12 }]);
    const rows = lines.slice(2);
    expect(rows[0]?.endsWith('4')).toBe(true);
    expect(rows[1]?.endsWith('12')).toBe(true);
    expect(rows[0]).toHaveLength(rows[1]?.length ?? 0);
  });

  it('prints nothing for an empty list', () => {
    expect(formatData([])).toEqual([]);
  });

  it('prints nothing at all when there is no body', () => {
    expect(formatData(undefined)).toEqual([]);
    expect(formatData(null)).toEqual([]);
  });

  it('splits a body that carries both counts and a report', () => {
    const lines = formatData({ summary: '2 breaches', lines: ['BY RULE', 'artist 2'] });
    expect(lines[0]).toContain('2 breaches');
    expect(lines).toContain('BY RULE');
  });

  it('prints a nested value as json rather than as object Object', () => {
    const lines = formatData([{ cart: 'M0001', detail: { hour: 8 } }]);
    expect(lines.join('\n')).toContain('{"hour":8}');
  });

  it('prints a list of plain strings as itself', () => {
    expect(formatData(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('renderResponse', () => {
  it('prints the body of a clean success and nothing else', () => {
    expect(renderResponse(succeed(REQUEST, { cart: 'M0001' }))).toHaveLength(1);
  });

  it('prints the problems under the body on a success that has some', () => {
    const lines = renderResponse(
      succeed(REQUEST, { cart: 'M0001' }, [warning('SCH900', 'hour 6', 'relaxed a rule')]),
    );
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('SCH900');
  });

  it('leads with the problems on a refusal, because there is no body', () => {
    const lines = renderResponse(refuse(REQUEST, [error('LIB030', 'M0001', 'is missing')]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('LIB030');
  });

  it('says the request was refused when nothing said why', () => {
    expect(renderResponse(refuse(REQUEST, []))[0]).toContain('refused');
  });

  it('puts the worst problem first', () => {
    const lines = renderResponse(
      succeed(REQUEST, {}, [
        warning('B002', 'x', 'is a warning'),
        error('A001', 'x', 'is an error'),
      ]),
    );
    expect(lines[0]).toContain('A001');
  });

  it('keeps quiet about info unless the floor is lowered', () => {
    const response = succeed(REQUEST, {}, [info('A001', 'x', 'happened')]);
    expect(renderResponse(response)).toHaveLength(0);
    expect(renderResponse(response, { floor: 'info' })).toHaveLength(1);
  });

  it('prints the whole response as json when a program is reading it', () => {
    const lines = renderResponse(succeed(REQUEST, { cart: 'M0001' }), { json: true });
    const parsed = JSON.parse(lines.join('\n')) as { ok: boolean; data: { cart: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.cart).toBe('M0001');
  });

  it('prints the problems in json too, on a refusal', () => {
    const lines = renderResponse(refuse(REQUEST, [error('LIB030', 'M0001', 'is missing')]), {
      json: true,
    });
    const parsed = JSON.parse(lines.join('\n')) as { problems: { code: string }[] };
    expect(parsed.problems[0]?.code).toBe('LIB030');
  });
});

describe('exitCode', () => {
  it('is zero for a success', () => {
    expect(exitCode(succeed(REQUEST, {}))).toBe(OK);
  });

  it('is zero for a success carrying a warning, because a warning is not a failure', () => {
    expect(exitCode(succeed(REQUEST, {}, [warning('A001', 'x', 'y')]))).toBe(OK);
  });

  it('is one for a refusal', () => {
    expect(exitCode(refuse(REQUEST, []))).toBe(REFUSED);
  });

  it('is one for a success that reports an error it recovered from', () => {
    expect(exitCode(succeed(REQUEST, {}, [error('A001', 'x', 'y')]))).toBe(REFUSED);
  });
});
