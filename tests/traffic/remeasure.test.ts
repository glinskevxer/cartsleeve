import { beforeEach, describe, expect, it } from 'vitest';
import {
  CAUSED_BY_TRAFFIC,
  movementBehind,
  newlyBreached,
  placementsFrom,
  remeasure,
} from '../../src/traffic/remeasure.js';
import { mergeTraffic } from '../../src/traffic/merge.js';
import { makeSpot } from '../../src/traffic/spot.js';
import type { Spot } from '../../src/traffic/spot.js';
import { fillHour } from '../../src/schedule/hour.js';
import { standardRuleSet } from '../../src/rules/tiers.js';
import { NO_RESTRICTIONS } from '../../src/library/restriction.js';
import { NO_WINDOWS } from '../../src/library/window.js';
import { STANDARD_FAMILIES, makeSoundIndex } from '../../src/library/sounds.js';
import { COUNTRY_BANDS, makeEraMap } from '../../src/library/era.js';
import { tenths } from '../../src/util/duration.js';
import type { Breach } from '../../src/schedule/breach.js';
import type { CartNumber } from '../../src/util/ids.js';
import type { RuleContext, Slot } from '../../src/rules/rule.js';
import { CATEGORIES } from '../support/context.js';
import type { EntrySpec } from '../support/fixtures.js';
import { entry, resetFixtures, station } from '../support/fixtures.js';
import { clockOf, hourInput, libraryOf } from '../support/hour.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

function spot(id: string, length: string): Spot {
  return expectOk(makeSpot({ id, orderId: 'ORD-1', cart: 'C0455', length }));
}

/**
 * Two gold records by one artist with a long break between them. Gold asks for
 * forty five minutes of artist separation. On the budgeted timing the pair is
 * forty seven minutes apart and clears it; once the break sells short they are
 * four minutes apart and do not.
 */
const PAIR: EntrySpec[] = [
  {
    number: 'M0001',
    category: 'G',
    billed: 'Dolly Parton',
    title: 'Jolene',
    runtime: '3:00',
    releaseYear: 1974,
  },
  {
    number: 'M0002',
    category: 'G',
    billed: 'Dolly Parton',
    title: 'Coat of Many Colors',
    runtime: '3:00',
    releaseYear: 1995,
  },
];

const CLOCK = () =>
  clockOf([
    { kind: 'music', target: '0:00', category: 'G' },
    { kind: 'stopset', target: '3:00', name: 'break one', budget: '44:00' },
    { kind: 'music', target: '47:00', category: 'G' },
  ]);

const scheduled = () => fillHour(hourInput({ clock: CLOCK(), library: libraryOf(PAIR) }));
const rules = () => standardRuleSet(NO_RESTRICTIONS, NO_WINDOWS);

const sounds = expectOk(makeSoundIndex(STANDARD_FAMILIES));
const eras = expectOk(makeEraMap(COUNTRY_BANDS));

/** The remeasure supplies the schedule, slot and candidate itself. */
function contextFor(slot: Slot): RuleContext {
  return {
    station: station(),
    categories: CATEGORIES,
    sounds,
    eras,
    schedule: {
      before: () => [],
      after: () => [],
      within: () => [],
      previous: () => undefined,
      count: 0,
    },
    slot,
    candidate: entry({ number: 'M0001' }),
  };
}

const merged = (breakLength: string) =>
  mergeTraffic({
    slots: scheduled().slots,
    spotsFor: () => [spot('SPT-1', breakLength)],
    startsAt: tenths(0),
  });

describe('placementsFrom', () => {
  it('takes the merged times rather than the scheduled ones', () => {
    const placements = placementsFrom(merged('1:00').slots);
    expect(placements).toHaveLength(2);
    expect(placements[1]?.at).toBe(1800 + 600);
  });

  it('leaves out breaks and anything that was not filled', () => {
    expect(placementsFrom(merged('1:00').slots).every((each) => each.cart.startsWith('M'))).toBe(
      true,
    );
  });

  it('takes nothing from nothing', () => {
    expect(placementsFrom([])).toEqual([]);
  });
});

describe('remeasure', () => {
  it('finds nothing when the breaks sold to budget', () => {
    const before = scheduled();
    expect(before.breaches).toBe(0);
    const outcome = remeasure({
      slots: merged('44:00').slots,
      rules: rules(),
      tier: 2,
      contextFor,
    });
    expect(outcome.breaches).toEqual([]);
    expect(outcome.problems).toEqual([]);
    expect(outcome.checked).toBe(2);
  });

  it('finds a separation breach once the break sold short', () => {
    expect(scheduled().breaches).toBe(0);
    const outcome = remeasure({ slots: merged('1:00').slots, rules: rules(), tier: 2, contextFor });
    expect(outcome.breaches.length).toBeGreaterThan(0);
    expect(outcome.breaches.map((each) => each.rule)).toContain('artist separation');
  });

  it('says the traffic caused it rather than the scheduler', () => {
    const outcome = remeasure({ slots: merged('1:00').slots, rules: rules(), tier: 2, contextFor });
    expect(outcome.problems[0]?.code).toBe(CAUSED_BY_TRAFFIC);
    expect(outcome.problems[0]?.message).toContain('did not when it was scheduled');
  });

  it('checks nothing in an empty hour', () => {
    const outcome = remeasure({ slots: [], rules: rules(), tier: 2, contextFor });
    expect(outcome.checked).toBe(0);
    expect(outcome.breaches).toEqual([]);
  });

  it('honours the tier, so nothing already relaxed is counted again', () => {
    const strict = remeasure({ slots: merged('1:00').slots, rules: rules(), tier: 2, contextFor });
    const loose = remeasure({ slots: merged('1:00').slots, rules: rules(), tier: 0, contextFor });
    expect(loose.breaches.length).toBeLessThan(strict.breaches.length);
  });
});

describe('reporting on it', () => {
  const breach = (over: Partial<Breach> = {}): Breach => ({
    position: 0,
    at: tenths(0),
    cart: 'M0001' as CartNumber,
    rule: 'tempo flow',
    tier: 5,
    code: 'RUL-006',
    message: 'a jump',
    shortfall: 1,
    detail: {},
    ...over,
  });

  it('says how far the merge moved a slot', () => {
    expect(movementBehind(merged('1:00').slots, 2)).toBe(-25_800);
    expect(movementBehind(merged('1:00').slots, 99)).toBe(0);
  });

  it('finds the breaches that were not there before', () => {
    const before = [breach()];
    const after = [...before, breach({ position: 2, rule: 'artist separation', tier: 2 })];
    expect(newlyBreached(before, after).map((each) => each.rule)).toEqual(['artist separation']);
  });

  it('finds nothing new when the breaches are the same', () => {
    const list = [breach()];
    expect(newlyBreached(list, list)).toEqual([]);
    expect(newlyBreached([], [])).toEqual([]);
  });

  it('treats the same rule at a different slot as new', () => {
    expect(newlyBreached([breach()], [breach({ position: 4 })])).toHaveLength(1);
  });
});
