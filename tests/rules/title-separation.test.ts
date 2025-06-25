import { beforeEach, describe, expect, it } from 'vitest';
import {
  TITLE_TOO_CLOSE,
  candidateTitle,
  coversNear,
  nearestTitleCollision,
  titleMinimum,
  titleSeparation,
} from '../../src/rules/title-separation.js';
import { fromMinutes, tenths } from '../../src/util/duration.js';
import type { CategoryCode } from '../../src/util/ids.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import type { ContextSpec } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;
const MINIMUM = fromMinutes(150);

/** The same master twice, `minutes` apart. */
function sameMaster(minutes: number, extra: ContextSpec = {}) {
  return ruleContext({
    placed: [
      placed({ position: 0, at: at(0), number: 'M0001', isrc: 'USRC17607839', title: 'Jolene' }),
    ],
    candidate: { number: 'M0009', isrc: 'USRC17607839', title: 'Jolene' },
    slot: { at: tenths(at(minutes)) },
    ...extra,
  });
}

/** A cover of the same song, `minutes` apart. */
function cover(minutes: number, extra: ContextSpec = {}) {
  return ruleContext({
    placed: [
      placed({ position: 0, at: at(0), number: 'M0001', isrc: 'USRC17607839', title: 'Jolene' }),
    ],
    candidate: {
      number: 'M0009',
      isrc: 'GBAYE0601498',
      title: 'Jolene (Live)',
      recordingTitle: 'Jolene (Live)',
      billed: 'The White Stripes',
    },
    slot: { at: tenths(at(minutes)) },
    ...extra,
  });
}

describe('titleMinimum', () => {
  it('reads the minimum off the slot category', () => {
    expect(titleMinimum(ruleContext())).toBe(MINIMUM);
  });

  it('is much longer than the artist minimum', () => {
    expect(titleMinimum(ruleContext())).toBeGreaterThan(fromMinutes(75));
  });

  it('is nothing for a category nothing defines', () => {
    expect(titleMinimum(ruleContext({ slot: { category: 'Z' as CategoryCode } }))).toBe(0);
  });
});

describe('candidateTitle', () => {
  it('uses the normalised recording title when there is one', () => {
    expect(candidateTitle(ruleContext({ candidate: { title: 'Jolene (Single Edit)' } }))).toBe(
      'JOLENE',
    );
  });

  it('falls back to the cart title when nothing is coded', () => {
    expect(candidateTitle(ruleContext({ candidate: { title: 'Jolene', noRecording: true } }))).toBe(
      'JOLENE',
    );
  });
});

describe('titleSeparation', () => {
  it('passes when nothing of that title is near', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), title: 'Ring of Fire' })],
      candidate: { title: 'Jolene' },
      slot: { at: tenths(at(10)) },
    });
    expect(titleSeparation.evaluate(context).passed).toBe(true);
  });

  it('passes exactly on the minimum', () => {
    expect(titleSeparation.evaluate(sameMaster(150)).passed).toBe(true);
  });

  it('rejects the same master inside the minimum', () => {
    const verdict = titleSeparation.evaluate(sameMaster(40));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(TITLE_TOO_CLOSE);
      expect(verdict.failure.detail?.['cover']).toBe('no');
      expect(verdict.failure.message).toContain('same recording');
    }
  });

  it('rejects a cover inside the minimum, and says it was a cover', () => {
    const verdict = titleSeparation.evaluate(cover(40));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.detail?.['cover']).toBe('yes');
      expect(verdict.failure.message).toContain('as a cover');
    }
  });

  it('treats a single edit as the same title as the album cut', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), title: 'Jolene', recordingTitle: 'Jolene' })],
      candidate: { title: 'Jolene (Single Edit)', recordingTitle: 'Jolene (Single Edit)' },
      slot: { at: tenths(at(30)) },
    });
    expect(titleSeparation.evaluate(context).passed).toBe(false);
  });

  it('does not collide two different songs by one artist', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), title: 'Jolene', billed: 'Dolly Parton' })],
      candidate: { title: 'Coat of Many Colors', billed: 'Dolly Parton' },
      slot: { at: tenths(at(30)) },
    });
    expect(titleSeparation.evaluate(context).passed).toBe(true);
  });

  it('measures backwards as readily as forwards', () => {
    const context = ruleContext({
      placed: [placed({ position: 20, at: at(200), title: 'Jolene' })],
      candidate: { title: 'Jolene' },
      slot: { position: 9, at: tenths(at(120)) },
    });
    expect(titleSeparation.evaluate(context).passed).toBe(false);
  });

  it('ignores the slot it is filling', () => {
    const context = ruleContext({
      placed: [placed({ position: 9, at: at(40), title: 'Jolene' })],
      candidate: { title: 'Jolene' },
      slot: { position: 9, at: tenths(at(40)) },
    });
    expect(titleSeparation.evaluate(context).passed).toBe(true);
  });

  it('names the nearer of two collisions', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', title: 'Jolene' }),
        placed({ position: 1, at: at(60), number: 'M0002', title: 'Jolene' }),
      ],
      candidate: { title: 'Jolene' },
      slot: { at: tenths(at(80)) },
    });
    expect(nearestTitleCollision(context, MINIMUM)?.cart).toBe('M0002');
  });

  it('passes on an empty log', () => {
    expect(titleSeparation.evaluate(ruleContext()).passed).toBe(true);
  });
});

describe('coversNear', () => {
  it('finds a cover whether or not it breaches', () => {
    expect(coversNear(cover(200), fromMinutes(300))).toHaveLength(1);
    expect(coversNear(cover(200), MINIMUM)).toEqual([]);
  });

  it('does not call the same master a cover', () => {
    expect(coversNear(sameMaster(40), MINIMUM)).toEqual([]);
  });

  it('finds nothing for a different song', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), title: 'Ring of Fire' })],
      candidate: { title: 'Jolene' },
    });
    expect(coversNear(context, MINIMUM)).toEqual([]);
  });
});
