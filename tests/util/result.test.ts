import { describe, expect, it } from 'vitest';
import {
  andThen,
  collect,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  partition,
  sequence,
  unwrapOr,
  unwrapOrElse,
} from '../../src/util/result.js';
import type { Result } from '../../src/util/result.js';

describe('ok and err', () => {
  it('carry the value and the error', () => {
    expect(ok(4)).toEqual({ ok: true, value: 4 });
    expect(err('bad')).toEqual({ ok: false, error: 'bad' });
  });

  it('narrow through the guards', () => {
    const good: Result<number, string> = ok(1);
    const bad: Result<number, string> = err('no');
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
    if (isOk(good)) {
      expect(good.value + 1).toBe(2);
    }
    if (isErr(bad)) {
      expect(bad.error.length).toBe(2);
    }
  });
});

describe('map and mapErr', () => {
  it('maps the value and leaves the error alone', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err<string>('x'), (n: number) => n * 3)).toEqual(err('x'));
  });

  it('maps the error and leaves the value alone', () => {
    expect(mapErr(err('x'), (e) => `${e}!`)).toEqual(err('x!'));
    expect(mapErr(ok(2), (e: string) => `${e}!`)).toEqual(ok(2));
  });

  it('does not call the mapper on the branch it does not touch', () => {
    let calls = 0;
    map(err<string>('x'), (n: number) => {
      calls += 1;
      return n;
    });
    expect(calls).toBe(0);
  });
});

describe('andThen', () => {
  const halve = (n: number): Result<number, string> =>
    n % 2 === 0 ? ok(n / 2) : err(`${n} is odd`);

  it('chains on success', () => {
    expect(andThen(ok(8), halve)).toEqual(ok(4));
  });

  it('can fail in the chained step', () => {
    expect(andThen(ok(7), halve)).toEqual(err('7 is odd'));
  });

  it('short circuits on an existing error', () => {
    expect(andThen(err<string>('earlier'), halve)).toEqual(err('earlier'));
  });
});

describe('unwrapOr', () => {
  it('returns the value or the fallback', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err<string>('x'), 0)).toBe(0);
  });

  it('computes the fallback from the error', () => {
    expect(unwrapOrElse(err('abc'), (e) => e.length)).toBe(3);
    expect(unwrapOrElse(ok(5), (e: string) => e.length)).toBe(5);
  });
});

describe('collect', () => {
  it('returns every value when all succeed', () => {
    expect(collect([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
  });

  it('returns every error rather than stopping at the first', () => {
    const results: Result<number, string>[] = [ok(1), err('a'), ok(3), err('b')];
    expect(collect(results)).toEqual(err(['a', 'b']));
  });

  it('treats an empty list as success', () => {
    expect(collect([])).toEqual(ok([]));
  });
});

describe('partition', () => {
  it('keeps both sides in input order', () => {
    const results: Result<number, string>[] = [ok(1), err('a'), ok(3), err('b'), ok(5)];
    expect(partition(results)).toEqual({ values: [1, 3, 5], errors: ['a', 'b'] });
  });
});

describe('sequence', () => {
  it('stops at the first error', () => {
    const results: Result<number, string>[] = [ok(1), err('a'), err('b')];
    expect(sequence(results)).toEqual(err('a'));
  });

  it('returns the values when all succeed', () => {
    expect(sequence([ok(1), ok(2)])).toEqual(ok([1, 2]));
  });
});
