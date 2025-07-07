import { beforeEach, describe, expect, it } from 'vitest';
import {
  SOUND_TOO_CLOSE,
  nearestSoundCollision,
  runLength,
  soundMinimum,
  soundSeparation,
} from '../../src/rules/sound-separation.js';
import { EMPTY_SOUND_INDEX } from '../../src/library/sounds.js';
import { fromMinutes, tenths } from '../../src/util/duration.js';
import type { CategoryCode } from '../../src/util/ids.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;
const MINIMUM = fromMinutes(20);

/** A fiddle record placed at the top, and a fiddle candidate `minutes` later. */
function twoFiddles(minutes: number) {
  return ruleContext({
    placed: [placed({ position: 0, at: at(0), number: 'M0001', sounds: ['fiddle'] })],
    candidate: { number: 'M0009', sounds: ['fiddle'] },
    slot: { at: tenths(at(minutes)) },
  });
}

describe('soundMinimum', () => {
  it('reads the minimum off the slot category', () => {
    expect(soundMinimum(ruleContext())).toBe(MINIMUM);
  });

  it('is much shorter than the artist minimum', () => {
    expect(soundMinimum(ruleContext())).toBeLessThan(fromMinutes(75));
  });

  it('is nothing for a category nothing defines', () => {
    expect(soundMinimum(ruleContext({ slot: { category: 'Z' as CategoryCode } }))).toBe(0);
  });
});

describe('soundSeparation', () => {
  it('passes when the sounds do not overlap', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), sounds: ['banjo'] })],
      candidate: { sounds: ['fiddle'] },
      slot: { at: tenths(at(5)) },
    });
    expect(soundSeparation.evaluate(context).passed).toBe(true);
  });

  it('passes exactly on the minimum', () => {
    expect(soundSeparation.evaluate(twoFiddles(20)).passed).toBe(true);
  });

  it('rejects inside the minimum and names the family', () => {
    const verdict = soundSeparation.evaluate(twoFiddles(8));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(SOUND_TOO_CLOSE);
      expect(verdict.failure.detail?.['families']).toBe('FIDDLE');
      expect(verdict.failure.detail?.['minutes']).toBe(8);
    }
  });

  it('collides two different spellings of one sound', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), sounds: ['pedal steel'] })],
      candidate: { sounds: ['steel gtr'] },
      slot: { at: tenths(at(8)) },
    });
    expect(soundSeparation.evaluate(context).passed).toBe(false);
  });

  it('would miss that collision with no family index at all', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), sounds: ['pedal steel'] })],
      candidate: { sounds: ['steel gtr'] },
      slot: { at: tenths(at(8)) },
    });
    expect(soundSeparation.evaluate({ ...context, sounds: EMPTY_SOUND_INDEX }).passed).toBe(true);
    expect(soundSeparation.evaluate(context).passed).toBe(false);
  });

  it('still collides an exact code with no family index', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), sounds: ['accordion'] })],
      candidate: { sounds: ['accordion'] },
      slot: { at: tenths(at(8)) },
    });
    expect(soundSeparation.evaluate({ ...context, sounds: EMPTY_SOUND_INDEX }).passed).toBe(false);
  });

  it('reports every family the two share', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), sounds: ['fiddle', 'dobro'] })],
      candidate: { sounds: ['violin', 'lap steel'] },
      slot: { at: tenths(at(8)) },
    });
    expect(nearestSoundCollision(context, MINIMUM)?.families).toEqual(['FIDDLE', 'STEEL']);
  });

  it('passes a candidate with no sounds coded', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), sounds: ['fiddle'] })],
      candidate: { number: 'M0009' },
      slot: { at: tenths(at(1)) },
    });
    expect(soundSeparation.evaluate(context).passed).toBe(true);
  });

  it('passes against a placement with no sounds coded', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), number: 'M0001' })],
      candidate: { sounds: ['fiddle'] },
      slot: { at: tenths(at(1)) },
    });
    expect(soundSeparation.evaluate(context).passed).toBe(true);
  });

  it('names the nearer of two collisions', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', sounds: ['fiddle'] }),
        placed({ position: 1, at: at(12), number: 'M0002', sounds: ['fiddle'] }),
      ],
      candidate: { sounds: ['fiddle'] },
      slot: { at: tenths(at(16)) },
    });
    expect(nearestSoundCollision(context, MINIMUM)?.cart).toBe('M0002');
  });

  it('sits at a tier the relaxation pass drops before the artist rule', () => {
    expect(soundSeparation.tier).toBeGreaterThan(2);
  });

  it('passes on an empty log', () => {
    expect(soundSeparation.evaluate(ruleContext()).passed).toBe(true);
  });
});

describe('runLength', () => {
  it('counts the unbroken run of the same family behind the slot', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', sounds: ['fiddle'] }),
        placed({ position: 1, at: at(4), number: 'M0002', sounds: ['violin'] }),
        placed({ position: 2, at: at(8), number: 'M0003', sounds: ['strings'] }),
      ],
      candidate: { sounds: ['fiddle'] },
      slot: { position: 3, at: tenths(at(12)) },
    });
    expect(runLength(context, fromMinutes(60))).toBe(3);
  });

  it('stops at the first cart that does not share a family', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', sounds: ['fiddle'] }),
        placed({ position: 1, at: at(4), number: 'M0002', sounds: ['banjo'] }),
        placed({ position: 2, at: at(8), number: 'M0003', sounds: ['fiddle'] }),
      ],
      candidate: { sounds: ['fiddle'] },
      slot: { position: 3, at: tenths(at(12)) },
    });
    expect(runLength(context, fromMinutes(60))).toBe(1);
  });

  it('stops at the edge of the window', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', sounds: ['fiddle'] }),
        placed({ position: 1, at: at(50), number: 'M0002', sounds: ['fiddle'] }),
      ],
      candidate: { sounds: ['fiddle'] },
      slot: { position: 3, at: tenths(at(55)) },
    });
    expect(runLength(context, fromMinutes(20))).toBe(1);
  });

  it('catches a run every pairwise check would pass', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', sounds: ['fiddle'] }),
        placed({ position: 1, at: at(21), number: 'M0002', sounds: ['fiddle'] }),
        placed({ position: 2, at: at(42), number: 'M0003', sounds: ['fiddle'] }),
      ],
      candidate: { sounds: ['fiddle'] },
      slot: { position: 3, at: tenths(at(63)) },
    });
    expect(soundSeparation.evaluate(context).passed).toBe(true);
    expect(runLength(context, fromMinutes(30))).toBe(3);
  });

  it('is nothing for a candidate with no sounds', () => {
    expect(runLength(ruleContext({ candidate: { number: 'M0009' } }), fromMinutes(60))).toBe(0);
  });
});
