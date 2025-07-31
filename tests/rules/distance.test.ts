import { beforeEach, describe, expect, it } from 'vitest';
import {
  HEADROOM_WINDOW,
  headroom,
  makeDistanceRule,
  nearestCollision,
} from '../../src/rules/distance.js';
import type { DistanceSpec } from '../../src/rules/distance.js';
import { artistSpec } from '../../src/rules/artist-separation.js';
import { titleSpec } from '../../src/rules/title-separation.js';
import { recordingSpec } from '../../src/rules/recording-separation.js';
import { soundSpec } from '../../src/rules/sound-separation.js';
import { packageSpec } from '../../src/rules/package-separation.js';
import { fromMinutes, tenths } from '../../src/util/duration.js';
import type { Tenths } from '../../src/util/duration.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';
import type { EntrySpec } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;

/** A spec that matches any placement, so the core can be tested on its own. */
function everything(minimum: number): DistanceSpec {
  return {
    name: 'test',
    tier: 1,
    code: 'RUL-999',
    minimum: () => tenths(minimum),
    match: () => ({ what: 'anything', detail: { why: 'always' } }),
    message: (collision, minutes, needed) => `${collision.what} at ${minutes} needs ${needed}`,
  };
}

const nothing: DistanceSpec = { ...everything(fromMinutes(60)), match: () => undefined };

const withPlacements = (times: readonly number[], slotAt: number) =>
  ruleContext({
    placed: times.map((minutes, index) =>
      placed({ position: index, at: at(minutes), number: `M000${index + 1}` }),
    ),
    slot: { position: 50, at: tenths(at(slotAt)) },
  });

describe('nearestCollision', () => {
  const spec = everything(fromMinutes(60));

  it('finds the nearest match, not the first', () => {
    expect(nearestCollision(withPlacements([0, 30, 55], 60), fromMinutes(90), spec)?.cart).toBe(
      'M0003',
    );
  });

  it('measures in both directions', () => {
    const context = withPlacements([50, 80], 60);
    expect(nearestCollision(context, fromMinutes(90), spec)?.cart).toBe('M0001');
    expect(nearestCollision(context, fromMinutes(90), spec)?.distance).toBe(at(10));
  });

  it('stays inside the window', () => {
    const context = withPlacements([0], 60);
    expect(nearestCollision(context, fromMinutes(59), spec)).toBeUndefined();
    expect(nearestCollision(context, fromMinutes(60), spec)).toBeDefined();
  });

  it('skips the slot being filled', () => {
    const context = ruleContext({
      placed: [placed({ position: 50, at: at(60), number: 'M0001' })],
      slot: { position: 50, at: tenths(at(60)) },
    });
    expect(nearestCollision(context, fromMinutes(90), spec)).toBeUndefined();
  });

  it('finds nothing when the spec matches nothing', () => {
    expect(nearestCollision(withPlacements([0, 30], 60), fromMinutes(90), nothing)).toBeUndefined();
  });

  it('carries the spec detail through onto the collision', () => {
    const found = nearestCollision(withPlacements([50], 60), fromMinutes(90), spec);
    expect(found?.what).toBe('anything');
    expect(found?.detail).toEqual({ why: 'always' });
  });

  it('finds nothing on an empty log', () => {
    expect(nearestCollision(ruleContext(), fromMinutes(90), spec)).toBeUndefined();
  });
});

describe('makeDistanceRule', () => {
  it('passes when nothing is inside the minimum', () => {
    expect(
      makeDistanceRule(everything(fromMinutes(30))).evaluate(withPlacements([0], 60)).passed,
    ).toBe(true);
  });

  it('passes exactly on the minimum', () => {
    expect(
      makeDistanceRule(everything(fromMinutes(60))).evaluate(withPlacements([0], 60)).passed,
    ).toBe(true);
  });

  it('rejects just inside it, with the shortfall in tenths', () => {
    const verdict = makeDistanceRule(everything(fromMinutes(60))).evaluate(withPlacements([1], 60));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe('RUL-999');
      expect(verdict.failure.shortfall).toBe(at(1));
      expect(verdict.failure.message).toBe('anything at 59 needs 60');
    }
  });

  it('always reports the cart, the minutes and what was needed', () => {
    const verdict = makeDistanceRule(everything(fromMinutes(60))).evaluate(
      withPlacements([30], 60),
    );
    if (!verdict.passed) {
      expect(verdict.failure.detail).toEqual({
        why: 'always',
        against: 'M0001',
        minutes: 30,
        needed: 60,
      });
    }
  });

  it('is off entirely when the minimum is zero or less', () => {
    const off = makeDistanceRule({ ...everything(0), minimum: () => tenths(0) });
    expect(off.evaluate(withPlacements([0], 0)).passed).toBe(true);
    const negative = makeDistanceRule({ ...everything(0), minimum: () => tenths(-5) });
    expect(negative.evaluate(withPlacements([0], 0)).passed).toBe(true);
  });

  it('takes its name and tier off the spec', () => {
    const rule = makeDistanceRule(everything(fromMinutes(60)));
    expect(rule.name).toBe('test');
    expect(rule.tier).toBe(1);
  });
});

describe('headroom', () => {
  const spec = everything(fromMinutes(60));

  it('is one exactly on the minimum', () => {
    expect(headroom(withPlacements([0], 60), spec)).toBe(1);
  });

  it('is below one inside the minimum', () => {
    expect(headroom(withPlacements([30], 60), spec)).toBe(0.5);
  });

  it('caps at the window rather than running to infinity', () => {
    expect(headroom(ruleContext(), spec)).toBe(HEADROOM_WINDOW);
  });

  it('is infinite only when the rule does not apply', () => {
    const off = { ...spec, minimum: (): Tenths => tenths(0) };
    expect(headroom(withPlacements([0], 0), off)).toBe(Number.POSITIVE_INFINITY);
  });

  it('agrees with the rule about where the line is', () => {
    const rule = makeDistanceRule(spec);
    for (const minutes of [10, 30, 59, 60, 90]) {
      const context = withPlacements([0], minutes);
      expect(headroom(context, spec) >= 1).toBe(rule.evaluate(context).passed);
    }
  });
});

describe('every separation rule is built on the core', () => {
  const specs: readonly DistanceSpec[] = [
    artistSpec,
    titleSpec,
    recordingSpec,
    soundSpec,
    packageSpec,
  ];

  it('gives each one a distinct name and code', () => {
    expect(new Set(specs.map((spec) => spec.name)).size).toBe(specs.length);
    expect(new Set(specs.map((spec) => spec.code)).size).toBe(specs.length);
  });

  it('has every one skip the slot it is filling', () => {
    for (const spec of specs) {
      resetFixtures();
      const shared = {
        billed: 'Dolly Parton',
        title: 'Jolene',
        isrc: 'USRC17607839',
        sounds: ['fiddle'],
      };
      const context = ruleContext({
        placed: [placed({ position: 50, at: at(60), number: 'M0001', ...shared })],
        candidate: { number: 'M0001', ...shared },
        slot: { position: 50, at: tenths(at(60)) },
      });
      expect(makeDistanceRule(spec).evaluate(context).passed).toBe(true);
    }
  });

  it('has every one pass on an empty log', () => {
    for (const spec of specs) {
      expect(makeDistanceRule(spec).evaluate(ruleContext()).passed).toBe(true);
    }
  });

  it('has every one report against, minutes and needed on a rejection', () => {
    // Each spec needs its own collision: the package rule deliberately ignores
    // two placements of the same master, so one shared fixture cannot trip it.
    const cases: readonly { spec: DistanceSpec; shared: EntrySpec; other: EntrySpec }[] = [
      {
        spec: artistSpec,
        shared: { billed: 'Dolly Parton' },
        other: { billed: 'Dolly Parton' },
      },
      {
        spec: titleSpec,
        shared: { title: 'Jolene', isrc: 'USRC17607839' },
        other: { title: 'Jolene', isrc: 'GBAYE0601498' },
      },
      {
        spec: recordingSpec,
        shared: { isrc: 'USRC17607839' },
        other: { isrc: 'USRC17607839' },
      },
      { spec: soundSpec, shared: { sounds: ['fiddle'] }, other: { sounds: ['violin'] } },
      {
        spec: packageSpec,
        shared: { isrc: 'USRC17600101' },
        other: { isrc: 'USRC17600104' },
      },
    ];
    for (const { spec, shared, other } of cases) {
      resetFixtures();
      const context = ruleContext({
        placed: [placed({ position: 0, at: at(0), number: 'M0001', ...shared })],
        candidate: { number: 'M0500', ...other },
        slot: { position: 1, at: tenths(at(2)) },
      });
      const verdict = makeDistanceRule(spec).evaluate(context);
      expect(verdict.passed, spec.name).toBe(false);
      if (!verdict.passed) {
        expect(verdict.failure.detail?.['against']).toBe('M0001');
        expect(verdict.failure.detail?.['minutes']).toBe(2);
        expect(verdict.failure.shortfall).toBeGreaterThan(0);
      }
    }
  });

  it('orders the tiers so the tighter rules survive relaxation longest', () => {
    expect(recordingSpec.tier).toBeLessThan(artistSpec.tier);
    expect(artistSpec.tier).toBeLessThan(soundSpec.tier);
    expect(soundSpec.tier).toBeLessThan(packageSpec.tier);
  });
});
