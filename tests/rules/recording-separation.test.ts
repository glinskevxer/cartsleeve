import { beforeEach, describe, expect, it } from 'vitest';
import {
  RECORDING_TOO_CLOSE,
  nearestRecordingCollision,
  recordingMinimum,
  recordingSeparation,
  spinsOfSameMaster,
} from '../../src/rules/recording-separation.js';
import { titleSeparation } from '../../src/rules/title-separation.js';
import { artistSeparation } from '../../src/rules/artist-separation.js';
import { fromMinutes, tenths } from '../../src/util/duration.js';
import type { CategoryCode } from '../../src/util/ids.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;
const JOLENE = 'USRC17607839';
const MINIMUM = fromMinutes(150);

/** The same master on two different cart numbers, `minutes` apart. */
function doubleCarded(minutes: number) {
  return ruleContext({
    placed: [
      placed({
        position: 0,
        at: at(0),
        number: 'M0001',
        isrc: JOLENE,
        title: 'Jolene',
        category: 'G',
      }),
    ],
    candidate: { number: 'M0500', isrc: JOLENE, title: 'Jolene', category: 'A' },
    slot: { at: tenths(at(minutes)) },
  });
}

describe('recordingMinimum', () => {
  it('reads the minimum off the slot category', () => {
    expect(recordingMinimum(ruleContext())).toBe(MINIMUM);
  });

  it('is nothing for a category nothing defines', () => {
    expect(recordingMinimum(ruleContext({ slot: { category: 'Z' as CategoryCode } }))).toBe(0);
  });
});

describe('recordingSeparation', () => {
  it('passes when no master matches', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), isrc: 'USRC17600001' })],
      candidate: { isrc: JOLENE },
      slot: { at: tenths(at(10)) },
    });
    expect(recordingSeparation.evaluate(context).passed).toBe(true);
  });

  it('passes exactly on the minimum', () => {
    expect(recordingSeparation.evaluate(doubleCarded(150)).passed).toBe(true);
  });

  it('rejects the same master inside the minimum', () => {
    const verdict = recordingSeparation.evaluate(doubleCarded(40));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(RECORDING_TOO_CLOSE);
      expect(verdict.failure.detail?.['isrc']).toBe(JOLENE);
      expect(verdict.failure.detail?.['doubleCarded']).toBe('yes');
      expect(verdict.failure.message).toContain('another cart');
    }
  });

  it('passes a candidate with no recording coded', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), isrc: JOLENE })],
      candidate: { noRecording: true },
      slot: { at: tenths(at(10)) },
    });
    expect(recordingSeparation.evaluate(context).passed).toBe(true);
  });

  it('ignores the slot it is filling', () => {
    const context = ruleContext({
      placed: [placed({ position: 9, at: at(40), isrc: JOLENE })],
      candidate: { isrc: JOLENE },
      slot: { position: 9, at: tenths(at(40)) },
    });
    expect(recordingSeparation.evaluate(context).passed).toBe(true);
  });

  it('names the nearer of two collisions', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', isrc: JOLENE }),
        placed({ position: 1, at: at(60), number: 'M0002', isrc: JOLENE }),
      ],
      candidate: { number: 'M0500', isrc: JOLENE },
      slot: { at: tenths(at(80)) },
    });
    expect(nearestRecordingCollision(context, MINIMUM)?.cart).toBe('M0002');
  });

  it('sits at a tighter tier than the artist rule', () => {
    expect(recordingSeparation.tier).toBeLessThan(artistSeparation.tier);
  });

  it('passes on an empty log', () => {
    expect(recordingSeparation.evaluate(ruleContext()).passed).toBe(true);
  });
});

describe('what only this rule can see', () => {
  it('catches a double carded master no cart number comparison could', () => {
    const context = doubleCarded(40);
    expect(context.candidate.cart.number).not.toBe('M0001');
    expect(recordingSeparation.evaluate(context).passed).toBe(false);
  });

  it('lets a cover through where the title rule stops it', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), isrc: JOLENE, title: 'Jolene', billed: 'Dolly Parton' }),
      ],
      candidate: {
        isrc: 'GBAYE0601498',
        title: 'Jolene',
        recordingTitle: 'Jolene',
        billed: 'The White Stripes',
      },
      slot: { at: tenths(at(40)) },
    });
    expect(recordingSeparation.evaluate(context).passed).toBe(true);
    expect(titleSeparation.evaluate(context).passed).toBe(false);
  });
});

describe('spinsOfSameMaster', () => {
  it('finds every placement of the master in the window', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', isrc: JOLENE }),
        placed({ position: 1, at: at(60), number: 'M0002', isrc: JOLENE }),
        placed({ position: 2, at: at(90), number: 'M0003', isrc: 'USRC17600001' }),
      ],
      candidate: { number: 'M0500', isrc: JOLENE },
      slot: { at: tenths(at(100)) },
    });
    expect(spinsOfSameMaster(context, MINIMUM).map((item) => item.cart)).toEqual([
      'M0001',
      'M0002',
    ]);
  });

  it('finds nothing for a candidate with no recording', () => {
    const context = ruleContext({ candidate: { noRecording: true } });
    expect(spinsOfSameMaster(context, MINIMUM)).toEqual([]);
  });

  it('finds nothing on an empty log', () => {
    expect(spinsOfSameMaster(ruleContext(), MINIMUM)).toEqual([]);
  });
});
