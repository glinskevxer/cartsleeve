import { describe, expect, it } from 'vitest';
import { advance, hole, savedBy, startOf, startTimeline } from '../../src/schedule/timeline.js';
import type { Timing } from '../../src/domain/segue.js';
import { tenths } from '../../src/util/duration.js';

const cold: Timing = { intro: tenths(0), endType: 'cold', tail: tenths(0) };
const fading = (intro: number, tail: number): Timing => ({
  intro: tenths(intro),
  endType: 'fade',
  tail: tenths(tail),
});

describe('startTimeline', () => {
  it('starts where it was told to, with nothing before it', () => {
    const timeline = startTimeline(tenths(600));
    expect(timeline.cursor).toBe(600);
    expect(timeline.previous).toBeUndefined();
  });
});

describe('startOf', () => {
  it('is the cursor when nothing came before', () => {
    expect(startOf(startTimeline(tenths(600)), fading(90, 60))).toBe(600);
  });

  it('pulls back by the overlap when something did', () => {
    const after = advance(startTimeline(tenths(0)), fading(0, 60), tenths(1800)).next;
    expect(startOf(after, fading(90, 60))).toBe(1740);
  });

  it('does not pull back after a cold ending', () => {
    const after = advance(startTimeline(tenths(0)), cold, tenths(1800)).next;
    expect(startOf(after, fading(90, 60))).toBe(1800);
  });

  it('does not pull back when the next item has no ramp', () => {
    const after = advance(startTimeline(tenths(0)), fading(0, 60), tenths(1800)).next;
    expect(startOf(after, cold)).toBe(1800);
  });
});

describe('advance', () => {
  it('reports where the item starts and where the cursor lands', () => {
    const { at, next } = advance(startTimeline(tenths(0)), cold, tenths(1800));
    expect(at).toBe(0);
    expect(next.cursor).toBe(1800);
    expect(next.previous).toBe(cold);
  });

  it('stacks cold items end to end', () => {
    let timeline = startTimeline(tenths(0));
    const starts: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const step = advance(timeline, cold, tenths(1800));
      starts.push(step.at);
      timeline = step.next;
    }
    expect(starts).toEqual([0, 1800, 3600]);
    expect(timeline.cursor).toBe(5400);
  });

  it('overlaps a run of fades and ends earlier than the naive sum', () => {
    let timeline = startTimeline(tenths(0));
    for (let index = 0; index < 3; index += 1) {
      timeline = advance(timeline, fading(90, 60), tenths(1800)).next;
    }
    expect(timeline.cursor).toBe(5400 - 2 * 60);
    expect(savedBy(timeline, tenths(5400))).toBe(120);
  });

  it('saves nothing across cold endings', () => {
    let timeline = startTimeline(tenths(0));
    for (let index = 0; index < 3; index += 1) {
      timeline = advance(timeline, cold, tenths(1800)).next;
    }
    expect(savedBy(timeline, tenths(5400))).toBe(0);
  });

  it('accepts a zero length item without moving the cursor', () => {
    const { at, next } = advance(startTimeline(tenths(600)), cold, tenths(0));
    expect(at).toBe(600);
    expect(next.cursor).toBe(600);
  });
});

describe('hole', () => {
  it('leaves the cursor where it was', () => {
    const after = advance(startTimeline(tenths(0)), fading(0, 60), tenths(1800)).next;
    expect(hole(after).cursor).toBe(after.cursor);
  });

  it('clears the previous timing, so nothing overlaps into what never aired', () => {
    const after = advance(startTimeline(tenths(0)), fading(0, 60), tenths(1800)).next;
    expect(after.previous).toBeDefined();
    expect(hole(after).previous).toBeUndefined();
    expect(startOf(hole(after), fading(90, 60))).toBe(1800);
  });

  it('is harmless at the very start', () => {
    expect(hole(startTimeline(tenths(600))).cursor).toBe(600);
  });
});
