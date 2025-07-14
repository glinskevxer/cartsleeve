import { beforeEach, describe, expect, it } from 'vitest';
import {
  ERA_MINIMUM_BANDS,
  ERA_TOO_NARROW,
  ERA_WINDOW,
  candidateEra,
  eraSpread,
  sameBandCount,
  spreadWith,
  windowEras,
} from '../../src/rules/era-spread.js';
import { CLASSIC_HITS_BANDS, makeEraMap } from '../../src/library/era.js';
import { tenths } from '../../src/util/duration.js';
import { placed } from '../support/placed.js';
import { ruleContext } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;

/** Country bands: traditional 55-74, outlaw 75-89, new country 90-04, modern 05-29. */
function hour(years: readonly number[], candidateYear: number) {
  return ruleContext({
    placed: years.map((year, index) =>
      placed({
        position: index,
        at: at(index * 4),
        number: `M000${index + 1}`,
        releaseYear: year,
      }),
    ),
    candidate: { number: 'M0099', releaseYear: candidateYear },
    slot: { position: years.length, at: tenths(at(years.length * 4)) },
  });
}

describe('candidateEra', () => {
  it('bands the candidate on the station era map', () => {
    expect(candidateEra(hour([], 1978))).toBe('outlaw');
    expect(candidateEra(hour([], 1965))).toBe('traditional');
  });

  it('is undefined when the candidate has no recording', () => {
    expect(candidateEra(ruleContext({ candidate: { noRecording: true } }))).toBeUndefined();
  });

  it('bands the same year differently on a different format', () => {
    const country = hour([], 1985);
    const classic = { ...country, eras: expectOk(makeEraMap(CLASSIC_HITS_BANDS)) };
    expect(candidateEra(country)).toBe('outlaw');
    expect(candidateEra(classic)).toBe('late');
  });
});

describe('windowEras', () => {
  it('reads the window behind the slot in play order', () => {
    expect(windowEras(hour([1965, 1978, 1995, 2010], 1980), 4)).toEqual([
      'traditional',
      'outlaw',
      'new country',
      'modern',
    ]);
  });

  it('takes only as many as it was asked for, nearest to the slot', () => {
    expect(windowEras(hour([1965, 1978, 1995, 2010], 1980), 2)).toEqual(['new country', 'modern']);
  });

  it('skips carts with no recording', () => {
    const context = ruleContext({
      placed: [
        placed({ position: 0, at: at(0), number: 'M0001', releaseYear: 1978 }),
        placed({ position: 1, at: at(4), number: 'M0002', noRecording: true }),
      ],
      candidate: { number: 'M0099', releaseYear: 1995 },
      slot: { position: 2, at: tenths(at(8)) },
    });
    expect(windowEras(context, 4)).toEqual(['outlaw']);
  });

  it('is empty at the top of the log', () => {
    expect(windowEras(hour([], 1978), 4)).toEqual([]);
  });
});

describe('eraSpread', () => {
  it('passes while the window is not yet full', () => {
    expect(eraSpread.evaluate(hour([1976, 1978, 1980], 1982)).passed).toBe(true);
  });

  it('passes a full window touching enough bands', () => {
    expect(eraSpread.evaluate(hour([1965, 1978, 1995, 2010], 1982)).passed).toBe(true);
  });

  it('rejects a full window all from one band', () => {
    const verdict = eraSpread.evaluate(hour([1976, 1978, 1980, 1985], 1988));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(ERA_TOO_NARROW);
      expect(verdict.failure.detail?.['bands']).toBe(1);
      expect(verdict.failure.detail?.['wanted']).toBe(ERA_MINIMUM_BANDS);
    }
  });

  it('accepts the same window once the candidate is from another band', () => {
    const narrow = [1976, 1978, 1980, 1985];
    expect(eraSpread.evaluate(hour(narrow, 1988)).passed).toBe(false);
    expect(eraSpread.evaluate(hour(narrow, 1965)).passed).toBe(true);
  });

  it('judges the same window differently on a different format', () => {
    const context = hour([1976, 1978, 1980, 1985], 1988);
    const classic = { ...context, eras: expectOk(makeEraMap(CLASSIC_HITS_BANDS)) };
    expect(eraSpread.evaluate(context).passed).toBe(false);
    expect(eraSpread.evaluate(classic).passed).toBe(true);
  });

  it('passes a candidate with no recording coded', () => {
    const context = ruleContext({
      placed: [1976, 1978, 1980, 1985].map((year, index) =>
        placed({
          position: index,
          at: at(index * 4),
          number: `M000${index + 1}`,
          releaseYear: year,
        }),
      ),
      candidate: { number: 'M0099', noRecording: true },
      slot: { position: 4, at: tenths(at(16)) },
    });
    expect(eraSpread.evaluate(context).passed).toBe(true);
  });

  it('passes on an empty log', () => {
    expect(eraSpread.evaluate(ruleContext()).passed).toBe(true);
  });
});

describe('spreadWith and sameBandCount', () => {
  it('counts the bands the window would touch with the candidate placed', () => {
    expect(spreadWith(hour([1976, 1978, 1980, 1985], 1988), ERA_WINDOW)).toBe(1);
    expect(spreadWith(hour([1976, 1978, 1980, 1985], 1965), ERA_WINDOW)).toBe(2);
  });

  it('counts how many of the window share the candidate band', () => {
    expect(sameBandCount(hour([1976, 1978, 1980, 1985], 1988), 4)).toBe(4);
    expect(sameBandCount(hour([1965, 1978, 1995, 2010], 1988), 4)).toBe(1);
    expect(sameBandCount(hour([1965, 1995, 2010], 1988), 4)).toBe(0);
  });

  it('counts nothing for a candidate with no recording', () => {
    expect(sameBandCount(ruleContext({ candidate: { noRecording: true } }), 4)).toBe(0);
  });

  it('says what is wrong more usefully than the band count does', () => {
    const context = hour([1976, 1978, 1980, 1985], 1988);
    expect(spreadWith(context, ERA_WINDOW)).toBe(1);
    expect(sameBandCount(context, ERA_WINDOW - 1)).toBe(4);
  });
});
