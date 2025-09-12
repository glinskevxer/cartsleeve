import { beforeEach, describe, expect, it } from 'vitest';
import {
  NO_PINS,
  PIN_BREACHES,
  PIN_MISSING,
  PIN_REFUSED,
  makePinMap,
  pinAt,
  pinKey,
  pinsOn,
  resolvePin,
  withPin,
  withoutPin,
} from '../../src/schedule/pin.js';
import { standardRuleSet } from '../../src/rules/tiers.js';
import { NO_RESTRICTIONS, makeRestrictionMap } from '../../src/library/restriction.js';
import { NO_WINDOWS } from '../../src/library/window.js';
import { WEEKDAYS, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import { makeScheduleView } from '../../src/rules/schedule-view.js';
import { tenths } from '../../src/util/duration.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import { libraryOf } from '../support/hour.js';
import { expectOk } from '../support/result.js';
import type { Pin } from '../../src/schedule/pin.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const DAY = { year: 2025, month: 6, day: 10 };
const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));

const pin = (over: Partial<Pin> = {}): Pin => ({
  day: DAY,
  hourIndex: 2,
  position: 4,
  cart: cart('M0001'),
  note: 'label chasing it',
  ...over,
});

describe('the pin map', () => {
  it('keys a pin by day, hour and position', () => {
    expect(pinKey(DAY, 2, 4)).toBe('2025-6-10:2:4');
  });

  it('finds a pin where one was set', () => {
    const map = makePinMap([pin()]);
    expect(pinAt(map, DAY, 2, 4)?.cart).toBe('M0001');
    expect(pinAt(map, DAY, 2, 5)).toBeUndefined();
    expect(pinAt(NO_PINS, DAY, 2, 4)).toBeUndefined();
  });

  it('does not confuse two days', () => {
    const map = makePinMap([pin()]);
    expect(pinAt(map, { year: 2025, month: 6, day: 11 }, 2, 4)).toBeUndefined();
  });

  it('adds and removes without touching the original', () => {
    const map = makePinMap([pin()]);
    const grown = withPin(map, pin({ position: 9, cart: cart('M0002') }));
    expect(pinAt(grown, DAY, 2, 9)?.cart).toBe('M0002');
    expect(pinAt(map, DAY, 2, 9)).toBeUndefined();
    expect(pinAt(withoutPin(grown, DAY, 2, 4), DAY, 2, 4)).toBeUndefined();
    expect(pinAt(grown, DAY, 2, 4)).toBeDefined();
  });

  it('replaces a pin on the same slot', () => {
    const map = withPin(makePinMap([pin()]), pin({ cart: cart('M0002') }));
    expect(map.byKey.size).toBe(1);
    expect(pinAt(map, DAY, 2, 4)?.cart).toBe('M0002');
  });

  it('lists the pins of a day in hour and position order', () => {
    const map = makePinMap([
      pin({ hourIndex: 5, position: 1 }),
      pin({ hourIndex: 2, position: 9 }),
      pin({ hourIndex: 2, position: 4 }),
      pin({ day: { year: 2025, month: 6, day: 11 }, hourIndex: 0, position: 0 }),
    ]);
    expect(pinsOn(map, DAY).map((each) => [each.hourIndex, each.position])).toEqual([
      [2, 4],
      [2, 9],
      [5, 1],
    ]);
  });

  it('lists nothing for a day with no pins', () => {
    expect(pinsOn(makePinMap([pin()]), { year: 2025, month: 7, day: 1 })).toEqual([]);
  });
});

describe('resolvePin', () => {
  const rules = () => standardRuleSet(NO_RESTRICTIONS, NO_WINDOWS);

  const LIBRARY = () =>
    libraryOf([
      { number: 'M0001', category: 'A', billed: 'Dolly Parton', title: 'Jolene' },
      { number: 'M0002', category: 'G', billed: 'Johnny Cash', title: 'Ring of Fire' },
      { number: 'J0003', billed: '', category: 'X', runtime: '0:10' },
    ]);

  /** Resolve a pin against a slot in category A with nothing scheduled. */
  const inA = (target: Pin, ruleSet = rules()) =>
    resolvePin(target, LIBRARY(), ruleSet, (entry) =>
      ruleContext({ candidate: entry, slot: { category: 'A' as CategoryCode } }),
    );

  it('honours a pin nothing objects to', () => {
    const outcome = inA(pin());
    expect(outcome.honoured).toBe(true);
    expect(outcome.problems).toEqual([]);
  });

  it('refuses a pin naming a cart the library does not have', () => {
    const outcome = inA(pin({ cart: cart('M9999') }));
    expect(outcome.honoured).toBe(false);
    expect(outcome.problems[0]?.code).toBe(PIN_MISSING);
  });

  it('refuses a pin whose cart is in the wrong category for the slot', () => {
    const outcome = inA(pin({ cart: cart('M0002') }));
    expect(outcome.honoured).toBe(false);
    expect(outcome.problems[0]?.code).toBe(PIN_REFUSED);
    expect(outcome.problems[0]?.detail?.['rule']).toBe('category match');
  });

  it('refuses a pin on a cart that is not music', () => {
    const outcome = inA(pin({ cart: cart('J0003') }));
    expect(outcome.honoured).toBe(false);
    expect(outcome.problems.some((each) => each.detail?.['rule'] === 'music only')).toBe(true);
  });

  it('refuses a pin on a cart restricted out of that hour', () => {
    const restrictions = expectOk(
      makeRestrictionMap([{ cart: cart('M0001'), mode: 'deny', dayparts: ['AMD'] }], [AMD]),
    );
    const outcome = resolvePin(
      pin(),
      LIBRARY(),
      standardRuleSet(restrictions, NO_WINDOWS),
      (entry) =>
        ruleContext({
          candidate: entry,
          slot: { category: 'A' as CategoryCode, cell: cellOf(1, 7) },
        }),
    );
    expect(outcome.honoured).toBe(false);
    expect(outcome.problems[0]?.detail?.['rule']).toBe('eligibility');
  });

  it('honours a pin that only breaks a taste rule, and says so', () => {
    const view = makeScheduleView([
      placed({ position: 0, at: 0, number: 'M0500', billed: 'Dolly Parton' }),
    ]);
    const outcome = resolvePin(pin(), LIBRARY(), rules(), (entry) => ({
      ...ruleContext({
        candidate: entry,
        slot: { category: 'A' as CategoryCode, at: tenths(12_000) },
      }),
      schedule: view,
    }));
    expect(outcome.honoured).toBe(true);
    expect(outcome.problems.length).toBeGreaterThan(0);
    expect(outcome.problems[0]?.code).toBe(PIN_BREACHES);
    expect(outcome.problems[0]?.severity).toBe('warning');
  });

  it('carries the note onto what it reports', () => {
    expect(inA(pin({ cart: cart('M0002') })).problems[0]?.detail?.['note']).toBe(
      'label chasing it',
    );
  });

  it('reports every rule that objected rather than the first', () => {
    expect(inA(pin({ cart: cart('J0003') })).problems.length).toBeGreaterThan(1);
  });
});
