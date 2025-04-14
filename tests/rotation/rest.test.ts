import { describe, expect, it } from 'vitest';
import {
  NO_PLAYS,
  allPlaysWithin,
  isUnplayed,
  lastPlayed,
  makePlayHistory,
  playCount,
  playsWithin,
  prune,
  restHours,
  restMillis,
  withPlay,
  withPlays,
} from '../../src/rotation/rest.js';
import type { Play } from '../../src/rotation/rest.js';
import type { CartNumber } from '../../src/util/ids.js';
import { HOUR_MS } from '../../src/util/time.js';

const cart = (value: string): CartNumber => value as CartNumber;
const NOW = 1_000 * HOUR_MS;

function play(number: string, hoursAgo: number, cell = 0): Play {
  return { cart: cart(number), at: NOW - hoursAgo * HOUR_MS, cell };
}

const HISTORY = makePlayHistory([
  play('M0001', 30),
  play('M0002', 12),
  play('M0001', 6),
  play('M0003', 200),
]);

describe('makePlayHistory', () => {
  it('remembers the most recent play of each cart', () => {
    expect(lastPlayed(HISTORY, cart('M0001'))).toBe(NOW - 6 * HOUR_MS);
    expect(lastPlayed(HISTORY, cart('M0002'))).toBe(NOW - 12 * HOUR_MS);
    expect(lastPlayed(HISTORY, cart('M9999'))).toBeUndefined();
  });

  it('takes the latest even when the plays arrive out of order', () => {
    const history = makePlayHistory([play('M0001', 6), play('M0001', 30)]);
    expect(lastPlayed(history, cart('M0001'))).toBe(NOW - 6 * HOUR_MS);
  });

  it('counts the plays of each cart', () => {
    expect(playCount(HISTORY, cart('M0001'))).toBe(2);
    expect(playCount(HISTORY, cart('M0002'))).toBe(1);
    expect(playCount(HISTORY, cart('M9999'))).toBe(0);
  });

  it('handles an empty history', () => {
    expect(NO_PLAYS.plays).toEqual([]);
    expect(playCount(NO_PLAYS, cart('M0001'))).toBe(0);
    expect(lastPlayed(NO_PLAYS, cart('M0001'))).toBeUndefined();
  });
});

describe('restHours', () => {
  it('measures hours since the last play', () => {
    expect(restHours(HISTORY, cart('M0001'), NOW)).toBe(6);
    expect(restHours(HISTORY, cart('M0002'), NOW)).toBe(12);
    expect(restHours(HISTORY, cart('M0003'), NOW)).toBe(200);
  });

  it('rests a never played cart infinitely, so it goes first', () => {
    expect(restHours(HISTORY, cart('M9999'), NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(isUnplayed(HISTORY, cart('M9999'))).toBe(true);
    expect(isUnplayed(HISTORY, cart('M0001'))).toBe(false);
  });

  it('puts a never played cart ahead of everything in a rest ordering', () => {
    const carts = [cart('M0001'), cart('M0003'), cart('M9999')];
    const ordered = [...carts].sort(
      (a, b) => restHours(HISTORY, b, NOW) - restHours(HISTORY, a, NOW),
    );
    expect(ordered[0]).toBe('M9999');
  });

  it('grows as the clock moves on', () => {
    expect(restHours(HISTORY, cart('M0001'), NOW + 4 * HOUR_MS)).toBe(10);
  });

  it('reports the same thing in milliseconds', () => {
    expect(restMillis(HISTORY, cart('M0001'), NOW)).toBe(6 * HOUR_MS);
    expect(restMillis(HISTORY, cart('M9999'), NOW)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('playsWithin', () => {
  it('finds only the plays of that cart inside the window', () => {
    expect(playsWithin(HISTORY, cart('M0001'), NOW, 12 * HOUR_MS)).toHaveLength(1);
    expect(playsWithin(HISTORY, cart('M0001'), NOW, 48 * HOUR_MS)).toHaveLength(2);
  });

  it('excludes a play exactly on the far edge, and includes one just inside', () => {
    expect(playsWithin(HISTORY, cart('M0001'), NOW, 6 * HOUR_MS)).toHaveLength(0);
    expect(playsWithin(HISTORY, cart('M0001'), NOW, 6 * HOUR_MS + 1)).toHaveLength(1);
    expect(playsWithin(HISTORY, cart('M0002'), NOW, 12 * HOUR_MS)).toHaveLength(0);
    expect(playsWithin(HISTORY, cart('M0002'), NOW, 13 * HOUR_MS)).toHaveLength(1);
  });

  it('excludes a play in the future of the moment asked about', () => {
    expect(playsWithin(HISTORY, cart('M0001'), NOW - 10 * HOUR_MS, 48 * HOUR_MS)).toHaveLength(1);
  });

  it('finds nothing for a cart that never played', () => {
    expect(playsWithin(HISTORY, cart('M9999'), NOW, 48 * HOUR_MS)).toEqual([]);
  });

  it('walks every cart when asked for all of them', () => {
    expect(allPlaysWithin(HISTORY, NOW, 24 * HOUR_MS)).toHaveLength(2);
    expect(allPlaysWithin(HISTORY, NOW, 48 * HOUR_MS)).toHaveLength(3);
    expect(allPlaysWithin(HISTORY, NOW, 0)).toEqual([]);
  });
});

describe('extending and pruning', () => {
  it('adds one play and moves the rest', () => {
    const grown = withPlay(HISTORY, play('M0003', 1));
    expect(restHours(grown, cart('M0003'), NOW)).toBe(1);
    expect(restHours(HISTORY, cart('M0003'), NOW)).toBe(200);
  });

  it('adds several at once', () => {
    const grown = withPlays(HISTORY, [play('M0004', 2), play('M0005', 3)]);
    expect(grown.plays).toHaveLength(6);
    expect(playCount(grown, cart('M0004'))).toBe(1);
  });

  it('drops plays older than the floor', () => {
    const pruned = prune(HISTORY, NOW - 48 * HOUR_MS);
    expect(pruned.plays).toHaveLength(3);
    expect(isUnplayed(pruned, cart('M0003'))).toBe(true);
  });

  it('keeps a play exactly on the floor', () => {
    const pruned = prune(HISTORY, NOW - 30 * HOUR_MS);
    expect(pruned.plays).toHaveLength(3);
  });

  it('prunes to nothing when the floor is past everything', () => {
    expect(prune(HISTORY, NOW + HOUR_MS).plays).toEqual([]);
  });
});
