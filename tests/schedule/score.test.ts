import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  HEADROOM_CAP,
  STALENESS_CAP,
  compareScored,
  flowScore,
  maximumScore,
  scoreCandidate,
} from '../../src/schedule/score.js';
import type { ScoreInput } from '../../src/schedule/score.js';
import { WEEKDAYS, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import type { Play } from '../../src/rotation/rest.js';
import { tenths } from '../../src/util/duration.js';
import type { CartNumber } from '../../src/util/ids.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import type { ContextSpec } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;
const cart = (value: string): CartNumber => value as CartNumber;
const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));
const MID = expectOk(makeDaypart('MID', [{ days: [...WEEKDAYS], fromHour: 10, toHour: 15 }]));
const DAYPARTS = [AMD, MID];

function input(spec: ContextSpec = {}, over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    context: ruleContext(spec),
    plays: [],
    dayparts: DAYPARTS,
    daypart: -1,
    ...over,
  };
}

describe('flowScore', () => {
  it('is one when there is no previous cart to step from', () => {
    expect(flowScore(ruleContext())).toBe(1);
  });

  it('is one on no step at all', () => {
    const context = ruleContext({
      placed: [placed({ position: 8, at: at(0), tempo: 'medium' })],
      candidate: { tempo: 'medium' },
      slot: { position: 9, at: tenths(at(4)) },
    });
    expect(flowScore(context)).toBe(1);
  });

  it('falls as the step grows', () => {
    const step = (from: string, to: string) =>
      flowScore(
        ruleContext({
          placed: [placed({ position: 8, at: at(0), tempo: from })],
          candidate: { tempo: to },
          slot: { position: 9, at: tenths(at(4)) },
        }),
      );
    expect(step('medium', 'bright')).toBeGreaterThan(step('medium', 'driving'));
    expect(step('ballad', 'driving')).toBe(0);
  });
});

describe('scoreCandidate', () => {
  it('scores an empty log at the top of every part', () => {
    const parts = scoreCandidate(input());
    expect(parts.artist).toBe(1);
    expect(parts.title).toBe(1);
    expect(parts.recording).toBe(1);
    expect(parts.sound).toBe(1);
    expect(parts.flow).toBe(1);
    expect(parts.total).toBe(maximumScore());
  });

  it('scores a candidate that only just clears the artist minimum lower', () => {
    const tight = scoreCandidate(
      input({
        placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
        candidate: { billed: 'Dolly Parton' },
        slot: { at: tenths(at(76)) },
      }),
    );
    const roomy = scoreCandidate(
      input({
        placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
        candidate: { billed: 'Dolly Parton' },
        slot: { at: tenths(at(220)) },
      }),
    );
    expect(tight.artist).toBeLessThan(roomy.artist);
    expect(tight.total).toBeLessThan(roomy.total);
  });

  it('caps headroom, so extra room past the cap buys nothing', () => {
    const far = scoreCandidate(
      input({
        placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
        candidate: { billed: 'Dolly Parton' },
        slot: { at: tenths(at(225)) },
      }),
    );
    const further = scoreCandidate(input());
    expect(far.artist).toBe(1);
    expect(further.artist).toBe(1);
    expect(HEADROOM_CAP).toBe(3);
  });

  it('scores a jolt lower than a smooth step', () => {
    const jolt = scoreCandidate(
      input({
        placed: [placed({ position: 8, at: at(0), tempo: 'ballad' })],
        candidate: { tempo: 'driving' },
        slot: { position: 9, at: tenths(at(4)) },
      }),
    );
    const smooth = scoreCandidate(
      input({
        placed: [placed({ position: 8, at: at(0), tempo: 'medium' })],
        candidate: { tempo: 'bright' },
        slot: { position: 9, at: tenths(at(4)) },
      }),
    );
    expect(jolt.flow).toBeLessThan(smooth.flow);
  });

  it('scores staleness at the top when no daypart claims the slot', () => {
    expect(scoreCandidate(input({}, { daypart: -1 })).staleness).toBe(1);
  });

  it('prefers a cart the daypart has not heard lately', () => {
    const plays: Play[] = [
      { cart: cart('M0001'), at: 1, cell: cellOf(1, 7) },
      { cart: cart('M0001'), at: 2, cell: cellOf(1, 12) },
      { cart: cart('M0002'), at: 3, cell: cellOf(1, 12) },
    ];
    const fresh = scoreCandidate(input({ candidate: { number: 'M0001' } }, { plays, daypart: 0 }));
    const stale = scoreCandidate(input({ candidate: { number: 'M0002' } }, { plays, daypart: 0 }));
    expect(stale.staleness).toBeGreaterThan(fresh.staleness);
  });

  it('caps staleness for a cart that has never played in the daypart', () => {
    const never = scoreCandidate(input({ candidate: { number: 'M9999' } }, { daypart: 0 }));
    expect(never.staleness).toBe(1);
    expect(STALENESS_CAP).toBeGreaterThan(1);
  });

  it('normalises every part to at most one, so none can outweigh the rest', () => {
    const parts = scoreCandidate(input({ candidate: { number: 'M9999' } }, { daypart: 0 }));
    for (const value of [
      parts.artist,
      parts.title,
      parts.recording,
      parts.sound,
      parts.flow,
      parts.staleness,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(parts.total).toBeLessThanOrEqual(maximumScore());
  });

  it('honours weights that are given', () => {
    const flat = { ...DEFAULT_WEIGHTS, artist: 0 };
    const context = input({
      placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
      candidate: { billed: 'Dolly Parton' },
      slot: { at: tenths(at(76)) },
    });
    const weighted = scoreCandidate(context);
    const ignored = scoreCandidate({ ...context, weights: flat });
    expect(ignored.total).toBeGreaterThan(weighted.total - DEFAULT_WEIGHTS.artist);
    expect(maximumScore(flat)).toBeLessThan(maximumScore());
  });
});

describe('compareScored', () => {
  it('puts the higher total first', () => {
    const ordered = [
      { total: 3, cart: 'M0001' },
      { total: 9, cart: 'M0002' },
    ].sort(compareScored);
    expect(ordered[0]?.cart).toBe('M0002');
  });

  it('breaks a tie on the cart number', () => {
    const ordered = [
      { total: 5, cart: 'M0009' },
      { total: 5, cart: 'M0002' },
    ].sort(compareScored);
    expect(ordered.map((each) => each.cart)).toEqual(['M0002', 'M0009']);
  });

  it('gives the same order whichever way the list arrives', () => {
    const items = [
      { total: 5, cart: 'M0009' },
      { total: 5, cart: 'M0002' },
      { total: 7, cart: 'M0005' },
    ];
    const once = [...items].sort(compareScored).map((each) => each.cart);
    const again = [...items]
      .reverse()
      .sort(compareScored)
      .map((each) => each.cart);
    expect(again).toEqual(once);
  });

  it('returns zero for two identical entries', () => {
    expect(compareScored({ total: 5, cart: 'M0001' }, { total: 5, cart: 'M0001' })).toBe(0);
  });
});
