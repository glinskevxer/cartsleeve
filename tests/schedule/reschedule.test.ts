import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESCHEDULE_LONGER,
  RESCHEDULE_NEW_BREACH,
  changedAnything,
  rescheduleHour,
  retained,
} from '../../src/schedule/reschedule.js';
import { fillHour } from '../../src/schedule/hour.js';
import type { Placed } from '../../src/rules/rule.js';
import type { EntrySpec } from '../support/fixtures.js';
import { resetFixtures } from '../support/fixtures.js';
import { hourInput, libraryOf, musicClock } from '../support/hour.js';
import { placed } from '../support/placed.js';

beforeEach(() => {
  resetFixtures();
});

const ERA_YEARS = [1965, 1980, 1995, 2010];

const TEN: EntrySpec[] = Array.from({ length: 10 }, (_, index) => ({
  number: `M${String(index + 1).padStart(4, '0')}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
}));

const input = () => hourInput({ clock: musicClock(3), library: libraryOf(TEN) });

describe('rescheduleHour', () => {
  it('refills the hour when nothing surrounds it', () => {
    const outcome = rescheduleHour({ hour: input(), before: [], after: [] });
    expect(outcome.outcome.placed).toHaveLength(3);
    expect(outcome.holes).toEqual([]);
  });

  it('reports nothing dropped or added with no previous hour to compare', () => {
    const outcome = rescheduleHour({ hour: input(), before: [], after: [] });
    expect(outcome.dropped).toEqual([]);
    expect(outcome.added).toHaveLength(3);
    expect(outcome.problems).toEqual([]);
  });

  it('avoids what is already scheduled before it', () => {
    const before: Placed[] = [
      placed({ position: 900, at: 0, number: 'M0001', billed: 'Artist 1', title: 'Song 1' }),
    ];
    const outcome = rescheduleHour({ hour: input(), before, after: [] });
    expect(outcome.outcome.placed.map((each) => each.cart)).not.toContain('M0001');
  });

  it('avoids what is already scheduled after it, which a forward pass cannot', () => {
    const after: Placed[] = [
      placed({ position: 5000, at: 6000, number: 'M0001', billed: 'Artist 1', title: 'Song 1' }),
    ];
    const forward = fillHour(input());
    resetFixtures();
    const backward = rescheduleHour({ hour: input(), before: [], after });
    expect(forward.placed.map((each) => each.cart)).toContain('M0001');
    expect(backward.outcome.placed.map((each) => each.cart)).not.toContain('M0001');
  });

  it('names what it dropped and what it added against the previous hour', () => {
    const previous = fillHour(input());
    resetFixtures();
    const before: Placed[] = [
      placed({ position: 900, at: 0, number: 'M0001', billed: 'Artist 1', title: 'Song 1' }),
    ];
    const outcome = rescheduleHour({ hour: input(), before, after: [], previous });
    expect(outcome.dropped).toContain('M0001');
    expect(outcome.added.length).toBeGreaterThan(0);
    expect(changedAnything(outcome)).toBe(true);
  });

  it('reports no change when the hour comes out the same', () => {
    const previous = fillHour(input());
    resetFixtures();
    const outcome = rescheduleHour({ hour: input(), before: [], after: [], previous });
    expect(outcome.dropped).toEqual([]);
    expect(outcome.added).toEqual([]);
    expect(changedAnything(outcome)).toBe(false);
  });

  it('warns when it introduced breaches into an hour that had none', () => {
    const previous = fillHour(input());
    expect(previous.breaches).toBe(0);
    resetFixtures();
    // Everything the hour could reach is by one artist, seen only from after.
    const after: Placed[] = TEN.slice(0, 9).map((spec, index) =>
      placed({
        position: 5000 + index,
        at: 6000 + index * 60,
        number: spec.number ?? '',
        billed: spec.billed ?? '',
        title: spec.title ?? '',
      }),
    );
    const outcome = rescheduleHour({ hour: input(), before: [], after, previous });
    expect(outcome.outcome.breaches).toBeGreaterThan(0);
    expect(outcome.problems.map((each) => each.code)).toContain(RESCHEDULE_NEW_BREACH);
  });

  it('warns when the hour changed length', () => {
    const previous = fillHour(input());
    resetFixtures();
    const shorter = hourInput({
      clock: musicClock(3),
      library: libraryOf(TEN.map((spec) => ({ ...spec, runtime: '2:00' }))),
    });
    const outcome = rescheduleHour({ hour: shorter, before: [], after: [], previous });
    const warned = outcome.problems.find((each) => each.code === RESCHEDULE_LONGER);
    expect(warned).toBeDefined();
    expect(warned?.detail?.['by']).toBe(-1800);
  });

  it('says nothing about length when it did not change', () => {
    const previous = fillHour(input());
    resetFixtures();
    const outcome = rescheduleHour({ hour: input(), before: [], after: [], previous });
    expect(outcome.problems.map((each) => each.code)).not.toContain(RESCHEDULE_LONGER);
  });

  it('collects the holes of the refilled hour', () => {
    const empty = hourInput({ clock: musicClock(2), library: libraryOf([]) });
    const outcome = rescheduleHour({ hour: empty, before: [], after: [] });
    expect(outcome.holes).toHaveLength(2);
  });
});

describe('retained', () => {
  it('is one when nothing was dropped', () => {
    const outcome = rescheduleHour({ hour: input(), before: [], after: [] });
    expect(retained(outcome, 3)).toBe(1);
  });

  it('falls as more is dropped', () => {
    const previous = fillHour(input());
    resetFixtures();
    const before: Placed[] = [
      placed({ position: 900, at: 0, number: 'M0001', billed: 'Artist 1', title: 'Song 1' }),
    ];
    const outcome = rescheduleHour({ hour: input(), before, after: [], previous });
    expect(retained(outcome, 3)).toBeLessThan(1);
  });

  it('is one for an hour that held nothing', () => {
    const outcome = rescheduleHour({ hour: input(), before: [], after: [] });
    expect(retained(outcome, 0)).toBe(1);
  });
});
