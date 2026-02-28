import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALREADY_THERE,
  NOT_FOUND,
  StationService,
  emptyState,
} from '../../src/service/station-service.js';
import type { StationState } from '../../src/service/station-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { lookup, size } from '../../src/library/library.js';
import { categoryAt } from '../../src/library/membership.js';
import { entry, resetFixtures, station } from '../support/fixtures.js';
import { clockOf } from '../support/hour.js';
import { expectErr, expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const cart = (value: string): CartNumber => value as CartNumber;
const code = (value: string): CategoryCode => value as CategoryCode;
const BASE = 1_700_000_000_000;

function service(): { service: StationService; journal: Journal } {
  const journal = Journal.open(new MemoryStorage());
  let state: StationState = emptyState(station());
  for (const input of STANDARD_CATEGORIES) {
    const built = expectOk(makeCategory(input));
    const categories = new Map(state.categories);
    categories.set(built.code, built);
    state = { ...state, categories };
  }
  return { service: new StationService(state, journal), journal };
}

describe('adding a cart', () => {
  it('puts it in the library and writes a record', () => {
    const { service: svc, journal } = service();
    const state = expectOk(svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE));
    expect(size(state.library)).toBe(1);
    expect(journal.ofKind('cart.added')).toHaveLength(1);
  });

  it('refuses a cart that is already there, and writes nothing', () => {
    const { service: svc, journal } = service();
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE);
    const problems = expectErr(svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE + 1));
    expect(problems[0]?.code).toBe(ALREADY_THERE);
    expect(journal.ofKind('cart.added')).toHaveLength(1);
  });

  it('leaves the library alone when it refuses', () => {
    const { service: svc } = service();
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE);
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE + 1);
    expect(size(svc.current().library)).toBe(1);
  });
});

describe('updating and removing', () => {
  it('replaces a cart that is there', () => {
    const { service: svc, journal } = service();
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE);
    const state = expectOk(svc.updateCart(entry({ number: 'M0001', category: 'G' }), BASE + 1));
    expect(lookup(state.library, cart('M0001'))?.cart.category).toBe('G');
    expect(journal.ofKind('cart.updated')).toHaveLength(1);
  });

  it('refuses to update a cart that is not there', () => {
    const { service: svc } = service();
    expect(expectErr(svc.updateCart(entry({ number: 'M0001' }), BASE))[0]?.code).toBe(NOT_FOUND);
  });

  it('removes a cart that is there', () => {
    const { service: svc, journal } = service();
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE);
    const state = expectOk(svc.removeCart(cart('M0001'), BASE + 1));
    expect(size(state.library)).toBe(0);
    expect(journal.ofKind('cart.removed')).toHaveLength(1);
  });

  it('refuses to remove a cart that is not there', () => {
    const { service: svc } = service();
    expect(expectErr(svc.removeCart(cart('M9999'), BASE))[0]?.code).toBe(NOT_FOUND);
  });
});

describe('carding', () => {
  it('moves the cart and records the move in the history', () => {
    const { service: svc, journal } = service();
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE);
    const carding = expectOk(svc.card(cart('M0001'), code('G'), BASE + 1000));
    expect(carding.kind).toBe('demotion');
    expect(lookup(svc.current().library, cart('M0001'))?.cart.category).toBe('G');
    expect(categoryAt(svc.current().history, cart('M0001'), BASE + 2000)).toBe('G');
    expect(journal.ofKind('cart.carded')).toHaveLength(1);
  });

  it('refuses a move the carding rules reject, and writes nothing', () => {
    const { service: svc, journal } = service();
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE);
    const problems = expectErr(svc.card(cart('M0001'), code('A'), BASE + 1000));
    expect(problems[0]?.code).toBe('LIB-042');
    expect(journal.ofKind('cart.carded')).toEqual([]);
  });

  it('carries a note onto the carding', () => {
    const { service: svc } = service();
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE);
    const carding = expectOk(svc.card(cart('M0001'), code('X'), BASE + 1000, 'label pulled it'));
    expect(carding.note).toBe('label pulled it');
  });
});

describe('categories and clocks', () => {
  it('adds a category once', () => {
    const { service: svc } = service();
    const fresh = expectOk(makeCategory({ code: 'P', name: 'Power' }));
    expect(expectOk(svc.addCategory(fresh, BASE)).categories.has(code('P'))).toBe(true);
    expect(expectErr(svc.addCategory(fresh, BASE + 1))[0]?.code).toBe(ALREADY_THERE);
  });

  it('adds a clock once', () => {
    const { service: svc, journal } = service();
    const clock = clockOf([{ kind: 'music', target: '0:00', category: 'A' }]);
    expect(expectOk(svc.addClock(clock, BASE)).clocks.has('TEST')).toBe(true);
    expect(expectErr(svc.addClock(clock, BASE + 1))[0]?.code).toBe(ALREADY_THERE);
    expect(journal.ofKind('clock.added')).toHaveLength(1);
  });

  it('replaces a clock that is defined', () => {
    const { service: svc, journal } = service();
    svc.addClock(clockOf([{ kind: 'music', target: '0:00', category: 'A' }]), BASE);
    const bigger = clockOf([
      { kind: 'music', target: '0:00', category: 'A' },
      { kind: 'music', target: '3:00', category: 'G' },
    ]);
    const state = expectOk(svc.replaceClock(bigger, BASE + 1));
    expect(state.clocks.get('TEST')?.elements).toHaveLength(2);
    expect(journal.ofKind('clock.replaced')).toHaveLength(1);
  });

  it('refuses to replace a clock that is not defined', () => {
    const { service: svc } = service();
    const clock = clockOf([{ kind: 'music', target: '0:00', category: 'A' }]);
    expect(expectErr(svc.replaceClock(clock, BASE))[0]?.code).toBe(NOT_FOUND);
  });
});

describe('the journal is the record of how it got there', () => {
  it('carries every accepted change and nothing else', () => {
    const { service: svc, journal } = service();
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE);
    svc.addCart(entry({ number: 'M0001', category: 'A' }), BASE + 1);
    svc.card(cart('M0001'), code('G'), BASE + 2);
    expect(journal.kinds()).toEqual(['cart.added', 'cart.carded']);
    expect(journal.length).toBe(2);
  });

  it('starts empty for a fresh station', () => {
    const { service: svc, journal } = service();
    expect(journal.length).toBe(0);
    expect(size(svc.current().library)).toBe(0);
  });

  it('keeps the station it was built with', () => {
    expect(service().service.current().station.callSign).toBe('KHRT');
  });
});
