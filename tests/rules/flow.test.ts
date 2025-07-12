import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_MOOD_STEP,
  MAX_SAME_TEMPO_RUN,
  MAX_TEMPO_STEP,
  MOOD_JUMP,
  TEMPO_JUMP,
  TEMPO_RUN,
  moodFlow,
  moodStepInto,
  sameTempoRun,
  tempoFlow,
  tempoShape,
  tempoStepInto,
  tempoVariety,
} from '../../src/rules/flow.js';
import { artistSeparation } from '../../src/rules/artist-separation.js';
import { tenths } from '../../src/util/duration.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;

/** One cart before the slot with the given tempo, and a candidate with another. */
function pair(before: string, candidate: string) {
  return ruleContext({
    placed: [placed({ position: 8, at: at(0), number: 'M0001', tempo: before })],
    candidate: { number: 'M0009', tempo: candidate },
    slot: { position: 9, at: tenths(at(4)) },
  });
}

/** `count` carts of one tempo behind the slot, and a candidate of the same. */
function sameRun(count: number, tempo = 'bright') {
  return ruleContext({
    placed: Array.from({ length: count }, (_, index) =>
      placed({ position: index, at: at(index * 4), number: `M000${index + 1}`, tempo }),
    ),
    candidate: { number: 'M0099', tempo },
    slot: { position: count, at: tenths(at(count * 4)) },
  });
}

describe('tempoStepInto', () => {
  it('measures the step from the cart before the slot', () => {
    expect(tempoStepInto(pair('ballad', 'medium'))?.step).toBe(2);
    expect(tempoStepInto(pair('medium', 'medium'))?.step).toBe(0);
  });

  it('names both ends of the step', () => {
    const step = tempoStepInto(pair('ballad', 'up'));
    expect(step?.from).toBe('ballad');
    expect(step?.to).toBe('up');
  });

  it('is undefined at the top of the log', () => {
    expect(tempoStepInto(ruleContext({ candidate: { tempo: 'up' } }))).toBeUndefined();
  });

  it('is undefined when either cart has no attributes coded', () => {
    const noCandidate = ruleContext({
      placed: [placed({ position: 8, at: at(0), tempo: 'ballad' })],
      candidate: { number: 'M0009' },
      slot: { position: 9, at: tenths(at(4)) },
    });
    expect(tempoStepInto(noCandidate)).toBeUndefined();
    const noPrevious = ruleContext({
      placed: [placed({ position: 8, at: at(0), number: 'M0001' })],
      candidate: { tempo: 'up' },
      slot: { position: 9, at: tenths(at(4)) },
    });
    expect(tempoStepInto(noPrevious)).toBeUndefined();
  });
});

describe('tempoFlow', () => {
  it('passes a step inside the limit', () => {
    expect(tempoFlow.evaluate(pair('medium', 'bright')).passed).toBe(true);
    expect(tempoFlow.evaluate(pair('ballad', 'medium')).passed).toBe(true);
  });

  it('rejects a jump past the limit', () => {
    const verdict = tempoFlow.evaluate(pair('ballad', 'driving'));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(TEMPO_JUMP);
      expect(verdict.failure.detail?.['step']).toBe(5);
      expect(verdict.failure.detail?.['allowed']).toBe(MAX_TEMPO_STEP);
    }
  });

  it('rejects the jump in either direction', () => {
    expect(tempoFlow.evaluate(pair('driving', 'ballad')).passed).toBe(false);
    expect(tempoFlow.evaluate(pair('ballad', 'driving')).passed).toBe(false);
  });

  it('passes exactly on the limit', () => {
    expect(tempoStepInto(pair('ballad', 'medium'))?.step).toBe(MAX_TEMPO_STEP);
    expect(tempoFlow.evaluate(pair('ballad', 'medium')).passed).toBe(true);
  });

  it('passes at the top of the log and with nothing coded', () => {
    expect(tempoFlow.evaluate(ruleContext()).passed).toBe(true);
  });

  it('sits at a tier well above the separation rules', () => {
    expect(tempoFlow.tier).toBeGreaterThan(artistSeparation.tier);
  });
});

describe('moodFlow', () => {
  it('measures the mood step and passes inside the limit', () => {
    const context = ruleContext({
      placed: [placed({ position: 8, at: at(0), mood: 'neutral' })],
      candidate: { mood: 'happy' },
      slot: { position: 9, at: tenths(at(4)) },
    });
    expect(moodStepInto(context)?.step).toBe(2);
    expect(moodFlow.evaluate(context).passed).toBe(true);
  });

  it('rejects a jump past the mood limit', () => {
    const context = ruleContext({
      placed: [placed({ position: 8, at: at(0), mood: 'dark' })],
      candidate: { mood: 'happy' },
      slot: { position: 9, at: tenths(at(4)) },
    });
    const verdict = moodFlow.evaluate(context);
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(MOOD_JUMP);
      expect(verdict.failure.detail?.['allowed']).toBe(MAX_MOOD_STEP);
    }
  });

  it('passes with nothing coded', () => {
    expect(moodFlow.evaluate(ruleContext()).passed).toBe(true);
    expect(moodStepInto(ruleContext())).toBeUndefined();
  });
});

describe('sameTempoRun', () => {
  it('counts the unbroken run behind the slot', () => {
    expect(sameTempoRun(sameRun(3))).toBe(3);
    expect(sameTempoRun(sameRun(1))).toBe(1);
    expect(sameTempoRun(sameRun(0))).toBe(0);
  });

  it('stops at the first different tempo', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', tempo: 'bright' }),
        placed({ position: 1, at: at(4), number: 'M0002', tempo: 'ballad' }),
        placed({ position: 2, at: at(8), number: 'M0003', tempo: 'bright' }),
      ],
      candidate: { number: 'M0099', tempo: 'bright' },
      slot: { position: 3, at: tenths(at(12)) },
    });
    expect(sameTempoRun(context)).toBe(1);
  });

  it('is nothing when the candidate has no tempo coded', () => {
    expect(sameTempoRun(ruleContext({ candidate: { number: 'M0099' } }))).toBe(0);
  });

  it('passes the variety rule below the limit and rejects at it', () => {
    expect(tempoVariety.evaluate(sameRun(MAX_SAME_TEMPO_RUN - 1)).passed).toBe(true);
    const verdict = tempoVariety.evaluate(sameRun(MAX_SAME_TEMPO_RUN));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(TEMPO_RUN);
      expect(verdict.failure.detail?.['run']).toBe(MAX_SAME_TEMPO_RUN + 1);
    }
  });

  it('catches a flat hour that every step check passes', () => {
    const flat = sameRun(MAX_SAME_TEMPO_RUN);
    expect(tempoFlow.evaluate(flat).passed).toBe(true);
    expect(tempoVariety.evaluate(flat).passed).toBe(false);
  });
});

describe('tempoShape', () => {
  it('reads the hour back in play order', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', tempo: 'ballad' }),
        placed({ position: 1, at: at(4), number: 'M0002', tempo: 'medium' }),
        placed({ position: 2, at: at(8), number: 'M0003', tempo: 'up' }),
      ],
      candidate: { number: 'M0099', tempo: 'bright' },
      slot: { position: 3, at: tenths(at(12)) },
    });
    expect(tempoShape(context)).toEqual(['ballad', 'medium', 'up']);
  });

  it('skips carts with nothing coded', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', tempo: 'ballad' }),
        placed({ position: 1, at: at(4), number: 'M0002' }),
      ],
      candidate: { number: 'M0099', tempo: 'bright' },
      slot: { position: 2, at: tenths(at(8)) },
    });
    expect(tempoShape(context)).toEqual(['ballad']);
  });

  it('is empty at the top of the log', () => {
    expect(tempoShape(ruleContext())).toEqual([]);
  });
});
