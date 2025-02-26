import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATTRIBUTES,
  MOODS,
  TEMPOS,
  TEXTURES,
  describeAttributes,
  energyOf,
  makeAttributes,
  moodStep,
  normaliseSound,
  tempoStep,
  textureStep,
} from '../../src/library/attributes.js';
import { expectErr, expectOk } from '../support/result.js';

describe('the scales', () => {
  it('run from least to most energetic', () => {
    expect(TEMPOS[0]).toBe('ballad');
    expect(TEMPOS[TEMPOS.length - 1]).toBe('driving');
    expect(TEMPOS).toHaveLength(6);
    expect(MOODS).toHaveLength(5);
    expect(TEXTURES).toHaveLength(5);
  });

  it('measure distance as steps along the scale', () => {
    expect(tempoStep('ballad', 'slow')).toBe(1);
    expect(tempoStep('ballad', 'driving')).toBe(5);
    expect(tempoStep('up', 'up')).toBe(0);
    expect(tempoStep('driving', 'ballad')).toBe(5);
  });

  it('measure mood and texture the same way', () => {
    expect(moodStep('dark', 'happy')).toBe(4);
    expect(moodStep('warm', 'neutral')).toBe(1);
    expect(textureStep('sparse', 'wall')).toBe(4);
    expect(textureStep('band', 'band')).toBe(0);
  });
});

describe('energyOf', () => {
  it('orders by tempo first', () => {
    const ballad = { ...DEFAULT_ATTRIBUTES, tempo: 'ballad' as const, texture: 'wall' as const };
    const driving = {
      ...DEFAULT_ATTRIBUTES,
      tempo: 'driving' as const,
      texture: 'sparse' as const,
    };
    expect(energyOf(driving)).toBeGreaterThan(energyOf(ballad));
  });

  it('breaks a tempo tie on texture', () => {
    const sparse = { ...DEFAULT_ATTRIBUTES, texture: 'sparse' as const };
    const wall = { ...DEFAULT_ATTRIBUTES, texture: 'wall' as const };
    expect(energyOf(wall)).toBeGreaterThan(energyOf(sparse));
    expect(energyOf(wall) - energyOf(sparse)).toBeLessThan(10);
  });
});

describe('normaliseSound', () => {
  it('upper cases and closes up space', () => {
    expect(normaliseSound(' steel gtr ')).toBe('STEELGTR');
    expect(normaliseSound('FIDDLE')).toBe('FIDDLE');
  });
});

describe('makeAttributes', () => {
  it('defaults everything that was not coded', () => {
    expect(expectOk(makeAttributes('M0001', {}))).toEqual(DEFAULT_ATTRIBUTES);
  });

  it('takes what it was given, case insensitively', () => {
    const built = expectOk(
      makeAttributes('M0001', { tempo: 'Up', mood: ' WARM ', texture: 'acoustic' }),
    );
    expect(built.tempo).toBe('up');
    expect(built.mood).toBe('warm');
    expect(built.texture).toBe('acoustic');
  });

  it('accepts every value on every scale', () => {
    for (const tempo of TEMPOS) {
      expect(expectOk(makeAttributes('M0001', { tempo })).tempo).toBe(tempo);
    }
    for (const mood of MOODS) {
      expect(expectOk(makeAttributes('M0001', { mood })).mood).toBe(mood);
    }
    for (const texture of TEXTURES) {
      expect(expectOk(makeAttributes('M0001', { texture })).texture).toBe(texture);
    }
  });

  it('rejects a value off the scale and names it', () => {
    const problems = expectErr(makeAttributes('M0001', { tempo: 'brisk' }));
    expect(problems[0]?.code).toBe('LIB-050');
    expect(problems[0]?.detail?.['given']).toBe('brisk');
    expect(expectErr(makeAttributes('M0001', { mood: 'cross' }))[0]?.code).toBe('LIB-051');
    expect(expectErr(makeAttributes('M0001', { texture: 'thick' }))[0]?.code).toBe('LIB-052');
  });

  it('reports every bad scale at once', () => {
    const problems = expectErr(
      makeAttributes('M0001', { tempo: 'brisk', mood: 'cross', texture: 'thick' }),
    );
    expect(problems.map((p) => p.code)).toEqual(['LIB-050', 'LIB-051', 'LIB-052']);
  });

  it('normalises and dedupes the sound codes', () => {
    const built = expectOk(
      makeAttributes('M0001', { sounds: ['steel gtr', 'STEELGTR', 'Fiddle'] }),
    );
    expect(built.sounds).toEqual(['STEELGTR', 'FIDDLE']);
  });

  it('rejects an empty sound code', () => {
    expect(expectErr(makeAttributes('M0001', { sounds: ['fiddle', '  '] }))[0]?.code).toBe(
      'LIB-053',
    );
  });

  it('accepts a cart with no sound codes at all', () => {
    expect(expectOk(makeAttributes('M0001', { sounds: [] })).sounds).toEqual([]);
  });
});

describe('describeAttributes', () => {
  it('prints the three scales', () => {
    expect(describeAttributes(DEFAULT_ATTRIBUTES)).toBe('medium/neutral/band');
  });

  it('appends the sound codes when there are any', () => {
    const built = expectOk(makeAttributes('M0001', { tempo: 'up', sounds: ['fiddle', 'steel'] }));
    expect(describeAttributes(built)).toBe('up/neutral/band [FIDDLE STEEL]');
  });
});
