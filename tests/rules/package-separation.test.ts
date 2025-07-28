import { beforeEach, describe, expect, it } from 'vitest';
import {
  PACKAGE_MINIMUM,
  PACKAGE_SPAN,
  PACKAGE_TOO_CLOSE,
  nearestPackageCollision,
  packageKeyOf,
  packageSeparation,
  samePackage,
} from '../../src/rules/package-separation.js';
import { titleSeparation } from '../../src/rules/title-separation.js';
import { recordingSeparation } from '../../src/rules/recording-separation.js';
import { artistSeparation } from '../../src/rules/artist-separation.js';
import { tenths } from '../../src/util/duration.js';
import type { Isrc } from '../../src/util/ids.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;
const isrc = (value: string): Isrc => value as Isrc;

/** Two tracks off one release: same registrant, same year, near designations. */
const TRACK_ONE = 'USRC17600101';
const TRACK_TWO = 'USRC17600104';
/** A different release by the same label a decade later. */
const OTHER_RELEASE = 'USRC18600101';
/** A different label entirely. */
const OTHER_LABEL = 'USXYZ7600102';

function twoTracks(minutes: number) {
  return ruleContext({
    placed: [
      placed({
        position: 0,
        at: at(0),
        number: 'M0001',
        isrc: TRACK_ONE,
        title: 'Track One',
        billed: 'Waylon Jennings',
      }),
    ],
    candidate: {
      number: 'M0009',
      isrc: TRACK_TWO,
      title: 'Track Two',
      billed: 'Waylon Jennings',
    },
    slot: { at: tenths(at(minutes)) },
  });
}

describe('packageKeyOf', () => {
  it('reads the registrant, year and designation off the isrc', () => {
    expect(packageKeyOf(isrc(TRACK_ONE))).toEqual({
      registrant: 'RC1',
      year: 1976,
      designation: 101,
    });
  });
});

describe('samePackage', () => {
  const one = packageKeyOf(isrc(TRACK_ONE));

  it('matches two designations inside the span', () => {
    expect(samePackage(one, packageKeyOf(isrc(TRACK_TWO)))).toBe(true);
  });

  it('matches a designation exactly on the span', () => {
    const edge = packageKeyOf(isrc(`USRC176${String(101 + PACKAGE_SPAN).padStart(5, '0')}`));
    expect(samePackage(one, edge)).toBe(true);
  });

  it('does not match one past the span', () => {
    const beyond = packageKeyOf(isrc('USRC17600199'));
    expect(samePackage(one, beyond)).toBe(false);
  });

  it('does not match a different year of reference', () => {
    expect(samePackage(one, packageKeyOf(isrc(OTHER_RELEASE)))).toBe(false);
  });

  it('does not match a different registrant', () => {
    expect(samePackage(one, packageKeyOf(isrc(OTHER_LABEL)))).toBe(false);
  });

  it('matches a key against itself', () => {
    expect(samePackage(one, one)).toBe(true);
  });
});

describe('packageSeparation', () => {
  it('passes two tracks further apart than the minimum', () => {
    expect(packageSeparation.evaluate(twoTracks(70)).passed).toBe(true);
  });

  it('passes exactly on the minimum', () => {
    expect(packageSeparation.evaluate(twoTracks(60)).passed).toBe(true);
  });

  it('rejects two tracks off one release inside the minimum', () => {
    const verdict = packageSeparation.evaluate(twoTracks(20));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(PACKAGE_TOO_CLOSE);
      expect(verdict.failure.detail?.['against']).toBe('M0001');
      expect(verdict.failure.detail?.['gap']).toBe(3);
      expect(verdict.failure.detail?.['minutes']).toBe(20);
    }
  });

  it('passes two records off different releases', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), number: 'M0001', isrc: TRACK_ONE })],
      candidate: { number: 'M0009', isrc: OTHER_LABEL },
      slot: { at: tenths(at(20)) },
    });
    expect(packageSeparation.evaluate(context).passed).toBe(true);
  });

  it('leaves the same recording to the recording rule', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', isrc: TRACK_ONE, title: 'Track One' }),
      ],
      candidate: { number: 'M0500', isrc: TRACK_ONE, title: 'Track One' },
      slot: { at: tenths(at(20)) },
    });
    expect(packageSeparation.evaluate(context).passed).toBe(true);
    expect(recordingSeparation.evaluate(context).passed).toBe(false);
  });

  it('passes a candidate with no recording coded', () => {
    const context = ruleContext({
      placed: [placed({ position: 0, at: at(0), isrc: TRACK_ONE })],
      candidate: { noRecording: true },
      slot: { at: tenths(at(10)) },
    });
    expect(packageSeparation.evaluate(context).passed).toBe(true);
  });

  it('ignores the slot it is filling', () => {
    const context = ruleContext({
      placed: [placed({ position: 9, at: at(10), number: 'M0001', isrc: TRACK_ONE })],
      candidate: { number: 'M0009', isrc: TRACK_TWO },
      slot: { position: 9, at: tenths(at(10)) },
    });
    expect(packageSeparation.evaluate(context).passed).toBe(true);
  });

  it('names the nearer of two collisions', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', isrc: TRACK_ONE }),
        placed({ position: 1, at: at(30), number: 'M0002', isrc: 'USRC17600106' }),
      ],
      candidate: { number: 'M0009', isrc: TRACK_TWO },
      slot: { at: tenths(at(40)) },
    });
    expect(nearestPackageCollision(context, tenths(PACKAGE_MINIMUM))?.cart).toBe('M0002');
  });

  it('passes on an empty log', () => {
    expect(packageSeparation.evaluate(ruleContext()).passed).toBe(true);
  });
});

describe('what no other rule can see', () => {
  it('catches an album pairing every other rule passes', () => {
    const context = ruleContext({
      placed: [
        placed({
          position: 0,
          at: at(0),
          number: 'M0001',
          isrc: TRACK_ONE,
          title: 'Are You Sure Hank Done It This Way',
          billed: 'Waylon Jennings',
        }),
      ],
      candidate: {
        number: 'M0009',
        isrc: TRACK_TWO,
        title: 'Bob Wills Is Still The King',
        billed: 'Waylon and Willie',
      },
      slot: { at: tenths(at(20)) },
    });
    expect(artistSeparation.evaluate(context).passed).toBe(true);
    expect(titleSeparation.evaluate(context).passed).toBe(true);
    expect(recordingSeparation.evaluate(context).passed).toBe(true);
    expect(packageSeparation.evaluate(context).passed).toBe(false);
  });

  it('sits at a tier the relaxation pass can drop', () => {
    expect(packageSeparation.tier).toBeGreaterThan(artistSeparation.tier);
  });
});
