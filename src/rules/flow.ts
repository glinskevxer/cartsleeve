/**
 * Tempo and mood flow.
 *
 * Every other rule in the system measures a distance. This one measures a step:
 * how far the candidate is from the cart immediately before it on the tempo
 * scale, and whether the hour is drifting in one direction.
 *
 * A ballad straight into a driving up tempo record is a jolt, and four bright
 * records in a row followed by a ballad is a hole. Neither is a separation
 * problem and neither can be expressed as one, because the offending pair is
 * adjacent rather than distant, and the offending run is a shape rather than a
 * pair at all.
 *
 * Flow is advisory. The codes are real but the tiers are high, because a
 * scheduler that leaves a hole rather than accept a tempo jump has made the
 * hour worse, not better.
 */

import { codeFor } from '../util/problem.js';
import { moodStep, tempoStep } from '../library/attributes.js';
import type { Attributes, Tempo } from '../library/attributes.js';
import { PASSED, rejected } from './rule.js';
import type { Placed, Rule, RuleContext, RuleVerdict } from './rule.js';

export const TEMPO_JUMP = codeFor('rule', 6);
export const MOOD_JUMP = codeFor('rule', 7);
export const TEMPO_RUN = codeFor('rule', 8);

/** The largest step allowed between two adjacent carts. */
export const MAX_TEMPO_STEP = 2;
export const MAX_MOOD_STEP = 3;
/** How many carts may share a tempo before the hour reads flat. */
export const MAX_SAME_TEMPO_RUN = 3;

function attributesOf(item: Placed): Attributes | undefined {
  return item.entry.attributes;
}

export interface Step {
  readonly from: string;
  readonly to: string;
  readonly step: number;
}

/** The tempo step from the cart before the slot to the candidate. */
export function tempoStepInto(context: RuleContext): Step | undefined {
  const previous = context.schedule.previous(context.slot.position);
  const before = previous === undefined ? undefined : attributesOf(previous);
  const ours = context.candidate.attributes;
  if (before === undefined || ours === undefined) {
    return undefined;
  }
  return { from: before.tempo, to: ours.tempo, step: tempoStep(before.tempo, ours.tempo) };
}

export function moodStepInto(context: RuleContext): Step | undefined {
  const previous = context.schedule.previous(context.slot.position);
  const before = previous === undefined ? undefined : attributesOf(previous);
  const ours = context.candidate.attributes;
  if (before === undefined || ours === undefined) {
    return undefined;
  }
  return { from: before.mood, to: ours.mood, step: moodStep(before.mood, ours.mood) };
}

export const tempoFlow: Rule = {
  name: 'tempo flow',
  tier: 5,
  evaluate(context: RuleContext): RuleVerdict {
    const step = tempoStepInto(context);
    if (step === undefined || step.step <= MAX_TEMPO_STEP) {
      return PASSED;
    }
    return rejected(
      TEMPO_JUMP,
      `${step.from} into ${step.to} is a jump of ${step.step}`,
      step.step - MAX_TEMPO_STEP,
      { from: step.from, to: step.to, step: step.step, allowed: MAX_TEMPO_STEP },
    );
  },
};

export const moodFlow: Rule = {
  name: 'mood flow',
  tier: 6,
  evaluate(context: RuleContext): RuleVerdict {
    const step = moodStepInto(context);
    if (step === undefined || step.step <= MAX_MOOD_STEP) {
      return PASSED;
    }
    return rejected(
      MOOD_JUMP,
      `${step.from} into ${step.to} is a mood jump of ${step.step}`,
      step.step - MAX_MOOD_STEP,
      { from: step.from, to: step.to, step: step.step, allowed: MAX_MOOD_STEP },
    );
  },
};

/** How many carts immediately behind the slot share the candidate's tempo. */
export function sameTempoRun(context: RuleContext): number {
  const ours = context.candidate.attributes?.tempo;
  if (ours === undefined) {
    return 0;
  }
  let run = 0;
  for (const item of context.schedule.before(context.slot.position)) {
    if (attributesOf(item)?.tempo !== ours) {
      break;
    }
    run += 1;
  }
  return run;
}

export const tempoVariety: Rule = {
  name: 'tempo variety',
  tier: 6,
  evaluate(context: RuleContext): RuleVerdict {
    const run = sameTempoRun(context);
    if (run < MAX_SAME_TEMPO_RUN) {
      return PASSED;
    }
    const tempo = context.candidate.attributes?.tempo ?? '';
    return rejected(
      TEMPO_RUN,
      `would be ${run + 1} ${tempo} records in a row`,
      run + 1 - MAX_SAME_TEMPO_RUN,
      { tempo, run: run + 1, allowed: MAX_SAME_TEMPO_RUN },
    );
  },
};

/** The tempo shape of the hour so far, for the flow report. */
export function tempoShape(context: RuleContext): Tempo[] {
  const out: Tempo[] = [];
  for (const item of context.schedule.before(context.slot.position)) {
    const tempo = attributesOf(item)?.tempo;
    if (tempo !== undefined) {
      out.unshift(tempo);
    }
  }
  return out;
}
