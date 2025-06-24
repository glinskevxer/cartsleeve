import { beforeEach, describe, expect, it } from 'vitest';
import {
  FEATURED_FRACTION,
  FEATURED_TOO_CLOSE,
  featuredMinimum,
  featuredSeparation,
  invisibleCollisions,
  nearestCreditCollision,
  uncountedCredits,
} from '../../src/rules/featured.js';
import { artistSeparation } from '../../src/rules/artist-separation.js';
import { fromMinutes, tenths } from '../../src/util/duration.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import type { ContextSpec } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;

/** A Dolly feature at the top of the hour, and another Dolly feature later. */
function twoFeatures(minutes: number, extra: ContextSpec = {}) {
  return ruleContext({
    placed: [placed({ position: 0, at: at(0), billed: 'Johnny Cash feat. Dolly Parton' })],
    candidate: { billed: 'Emmylou Harris feat. Dolly Parton' },
    slot: { at: tenths(at(minutes)) },
    ...extra,
  });
}

describe('featuredMinimum', () => {
  it('is a fraction of the billed minimum', () => {
    expect(featuredMinimum(ruleContext())).toBe(fromMinutes(75) * FEATURED_FRACTION);
    expect(FEATURED_FRACTION).toBeLessThan(1);
  });
});

describe('uncountedCredits', () => {
  it('names the guests the billed policy is ignoring', () => {
    const context = ruleContext({ candidate: { billed: 'Johnny Cash feat. Dolly Parton' } });
    expect(uncountedCredits(context)).toEqual(['DOLLY PARTON']);
  });

  it('names nothing under strict credit, which counts them all', () => {
    const context = ruleContext({
      candidate: { billed: 'Johnny Cash feat. Dolly Parton' },
      stationOptions: { creditPolicy: 'strict' },
    });
    expect(uncountedCredits(context)).toEqual([]);
  });

  it('names nothing on a solo record', () => {
    expect(uncountedCredits(ruleContext({ candidate: { billed: 'Johnny Cash' } }))).toEqual([]);
  });
});

describe('the same collision graded three ways', () => {
  const distance = 20;

  it('is invisible to artist separation under the billed policy', () => {
    expect(artistSeparation.evaluate(twoFeatures(distance)).passed).toBe(true);
  });

  it('is a hard breach under the strict policy', () => {
    const strict = twoFeatures(distance, { stationOptions: { creditPolicy: 'strict' } });
    expect(artistSeparation.evaluate(strict).passed).toBe(false);
  });

  it('is a soft breach under the featured rule', () => {
    const verdict = featuredSeparation.evaluate(twoFeatures(distance));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(FEATURED_TOO_CLOSE);
      expect(verdict.failure.detail?.['artist']).toBe('DOLLY PARTON');
    }
  });

  it('sits at a tier the scheduler may relax, unlike artist separation', () => {
    expect(featuredSeparation.tier).toBeGreaterThan(artistSeparation.tier);
    expect(artistSeparation.tier).toBeGreaterThan(0);
  });
});

describe('featuredSeparation', () => {
  it('passes when the features are further apart than the reduced minimum', () => {
    expect(featuredSeparation.evaluate(twoFeatures(40)).passed).toBe(true);
  });

  it('passes exactly on the reduced minimum', () => {
    expect(featuredSeparation.evaluate(twoFeatures(37.5)).passed).toBe(true);
  });

  it('rejects just inside it', () => {
    expect(featuredSeparation.evaluate(twoFeatures(37)).passed).toBe(false);
  });

  it('catches a primary against a feature, not only feature against feature', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
      candidate: { billed: 'Emmylou Harris feat. Dolly Parton' },
      slot: { at: tenths(at(20)) },
    });
    expect(featuredSeparation.evaluate(context).passed).toBe(false);
  });

  it('passes a candidate with no credits', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
      candidate: { number: 'J0001', billed: '', category: 'X' },
      slot: { at: tenths(at(1)) },
    });
    expect(featuredSeparation.evaluate(context).passed).toBe(true);
  });

  it('passes on an empty log', () => {
    expect(featuredSeparation.evaluate(ruleContext()).passed).toBe(true);
  });

  it('ignores the slot it is filling', () => {
    const context = ruleContext({
      placed: [placed({ position: 9, at: at(0), billed: 'Johnny Cash feat. Dolly Parton' })],
      candidate: { billed: 'Emmylou Harris feat. Dolly Parton' },
      slot: { position: 9, at: tenths(at(0)) },
    });
    expect(featuredSeparation.evaluate(context).passed).toBe(true);
  });

  it('names the nearer of two credit collisions', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', billed: 'A feat. Dolly Parton' }),
        placed({ position: 1, at: at(25), number: 'M0002', billed: 'B feat. Dolly Parton' }),
      ],
      candidate: { billed: 'C feat. Dolly Parton' },
      slot: { at: tenths(at(30)) },
    });
    expect(nearestCreditCollision(context, fromMinutes(75))?.cart).toBe('M0002');
  });
});

describe('invisibleCollisions', () => {
  it('reports what the billed policy cannot see', () => {
    const found = invisibleCollisions(twoFeatures(20));
    expect(found).toHaveLength(1);
    expect(found[0]?.artist).toBe('DOLLY PARTON');
  });

  it('reports nothing under strict credit, which sees everything', () => {
    const strict = twoFeatures(20, { stationOptions: { creditPolicy: 'strict' } });
    expect(invisibleCollisions(strict)).toEqual([]);
  });

  it('reports nothing when the collision is on the billed primary of both', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
      candidate: { billed: 'Dolly Parton' },
      slot: { at: tenths(at(20)) },
    });
    expect(invisibleCollisions(context)).toEqual([]);
    expect(artistSeparation.evaluate(context).passed).toBe(false);
  });

  it('reports nothing outside the full artist minimum', () => {
    expect(invisibleCollisions(twoFeatures(80))).toEqual([]);
  });

  it('reports a primary against a feature, which billed also misses', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
      candidate: { billed: 'Emmylou Harris feat. Dolly Parton' },
      slot: { at: tenths(at(20)) },
    });
    expect(invisibleCollisions(context).map((each) => each.artist)).toEqual(['DOLLY PARTON']);
    expect(artistSeparation.evaluate(context).passed).toBe(true);
  });
});
