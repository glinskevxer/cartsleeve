import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARTIST_TOO_CLOSE,
  HEADROOM_WINDOW,
  artistHeadroom,
  artistMinimum,
  artistSeparation,
  nearestArtistCollision,
} from '../../src/rules/artist-separation.js';
import { fromMinutes, tenths } from '../../src/util/duration.js';
import { makeCategory } from '../../src/domain/category.js';
import type { Category } from '../../src/domain/category.js';
import type { CategoryCode } from '../../src/util/ids.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import type { ContextSpec } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

/** Category A asks for 75 minutes between two carts by the same artist. */
const MINIMUM = fromMinutes(75);

const at = (minutes: number): number => minutes * 600;

/** One Dolly Parton cart at the top of the hour, and a Dolly candidate. */
function dolly(minutes: number, extra: ContextSpec = {}) {
  return ruleContext({
    placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
    candidate: { billed: 'Dolly Parton' },
    slot: { at: tenths(at(minutes)) },
    ...extra,
  });
}

describe('artistMinimum', () => {
  it('reads the minimum off the slot category', () => {
    expect(artistMinimum(ruleContext())).toBe(MINIMUM);
  });

  it('is nothing for a category nothing defines', () => {
    expect(artistMinimum(ruleContext({ slot: { category: 'Z' as CategoryCode } }))).toBe(0);
  });
});

describe('artistSeparation', () => {
  it('passes when nothing by that artist is anywhere near', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), billed: 'Johnny Cash' })],
      candidate: { billed: 'Dolly Parton' },
      slot: { at: tenths(at(20)) },
    });
    expect(artistSeparation.evaluate(context).passed).toBe(true);
  });

  it('passes when the same artist is exactly the minimum away', () => {
    expect(artistSeparation.evaluate(dolly(75)).passed).toBe(true);
  });

  it('rejects when the same artist is inside the minimum', () => {
    const verdict = artistSeparation.evaluate(dolly(38));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(ARTIST_TOO_CLOSE);
      expect(verdict.failure.detail?.['minutes']).toBe(38);
      expect(verdict.failure.detail?.['needed']).toBe(75);
      expect(verdict.failure.shortfall).toBe(MINIMUM - at(38));
    }
  });

  it('measures backwards as readily as forwards', () => {
    const context = ruleContext({
      placed: [placed({ position: 20, at: at(100), billed: 'Dolly Parton' })],
      candidate: { billed: 'Dolly Parton' },
      slot: { position: 9, at: tenths(at(60)) },
    });
    expect(artistSeparation.evaluate(context).passed).toBe(false);
  });

  it('names the nearer of two collisions', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', billed: 'Dolly Parton' }),
        placed({ position: 1, at: at(30), number: 'M0002', billed: 'Dolly Parton' }),
      ],
      candidate: { billed: 'Dolly Parton' },
      slot: { at: tenths(at(40)) },
    });
    const collision = nearestArtistCollision(context, MINIMUM);
    expect(collision?.cart).toBe('M0002');
    expect(collision?.distance).toBe(at(10));
  });

  it('ignores the slot it is filling', () => {
    const context = ruleContext({
      placed: [placed({ position: 9, at: at(40), billed: 'Dolly Parton' })],
      candidate: { billed: 'Dolly Parton' },
      slot: { position: 9, at: tenths(at(40)) },
    });
    expect(artistSeparation.evaluate(context).passed).toBe(true);
  });

  it('passes a candidate with no artist at all', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), billed: 'Dolly Parton' })],
      candidate: { number: 'J0001', billed: '', category: 'X' },
      slot: { at: tenths(at(10)) },
    });
    expect(artistSeparation.evaluate(context).passed).toBe(true);
  });

  it('passes when the category asks for no separation at all', () => {
    const open = expectOk(makeCategory({ code: 'A', name: 'open', artistMinutes: 0 }));
    const context = dolly(1, {
      categories: new Map<CategoryCode, Category>([[open.code, open]]),
    });
    expect(artistSeparation.evaluate(context).passed).toBe(true);
  });

  it('passes on an empty log', () => {
    expect(artistSeparation.evaluate(ruleContext()).passed).toBe(true);
  });
});

describe('the rule reads wall clock, not running order', () => {
  it('turns a legal pair illegal when the music moves later', () => {
    expect(artistSeparation.evaluate(dolly(76)).passed).toBe(true);
    expect(artistSeparation.evaluate(dolly(74)).passed).toBe(false);
  });

  it('does not care how many songs sit between them', () => {
    const many = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', billed: 'Dolly Parton' }),
        placed({ position: 1, at: at(4), number: 'M0002', billed: 'Johnny Cash' }),
        placed({ position: 2, at: at(8), number: 'M0003', billed: 'Merle Haggard' }),
        placed({ position: 3, at: at(12), number: 'M0004', billed: 'Emmylou Harris' }),
      ],
      candidate: { billed: 'Dolly Parton' },
      slot: { at: tenths(at(16)) },
    });
    expect(artistSeparation.evaluate(many).passed).toBe(false);
  });

  it('would pass the same running order if the hour ran longer', () => {
    const spread = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', billed: 'Dolly Parton' }),
        placed({ position: 1, at: at(25), number: 'M0002', billed: 'Johnny Cash' }),
        placed({ position: 2, at: at(50), number: 'M0003', billed: 'Merle Haggard' }),
      ],
      candidate: { billed: 'Dolly Parton' },
      slot: { at: tenths(at(80)) },
    });
    expect(artistSeparation.evaluate(spread).passed).toBe(true);
  });
});

describe('artistHeadroom', () => {
  it('is one when the candidate sits exactly on the minimum', () => {
    expect(artistHeadroom(dolly(75))).toBe(1);
  });

  it('is below one when the rule would reject', () => {
    expect(artistHeadroom(dolly(38))).toBeLessThan(1);
  });

  it('caps at the window rather than running to infinity', () => {
    const context = ruleContext({
      candidate: { billed: 'Dolly Parton' },
      slot: { at: tenths(at(1000)) },
    });
    expect(artistHeadroom(context)).toBe(HEADROOM_WINDOW);
  });

  it('is infinite only when the rule does not apply', () => {
    const open = expectOk(makeCategory({ code: 'A', name: 'open', artistMinutes: 0 }));
    const context = ruleContext({
      categories: new Map<CategoryCode, Category>([[open.code, open]]),
      candidate: { billed: 'Dolly Parton' },
    });
    expect(artistHeadroom(context)).toBe(Number.POSITIVE_INFINITY);
  });

  it('prefers the candidate with more room between two that both pass', () => {
    expect(artistHeadroom(dolly(120))).toBeGreaterThan(artistHeadroom(dolly(80)));
  });

  it('agrees with the rule about where the line is', () => {
    for (const minutes of [30, 60, 74, 75, 90]) {
      const passes = artistSeparation.evaluate(dolly(minutes)).passed;
      expect(artistHeadroom(dolly(minutes)) >= 1).toBe(passes);
    }
  });
});
