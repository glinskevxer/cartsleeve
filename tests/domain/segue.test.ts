import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMING,
  END_TYPES,
  auditTiming,
  parseEndType,
  segueLength,
  segueOffsets,
  segueOverlap,
  segueSaving,
} from '../../src/domain/segue.js';
import type { EndType, TimedItem, Timing } from '../../src/domain/segue.js';
import { tenths } from '../../src/util/duration.js';

const timing = (intro: number, endType: EndType, tail: number): Timing => ({
  intro: tenths(intro),
  endType,
  tail: tenths(tail),
});

const item = (runtime: number, t: Timing): TimedItem => ({ runtime: tenths(runtime), timing: t });

describe('parseEndType', () => {
  it('reads the long and the short spelling of each', () => {
    expect(parseEndType('cold')).toBe('cold');
    expect(parseEndType('C')).toBe('cold');
    expect(parseEndType('fade')).toBe('fade');
    expect(parseEndType('f')).toBe('fade');
    expect(parseEndType('sustain')).toBe('sustain');
    expect(parseEndType(' S ')).toBe('sustain');
  });

  it('returns undefined for anything else', () => {
    expect(parseEndType('warm')).toBeUndefined();
    expect(parseEndType('')).toBeUndefined();
  });

  it('knows exactly three end types', () => {
    expect(END_TYPES).toHaveLength(3);
    for (const value of END_TYPES) {
      expect(parseEndType(value)).toBe(value);
    }
  });
});

describe('segueOverlap', () => {
  it('is nothing at all after a cold ending', () => {
    expect(segueOverlap(timing(0, 'cold', 0), timing(120, 'fade', 50))).toBe(0);
    expect(segueOverlap(timing(0, 'cold', 90), timing(120, 'fade', 50))).toBe(0);
  });

  it('is the smaller of the tail and the next intro', () => {
    expect(segueOverlap(timing(0, 'fade', 80), timing(120, 'cold', 0))).toBe(80);
    expect(segueOverlap(timing(0, 'fade', 200), timing(120, 'cold', 0))).toBe(120);
  });

  it('is nothing when the next cart has no ramp to talk over', () => {
    expect(segueOverlap(timing(0, 'fade', 80), timing(0, 'cold', 0))).toBe(0);
  });

  it('treats a sustain the same way as a fade', () => {
    expect(segueOverlap(timing(0, 'sustain', 80), timing(120, 'cold', 0))).toBe(80);
  });

  it('never goes negative', () => {
    expect(segueOverlap(timing(0, 'fade', -50), timing(120, 'cold', 0))).toBe(0);
  });

  it('defaults to no overlap either way', () => {
    expect(segueOverlap(DEFAULT_TIMING, DEFAULT_TIMING)).toBe(0);
  });
});

describe('segueOffsets', () => {
  const cold = timing(0, 'cold', 0);

  it('gives one more offset than there are carts', () => {
    expect(segueOffsets([item(2000, cold), item(1800, cold)])).toHaveLength(3);
    expect(segueOffsets([])).toEqual([0]);
  });

  it('stacks cold endings with no overlap at all', () => {
    expect(segueOffsets([item(2000, cold), item(1800, cold), item(2200, cold)])).toEqual([
      0, 2000, 3800, 6000,
    ]);
  });

  it('pulls every later start earlier once a segue overlaps', () => {
    const fade = timing(0, 'fade', 60);
    const ramp = timing(90, 'fade', 60);
    const offsets = segueOffsets([item(2000, fade), item(1800, ramp), item(2200, ramp)]);
    expect(offsets).toEqual([0, 1940, 3680, 5880]);
  });

  it('moves the whole rest of the run when one intro changes', () => {
    const fade = timing(0, 'fade', 60);
    const short = segueOffsets([
      item(2000, fade),
      item(1800, timing(20, 'fade', 60)),
      item(2200, fade),
    ]);
    const long = segueOffsets([
      item(2000, fade),
      item(1800, timing(90, 'fade', 60)),
      item(2200, fade),
    ]);
    expect(short[1]).toBe(1980);
    expect(long[1]).toBe(1940);
    expect((short[3] ?? 0) - (long[3] ?? 0)).toBe(40);
  });
});

describe('segueLength and segueSaving', () => {
  it('are the naive sum and zero when everything ends cold', () => {
    const cold = timing(0, 'cold', 0);
    const run = [item(2000, cold), item(1800, cold)];
    expect(segueLength(run)).toBe(3800);
    expect(segueSaving(run)).toBe(0);
  });

  it('shorten the run by the overlaps', () => {
    const fade = timing(80, 'fade', 60);
    const run = [item(2000, fade), item(1800, fade), item(2200, fade)];
    expect(segueSaving(run)).toBe(120);
    expect(segueLength(run)).toBe(6000 - 120);
  });

  it('add up to more than a minute over an hour of music', () => {
    const fade = timing(90, 'fade', 70);
    const hour = Array.from({ length: 14 }, () => item(2200, fade));
    expect(segueSaving(hour)).toBe(13 * 70);
    expect(segueLength(hour)).toBeLessThan(14 * 2200);
  });

  it('handle a single cart and an empty run', () => {
    expect(segueLength([item(2000, timing(0, 'fade', 60))])).toBe(2000);
    expect(segueSaving([item(2000, timing(0, 'fade', 60))])).toBe(0);
    expect(segueLength([])).toBe(0);
  });
});

describe('auditTiming', () => {
  it('passes an ordinary fade', () => {
    expect(auditTiming('M0001', tenths(2200), timing(90, 'fade', 70))).toEqual([]);
  });

  it('passes an ordinary cold ending', () => {
    expect(auditTiming('M0001', tenths(2200), timing(90, 'cold', 0))).toEqual([]);
  });

  it('flags a negative intro', () => {
    expect(auditTiming('M0001', tenths(2200), timing(-5, 'cold', 0))[0]?.code).toBe('CLK-020');
  });

  it('flags an intro or a tail longer than the cart', () => {
    expect(auditTiming('M0001', tenths(100), timing(200, 'cold', 0))[0]?.code).toBe('CLK-021');
    expect(auditTiming('M0001', tenths(100), timing(0, 'fade', 200))[0]?.code).toBe('CLK-022');
  });

  it('flags a cold ending that carries a tail', () => {
    expect(auditTiming('M0001', tenths(2200), timing(90, 'cold', 40))[0]?.code).toBe('CLK-023');
  });

  it('flags a fade with no tail coded', () => {
    expect(auditTiming('M0001', tenths(2200), timing(90, 'fade', 0))[0]?.code).toBe('CLK-024');
    expect(auditTiming('M0001', tenths(2200), timing(90, 'sustain', 0))[0]?.code).toBe('CLK-024');
  });
});
