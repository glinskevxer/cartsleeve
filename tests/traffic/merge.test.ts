import { beforeEach, describe, expect, it } from 'vitest';
import {
  BREAK_EMPTY,
  HOUR_MOVED,
  anythingMoved,
  mergeTraffic,
  mergedMusic,
  worstMove,
} from '../../src/traffic/merge.js';
import { makeSpot } from '../../src/traffic/spot.js';
import type { Spot } from '../../src/traffic/spot.js';
import { fillHour } from '../../src/schedule/hour.js';
import { tenths } from '../../src/util/duration.js';
import type { EntrySpec } from '../support/fixtures.js';
import { resetFixtures } from '../support/fixtures.js';
import { clockOf, hourInput, libraryOf } from '../support/hour.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const ERA_YEARS = [1965, 1980, 1995, 2010];

const SONGS: EntrySpec[] = Array.from({ length: 8 }, (_, index) => ({
  number: `M000${index + 1}`,
  category: 'A',
  billed: `Artist ${index + 1}`,
  title: `Song ${index + 1}`,
  runtime: '3:00',
  releaseYear: ERA_YEARS[index % ERA_YEARS.length] ?? 1980,
}));

function spot(id: string, length: string): Spot {
  return expectOk(makeSpot({ id, orderId: 'ORD-1', cart: 'C0455', length }));
}

/** Music, a two minute break, music, a two minute break, music. */
const CLOCK = () =>
  clockOf([
    { kind: 'music', target: '0:00', category: 'A' },
    { kind: 'stopset', target: '3:00', name: 'break one', budget: '2:00' },
    { kind: 'music', target: '5:00', category: 'A' },
    { kind: 'stopset', target: '8:00', name: 'break two', budget: '2:00' },
    { kind: 'music', target: '10:00', category: 'A' },
  ]);

const scheduled = () => fillHour(hourInput({ clock: CLOCK(), library: libraryOf(SONGS) }));

const onBudget = (name: string): Spot[] =>
  name === 'break one' ? [spot('SPT-1', '1:00'), spot('SPT-2', '1:00')] : [spot('SPT-3', '2:00')];

const short = (name: string): Spot[] =>
  name === 'break one' ? [spot('SPT-1', '0:30')] : [spot('SPT-3', '2:00')];

const long = (name: string): Spot[] =>
  name === 'break one' ? [spot('SPT-1', '2:00'), spot('SPT-2', '1:00')] : [spot('SPT-3', '2:00')];

describe('when the breaks sell to budget', () => {
  const merged = () =>
    mergeTraffic({ slots: scheduled().slots, spotsFor: onBudget, startsAt: tenths(0) });

  it('leaves every slot exactly where the music pass put it', () => {
    const outcome = merged();
    expect(outcome.slots.every((slot) => slot.movedBy === 0)).toBe(true);
    expect(anythingMoved(outcome)).toBe(false);
    expect(worstMove(outcome)).toBe(0);
  });

  it('says nothing about an hour that did not move', () => {
    const outcome = merged();
    expect(outcome.problems).toEqual([]);
    expect(outcome.hourMovedBy).toBe(0);
  });

  it('fills each break from the spots traffic sold into it', () => {
    const outcome = merged();
    expect(outcome.stopsets).toHaveLength(2);
    expect(outcome.stopsets[0]?.spots.map((each) => each.id)).toEqual(['SPT-1', 'SPT-2']);
    expect(outcome.stopsets[1]?.length).toBe(1200);
  });
});

describe('when a break sells short', () => {
  const merged = () =>
    mergeTraffic({ slots: scheduled().slots, spotsFor: short, startsAt: tenths(0) });

  it('pulls every later slot earlier', () => {
    const music = mergedMusic(merged());
    expect(music[0]?.movedBy).toBe(0);
    expect(music[1]?.movedBy).toBe(-900);
    expect(music[2]?.movedBy).toBe(-900);
  });

  it('does not change which carts play or their order', () => {
    const before = scheduled();
    const outcome = mergeTraffic({ slots: before.slots, spotsFor: short, startsAt: tenths(0) });
    expect(mergedMusic(outcome).map((slot) => slot.cart)).toEqual(
      before.slots.filter((slot) => slot.cart !== undefined).map((slot) => slot.cart),
    );
  });

  it('shortens the hour and says so', () => {
    const outcome = merged();
    expect(outcome.hourMovedBy).toBe(-900);
    expect(outcome.problems.find((each) => each.code === HOUR_MOVED)?.detail?.['by']).toBe(-900);
  });

  it('reports the furthest any slot moved', () => {
    expect(worstMove(merged())).toBe(-900);
    expect(anythingMoved(merged())).toBe(true);
  });
});

describe('when a break sells long', () => {
  it('pushes every later slot later when overfill is allowed', () => {
    const outcome = mergeTraffic({
      slots: scheduled().slots,
      spotsFor: long,
      startsAt: tenths(0),
      allowOverfill: true,
    });
    expect(mergedMusic(outcome)[1]?.movedBy).toBe(600);
    expect(outcome.hourMovedBy).toBe(600);
  });

  it('drops the overflow and leaves the hour alone when it is not', () => {
    const outcome = mergeTraffic({ slots: scheduled().slots, spotsFor: long, startsAt: tenths(0) });
    expect(outcome.stopsets[0]?.dropped).toHaveLength(1);
    expect(outcome.hourMovedBy).toBe(0);
  });
});

describe('when a break sells nothing', () => {
  const merged = () =>
    mergeTraffic({ slots: scheduled().slots, spotsFor: () => [], startsAt: tenths(0) });

  it('notes the dead air and collapses the break', () => {
    const outcome = merged();
    expect(outcome.stopsets.every((each) => each.length === 0)).toBe(true);
    expect(outcome.problems.filter((each) => each.code === BREAK_EMPTY)).toHaveLength(2);
  });

  it('pulls the hour in by the whole budgeted break time', () => {
    expect(merged().hourMovedBy).toBe(-2400);
  });
});

describe('the edges', () => {
  it('merges an hour with no breaks at all', () => {
    const musicOnly = fillHour(
      hourInput({
        clock: clockOf([{ kind: 'music', target: '0:00', category: 'A' }]),
        library: libraryOf(SONGS),
      }),
    );
    const outcome = mergeTraffic({
      slots: musicOnly.slots,
      spotsFor: () => [],
      startsAt: tenths(0),
    });
    expect(outcome.stopsets).toEqual([]);
    expect(anythingMoved(outcome)).toBe(false);
  });

  it('merges an empty hour', () => {
    const outcome = mergeTraffic({ slots: [], spotsFor: () => [], startsAt: tenths(600) });
    expect(outcome.slots).toEqual([]);
    expect(outcome.endsAt).toBe(600);
    expect(outcome.problems).toEqual([]);
  });

  it('carries a hole through without overlapping into it', () => {
    const holed = fillHour(
      hourInput({
        clock: clockOf([
          { kind: 'music', target: '0:00', category: 'A' },
          { kind: 'music', target: '3:00', category: 'G' },
        ]),
        library: libraryOf(SONGS),
      }),
    );
    const outcome = mergeTraffic({
      slots: holed.slots,
      spotsFor: () => [],
      startsAt: tenths(0),
    });
    expect(outcome.slots[1]?.hole).toBeDefined();
    expect(outcome.slots[1]?.mergedAt).toBe(1800);
  });
});
