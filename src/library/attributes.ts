/**
 * Attribute coding.
 *
 * Beyond category, every music cart carries codes the flow rules read: how fast
 * it is, what it feels like, and what it sounds like. A music director codes
 * these by ear and they are the least objective data in the system, which is
 * why the rules that use them are advisory and the rules that use separation
 * are not.
 *
 * Tempo is an ordinal scale, not a number of beats. Two carts a step apart
 * segue; three steps apart is a jolt. That comparison is the whole reason the
 * scale is ordered rather than a set of labels.
 */

import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { Check } from '../util/check.js';
import type { Result } from '../util/result.js';

export const TEMPOS = ['ballad', 'slow', 'medium', 'bright', 'up', 'driving'] as const;
export type Tempo = (typeof TEMPOS)[number];

export const MOODS = ['dark', 'wistful', 'neutral', 'warm', 'happy'] as const;
export type Mood = (typeof MOODS)[number];

export const TEXTURES = ['sparse', 'acoustic', 'band', 'produced', 'wall'] as const;
export type Texture = (typeof TEXTURES)[number];

export interface Attributes {
  readonly tempo: Tempo;
  readonly mood: Mood;
  readonly texture: Texture;
  /** Free form sound codes, used by the sound separation rule. */
  readonly sounds: readonly string[];
}

export const DEFAULT_ATTRIBUTES: Attributes = {
  tempo: 'medium',
  mood: 'neutral',
  texture: 'band',
  sounds: [],
};

const ATT = (n: number): string => codeFor('library', n);

function indexIn<T extends string>(scale: readonly T[], value: string): number {
  return scale.indexOf(value.trim().toLowerCase() as T);
}

export function tempoStep(a: Tempo, b: Tempo): number {
  return Math.abs(TEMPOS.indexOf(a) - TEMPOS.indexOf(b));
}

export function moodStep(a: Mood, b: Mood): number {
  return Math.abs(MOODS.indexOf(a) - MOODS.indexOf(b));
}

export function textureStep(a: Texture, b: Texture): number {
  return Math.abs(TEXTURES.indexOf(a) - TEXTURES.indexOf(b));
}

/** Ordering carts by energy, which is tempo first and texture as the tie break. */
export function energyOf(attributes: Attributes): number {
  return TEMPOS.indexOf(attributes.tempo) * 10 + TEXTURES.indexOf(attributes.texture);
}

export interface AttributeInput {
  readonly tempo?: string;
  readonly mood?: string;
  readonly texture?: string;
  readonly sounds?: readonly string[];
}

export function normaliseSound(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function makeAttributes(
  subject: string,
  input: AttributeInput,
): Result<Attributes, Problem[]> {
  const check = new Check();
  const tempoAt = input.tempo === undefined ? -1 : indexIn(TEMPOS, input.tempo);
  check.ensure(
    input.tempo === undefined || tempoAt >= 0,
    ATT(50),
    subject,
    'has a tempo nothing recognises',
    { given: input.tempo ?? '' },
  );
  const moodAt = input.mood === undefined ? -1 : indexIn(MOODS, input.mood);
  check.ensure(
    input.mood === undefined || moodAt >= 0,
    ATT(51),
    subject,
    'has a mood nothing recognises',
    { given: input.mood ?? '' },
  );
  const textureAt = input.texture === undefined ? -1 : indexIn(TEXTURES, input.texture);
  check.ensure(
    input.texture === undefined || textureAt >= 0,
    ATT(52),
    subject,
    'has a texture nothing recognises',
    { given: input.texture ?? '' },
  );
  const sounds: string[] = [];
  for (const raw of input.sounds ?? []) {
    const sound = normaliseSound(raw);
    if (!check.ensure(sound.length > 0, ATT(53), subject, 'has an empty sound code')) {
      continue;
    }
    if (!sounds.includes(sound)) {
      sounds.push(sound);
    }
  }
  return check.result(() => ({
    tempo: TEMPOS[tempoAt] ?? DEFAULT_ATTRIBUTES.tempo,
    mood: MOODS[moodAt] ?? DEFAULT_ATTRIBUTES.mood,
    texture: TEXTURES[textureAt] ?? DEFAULT_ATTRIBUTES.texture,
    sounds,
  }));
}

export function describeAttributes(attributes: Attributes): string {
  const sounds = attributes.sounds.length === 0 ? '' : ` [${attributes.sounds.join(' ')}]`;
  return `${attributes.tempo}/${attributes.mood}/${attributes.texture}${sounds}`;
}
