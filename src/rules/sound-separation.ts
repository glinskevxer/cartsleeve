/**
 * Sound code separation.
 *
 * Four fiddle records in a row is not four rule breaches, it is one texture
 * complaint, and no separation rule keyed on artist, title or master can see it
 * coming. This one keeps carts sharing a sound family apart.
 *
 * The minimum is short, usually twenty minutes rather than seventy five, because
 * the point is to break up a run rather than to space a record out. That makes
 * it the rule most likely to be the one standing between the scheduler and a
 * hole, which is why it sits at a tier the relaxation pass drops early.
 *
 * It is also the only separation rule whose comparison is not an equality. Two
 * carts collide if any of their sound families match, and the families come from
 * the station's own index, so a station that has not built one gets exact code
 * matching and a much weaker rule.
 */

import { codeFor } from '../util/problem.js';
import type { Tenths } from '../util/duration.js';
import { sharedFamilies } from '../library/sounds.js';
import { headroom, makeDistanceRule, nearestCollision } from './distance.js';
import type { Collision, DistanceSpec, Match } from './distance.js';
import type { Placed, RuleContext } from './rule.js';

export const SOUND_TOO_CLOSE = codeFor('rule', 5);

export function soundMinimum(context: RuleContext): Tenths {
  return context.categories.get(context.slot.category)?.separation.sound ?? (0 as Tenths);
}

function soundsOf(item: Placed): readonly string[] {
  return item.entry.attributes?.sounds ?? [];
}

export const soundSpec: DistanceSpec = {
  name: 'sound separation',
  tier: 3,
  code: SOUND_TOO_CLOSE,
  minimum: soundMinimum,
  match(context: RuleContext, item: Placed): Match | undefined {
    const ours = context.candidate.attributes?.sounds ?? [];
    if (ours.length === 0) {
      return undefined;
    }
    const shared = sharedFamilies(context.sounds, ours, soundsOf(item));
    if (shared.length === 0) {
      return undefined;
    }
    return { what: shared.join(' and '), detail: { families: shared.join(' ') } };
  },
  message: (collision, minutes, needed) =>
    `${collision.what} played ${minutes} minutes ago and needs ${needed}`,
};

export const soundSeparation = makeDistanceRule(soundSpec);

export function nearestSoundCollision(context: RuleContext, window: Tenths): Collision | undefined {
  return nearestCollision(context, window, soundSpec);
}

export function soundHeadroom(context: RuleContext): number {
  return headroom(context, soundSpec);
}

/**
 * How many carts in a row share a family with the candidate, walking back from
 * the slot. This is what a listener actually hears, and it catches a run that
 * every pairwise check passes because each consecutive pair is just over the
 * minimum.
 *
 * The window bounds the gap between consecutive items, not the distance back to
 * the slot. Measuring from the slot would cap the run at whatever fits inside
 * one window and so could never see a long one, which is the only thing this
 * function exists to find.
 */
export function runLength(context: RuleContext, window: Tenths): number {
  const ours = context.candidate.attributes?.sounds ?? [];
  if (ours.length === 0) {
    return 0;
  }
  let run = 0;
  let previous = context.slot.at;
  for (const item of context.schedule.before(context.slot.position)) {
    if (Math.abs(item.at - previous) > window) {
      break;
    }
    if (sharedFamilies(context.sounds, ours, soundsOf(item)).length === 0) {
      break;
    }
    run += 1;
    previous = item.at;
  }
  return run;
}
