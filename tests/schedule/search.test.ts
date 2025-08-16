import { beforeEach, describe, expect, it } from 'vitest';
import { fillSlot, isClean } from '../../src/schedule/search.js';
import type { SearchInput } from '../../src/schedule/search.js';
import { standardRuleSet } from '../../src/rules/tiers.js';
import { makeScheduleView } from '../../src/rules/schedule-view.js';
import type { Placed, Slot } from '../../src/rules/rule.js';
import { NO_RESTRICTIONS } from '../../src/library/restriction.js';
import { NO_WINDOWS } from '../../src/library/window.js';
import { cellOf } from '../../src/domain/daypart.js';
import { tenths } from '../../src/util/duration.js';
import type { CategoryCode } from '../../src/util/ids.js';
import type { LibraryEntry } from '../../src/library/library.js';
import { STANDARD_FAMILIES, makeSoundIndex } from '../../src/library/sounds.js';
import { COUNTRY_BANDS, makeEraMap } from '../../src/library/era.js';
import { placed } from '../support/placed.js';
import { CATEGORIES } from '../support/context.js';
import { entry, resetFixtures, station } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const at = (minutes: number): number => minutes * 600;

const SLOT: Slot = {
  position: 9,
  at: tenths(at(40)),
  category: 'A' as CategoryCode,
  cell: cellOf(1, 7),
  day: { year: 2025, month: 6, day: 10 },
  opensHour: false,
  closesHour: false,
};

function build(
  candidates: readonly LibraryEntry[],
  history: readonly Placed[] = [],
  over: Partial<SearchInput> = {},
): SearchInput {
  const view = makeScheduleView(history);
  return {
    slot: SLOT,
    candidates,
    rules: standardRuleSet(NO_RESTRICTIONS, NO_WINDOWS),
    contextFor: (candidate) => ({
      station: station(),
      categories: CATEGORIES,
      sounds: expectOk(makeSoundIndex(STANDARD_FAMILIES)),
      eras: expectOk(makeEraMap(COUNTRY_BANDS)),
      schedule: view,
      slot: SLOT,
      candidate,
    }),
    scoring: { plays: [], dayparts: [], daypart: -1 },
    ...over,
  };
}

/** One fiddle record close behind, so only the sound rule objects. */
const fiddleBehind = (): Placed[] => [
  placed({
    position: 0,
    at: at(35),
    number: 'M0500',
    billed: 'Dolly Parton',
    title: 'Jolene',
    sounds: ['fiddle'],
  }),
];

const violinCandidate = (): LibraryEntry[] => [
  entry({
    number: 'M0001',
    category: 'A',
    billed: 'Johnny Cash',
    title: 'Ring of Fire',
    sounds: ['violin'],
  }),
];

describe('fillSlot with nothing in the way', () => {
  it('fills the slot from the first candidate on an empty log', () => {
    const outcome = fillSlot(build([entry({ number: 'M0001', category: 'A' })]));
    expect(outcome.filled).toBe(true);
    if (outcome.filled) {
      expect(outcome.placement.entry.cart.number).toBe('M0001');
      expect(outcome.placement.relaxedBy).toBe(0);
      expect(outcome.placement.breached).toEqual([]);
      expect(outcome.placement.considered).toBe(1);
    }
    expect(isClean(outcome)).toBe(true);
  });

  it('holes a slot with no candidates at all', () => {
    const outcome = fillSlot(build([]));
    expect(outcome.filled).toBe(false);
    if (!outcome.filled) {
      expect(outcome.hole.reason).toBe('no candidates');
      expect(outcome.hole.considered).toBe(0);
    }
  });

  it('takes the best scoring candidate rather than the first', () => {
    const history = [placed({ position: 0, at: at(0), number: 'M0500', billed: 'Dolly Parton' })];
    const tight = entry({ number: 'M0001', category: 'A', billed: 'Dolly Parton' });
    const roomy = entry({ number: 'M0002', category: 'A', billed: 'Johnny Cash' });
    const outcome = fillSlot(build([tight, roomy], history));
    expect(outcome.filled).toBe(true);
    if (outcome.filled) {
      expect(outcome.placement.entry.cart.number).toBe('M0002');
    }
  });

  it('breaks a score tie on the cart number', () => {
    const candidates = [
      entry({ number: 'M0009', category: 'A' }),
      entry({ number: 'M0002', category: 'A' }),
    ];
    const outcome = fillSlot(build(candidates));
    if (outcome.filled) {
      expect(outcome.placement.entry.cart.number).toBe('M0002');
    }
  });

  it('gives the same answer on a rerun', () => {
    const candidates = [
      entry({ number: 'M0009', category: 'A' }),
      entry({ number: 'M0002', category: 'A' }),
    ];
    const once = fillSlot(build(candidates));
    const again = fillSlot(build(candidates));
    expect(once.filled && again.filled).toBe(true);
    if (once.filled && again.filled) {
      expect(again.placement.entry.cart.number).toBe(once.placement.entry.cart.number);
    }
  });
});

describe('fillSlot when it has to relax', () => {
  it('fills the slot and says it relaxed to do it', () => {
    const outcome = fillSlot(build(violinCandidate(), fiddleBehind()));
    expect(outcome.filled).toBe(true);
    if (outcome.filled) {
      expect(outcome.placement.relaxedBy).toBeGreaterThan(0);
      expect(outcome.placement.breached).toContain('sound separation');
    }
    expect(isClean(outcome)).toBe(false);
  });

  it('does not call a relaxed placement clean', () => {
    expect(isClean(fillSlot(build(violinCandidate(), fiddleBehind())))).toBe(false);
    expect(isClean(fillSlot(build(violinCandidate())))).toBe(true);
  });

  it('prefers a candidate that needs no relaxation over one that does', () => {
    const clean = entry({
      number: 'M0002',
      category: 'A',
      billed: 'Merle Haggard',
      title: 'Mama Tried',
      sounds: ['banjo'],
    });
    const outcome = fillSlot(build([...violinCandidate(), clean], fiddleBehind()));
    if (outcome.filled) {
      expect(outcome.placement.entry.cart.number).toBe('M0002');
      expect(outcome.placement.relaxedBy).toBe(0);
    }
  });

  it('refuses to relax past a floor that is set', () => {
    const outcome = fillSlot(build(violinCandidate(), fiddleBehind(), { floor: 3 }));
    expect(outcome.filled).toBe(false);
    if (!outcome.filled) {
      expect(outcome.hole.reason).toBe('nothing passed');
      expect(outcome.hole.rejections[0]?.rules).toContain('sound separation');
    }
  });
});

describe('fillSlot when nothing can go in', () => {
  it('holes the slot and says which rules rejected each candidate', () => {
    const outcome = fillSlot(build([entry({ number: 'M0001', category: 'G' })]));
    expect(outcome.filled).toBe(false);
    if (!outcome.filled) {
      expect(outcome.hole.reason).toBe('nothing passed');
      expect(outcome.hole.considered).toBe(1);
      expect(outcome.hole.rejections[0]?.cart).toBe('M0001');
      expect(outcome.hole.rejections[0]?.rules).toContain('category match');
    }
  });

  it('reports every candidate that was tried', () => {
    const candidates = [
      entry({ number: 'M0001', category: 'G' }),
      entry({ number: 'M0002', category: 'G' }),
    ];
    const outcome = fillSlot(build(candidates));
    if (!outcome.filled) {
      expect(outcome.hole.rejections.map((each) => each.cart)).toEqual(['M0001', 'M0002']);
    }
  });

  it('never relaxes a tier zero rule away', () => {
    const outcome = fillSlot(build([entry({ number: 'J0001', billed: '', category: 'X' })]));
    expect(outcome.filled).toBe(false);
  });
});

describe('the tier is dropped for the slot, not per candidate', () => {
  it('never takes a lower tier candidate over a higher tier one', () => {
    // M0001 breaks only sound at tier 3; M0002 breaks artist at tier 2 as well.
    const soundOnly = violinCandidate();
    const artistToo = entry({
      number: 'M0002',
      category: 'A',
      billed: 'Dolly Parton',
      title: 'Coat of Many Colors',
      sounds: ['banjo'],
    });
    const outcome = fillSlot(build([artistToo, ...soundOnly], fiddleBehind()));
    expect(outcome.filled).toBe(true);
    if (outcome.filled) {
      expect(outcome.placement.entry.cart.number).toBe('M0001');
      expect(outcome.placement.breached).not.toContain('artist separation');
    }
  });

  it('reports the tier it settled at', () => {
    const clean = fillSlot(build(violinCandidate()));
    const relaxed = fillSlot(build(violinCandidate(), fiddleBehind()));
    if (clean.filled && relaxed.filled) {
      expect(relaxed.placement.tier).toBeLessThan(clean.placement.tier);
    }
  });
});
