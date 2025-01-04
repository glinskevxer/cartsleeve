import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEPARATION,
  STANDARD_CATEGORIES,
  describeCategory,
  isRotating,
  makeCategory,
} from '../../src/domain/category.js';
import { fromMinutes } from '../../src/util/duration.js';
import { expectErr, expectOk } from '../support/result.js';

describe('makeCategory', () => {
  it('builds from a code and a name', () => {
    const category = expectOk(makeCategory({ code: 'A', name: 'Power current' }));
    expect(category.code).toBe('A');
    expect(category.name).toBe('Power current');
  });

  it('defaults to one packet, music, priority fifty and the standard separation', () => {
    const category = expectOk(makeCategory({ code: 'A', name: 'Power' }));
    expect(category.packets).toBe(1);
    expect(category.music).toBe(true);
    expect(category.priority).toBe(50);
    expect(category.separation).toEqual(DEFAULT_SEPARATION);
  });

  it('takes a separation minimum in minutes and stores it in tenths', () => {
    const category = expectOk(
      makeCategory({
        code: 'G',
        name: 'Gold',
        artistMinutes: 45,
        titleMinutes: 200,
        recordingMinutes: 240,
        soundMinutes: 15,
      }),
    );
    expect(category.separation.artist).toBe(fromMinutes(45));
    expect(category.separation.title).toBe(fromMinutes(200));
    expect(category.separation.recording).toBe(fromMinutes(240));
    expect(category.separation.sound).toBe(fromMinutes(15));
  });

  it('inherits only the minimums it was not given', () => {
    const category = expectOk(makeCategory({ code: 'G', name: 'Gold', artistMinutes: 45 }));
    expect(category.separation.artist).toBe(fromMinutes(45));
    expect(category.separation.title).toBe(DEFAULT_SEPARATION.title);
  });

  it('accepts a zero minimum, which means the rule does not apply', () => {
    const category = expectOk(makeCategory({ code: 'X', name: 'Sweepers', soundMinutes: 0 }));
    expect(category.separation.sound).toBe(0);
  });

  it('normalises the code to upper case', () => {
    expect(expectOk(makeCategory({ code: 'g2', name: 'Gold two' })).code).toBe('G2');
  });

  it('rejects a code that is not a letter and an optional digit', () => {
    expect(expectErr(makeCategory({ code: 'AB', name: 'x' }))[0]?.code).toBe('LIB-010');
  });

  it('rejects an empty name', () => {
    expect(expectErr(makeCategory({ code: 'A', name: '  ' }))[0]?.code).toBe('LIB-011');
  });

  it('rejects a packet count below one or not whole', () => {
    expect(expectErr(makeCategory({ code: 'A', name: 'x', packets: 0 }))[0]?.code).toBe('LIB-012');
    expect(expectErr(makeCategory({ code: 'A', name: 'x', packets: 1.5 }))[0]?.code).toBe(
      'LIB-012',
    );
  });

  it('rejects a negative separation and names the field', () => {
    const problems = expectErr(makeCategory({ code: 'A', name: 'x', artistMinutes: -1 }));
    expect(problems[0]?.code).toBe('LIB-013');
    expect(problems[0]?.message).toContain('artist');
  });

  it('reports every problem at once', () => {
    const problems = expectErr(makeCategory({ code: 'AB', name: '', packets: 0 }));
    expect(problems.map((p) => p.code)).toEqual(['LIB-010', 'LIB-011', 'LIB-012']);
  });
});

describe('the standard categories', () => {
  it('all build', () => {
    for (const input of STANDARD_CATEGORIES) {
      expect(expectOk(makeCategory(input)).code).toBe(input.code);
    }
  });

  it('give the heaviest rotation the tightest artist separation', () => {
    const built = STANDARD_CATEGORIES.map((input) => expectOk(makeCategory(input)));
    const power = built.find((c) => c.code === 'A');
    const gold = built.find((c) => c.code === 'G');
    expect(power?.separation.artist).toBeGreaterThan(gold?.separation.artist ?? 0);
  });

  it('order by priority with the currents first', () => {
    const built = STANDARD_CATEGORIES.map((input) => expectOk(makeCategory(input)));
    const codes = [...built].sort((a, b) => a.priority - b.priority).map((c) => c.code);
    expect(codes).toEqual(['A', 'B', 'C', 'R', 'G', 'X']);
  });

  it('mark only X as not rotating', () => {
    for (const input of STANDARD_CATEGORIES) {
      const category = expectOk(makeCategory(input));
      expect(isRotating(category)).toBe(category.code !== 'X');
    }
  });

  it('use distinct codes', () => {
    expect(new Set(STANDARD_CATEGORIES.map((c) => c.code)).size).toBe(STANDARD_CATEGORIES.length);
  });
});

describe('describeCategory', () => {
  it('says the packet count in words when there is one', () => {
    expect(describeCategory(expectOk(makeCategory({ code: 'C', name: 'Light' })))).toBe(
      'C Light (one packet)',
    );
  });

  it('counts the packets when there is more than one', () => {
    expect(describeCategory(expectOk(makeCategory({ code: 'G', name: 'Gold', packets: 4 })))).toBe(
      'G Gold (4 packets)',
    );
  });
});
