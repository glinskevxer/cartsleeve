import { beforeEach, describe, expect, it } from 'vitest';
import { diffSchedules, isIdentical, realChanges, stability } from '../../src/schedule/diff.js';
import type { Placed } from '../../src/rules/rule.js';
import { tenths } from '../../src/util/duration.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { entry, resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

function at(position: number, cart: string, time = position * 1800): Placed {
  return {
    cart: cart as CartNumber,
    entry: entry({ number: cart }),
    position,
    at: tenths(time),
    category: 'A' as CategoryCode,
    cell: 0,
  };
}

describe('diffSchedules', () => {
  it('calls an identical schedule unchanged', () => {
    const log = [at(0, 'M0001'), at(1, 'M0002')];
    const diff = diffSchedules(log, log);
    expect(diff.unchanged).toBe(2);
    expect(isIdentical(diff)).toBe(true);
    expect(realChanges(diff)).toEqual([]);
  });

  it('calls a different cart in the same slot a replacement', () => {
    const diff = diffSchedules([at(0, 'M0001')], [at(0, 'M0009')]);
    expect(diff.replaced).toBe(1);
    expect(diff.changes[0]).toEqual({
      position: 0,
      kind: 'replaced',
      was: 'M0001',
      now: 'M0009',
    });
  });

  it('calls the same cart in a different slot a move, not an add and a remove', () => {
    const diff = diffSchedules([at(0, 'M0001')], [at(3, 'M0001')]);
    expect(diff.moved).toBe(1);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.changes[0]?.by).toBe(3 * 1800);
  });

  it('signs the move backwards when the cart moved earlier', () => {
    const diff = diffSchedules([at(3, 'M0001')], [at(0, 'M0001')]);
    expect(diff.changes[0]?.kind).toBe('moved');
    expect(diff.changes[0]?.by).toBe(-3 * 1800);
  });

  it('calls a cart that is gone entirely a removal', () => {
    const diff = diffSchedules([at(0, 'M0001'), at(1, 'M0002')], [at(0, 'M0001')]);
    expect(diff.removed).toBe(1);
    expect(diff.changes[1]).toEqual({ position: 1, kind: 'removed', was: 'M0002' });
  });

  it('calls a cart that is new an addition', () => {
    const diff = diffSchedules([at(0, 'M0001')], [at(0, 'M0001'), at(1, 'M0002')]);
    expect(diff.added).toBe(1);
    expect(diff.changes[1]).toEqual({ position: 1, kind: 'added', now: 'M0002' });
  });

  it('calls two carts swapping places two replacements', () => {
    const diff = diffSchedules([at(0, 'M0001'), at(1, 'M0002')], [at(0, 'M0002'), at(1, 'M0001')]);
    expect(diff.replaced).toBe(2);
    expect(diff.added + diff.removed).toBe(0);
  });

  it('walks the positions in order', () => {
    const diff = diffSchedules([at(5, 'M0005'), at(1, 'M0001')], [at(1, 'M0001')]);
    expect(diff.changes.map((change) => change.position)).toEqual([1, 5]);
  });

  it('diffs two empty schedules as identical', () => {
    const diff = diffSchedules([], []);
    expect(isIdentical(diff)).toBe(true);
    expect(diff.changes).toEqual([]);
  });

  it('calls everything added against an empty before', () => {
    expect(diffSchedules([], [at(0, 'M0001'), at(1, 'M0002')]).added).toBe(2);
  });

  it('calls everything removed against an empty after', () => {
    expect(diffSchedules([at(0, 'M0001'), at(1, 'M0002')], []).removed).toBe(2);
  });
});

describe('stability', () => {
  it('is one when nothing changed', () => {
    const log = [at(0, 'M0001'), at(1, 'M0002')];
    expect(stability(diffSchedules(log, log))).toBe(1);
  });

  it('falls as more of the schedule changes', () => {
    const before = [at(0, 'M0001'), at(1, 'M0002'), at(2, 'M0003'), at(3, 'M0004')];
    const one = diffSchedules(before, [
      at(0, 'M0009'),
      at(1, 'M0002'),
      at(2, 'M0003'),
      at(3, 'M0004'),
    ]);
    const two = diffSchedules(before, [
      at(0, 'M0009'),
      at(1, 'M0008'),
      at(2, 'M0003'),
      at(3, 'M0004'),
    ]);
    expect(stability(two)).toBeLessThan(stability(one));
  });

  it('is zero when everything was replaced', () => {
    expect(stability(diffSchedules([at(0, 'M0001')], [at(0, 'M0009')]))).toBe(0);
  });

  it('is one against an empty before', () => {
    expect(stability(diffSchedules([], [at(0, 'M0001')]))).toBe(1);
  });
});
