import { beforeEach, describe, expect, it } from 'vitest';
import { Router } from '../../src/api/dispatch.js';
import { BAD_PARAMS } from '../../src/api/envelope.js';
import { libraryRoutes } from '../../src/api/library-handlers.js';
import { StationService, emptyState } from '../../src/service/station-service.js';
import type { StationState } from '../../src/service/station-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import { size } from '../../src/library/library.js';
import { resetFixtures, station } from '../support/fixtures.js';
import { expectOk } from '../support/result.js';

beforeEach(() => {
  resetFixtures();
});

const BASE = 1_700_000_000_000;
let counter = 0;

function harness(): { router: Router; service: StationService; journal: Journal } {
  const journal = Journal.open(new MemoryStorage());
  let state: StationState = emptyState(station());
  for (const input of STANDARD_CATEGORIES) {
    const built = expectOk(makeCategory(input));
    const categories = new Map(state.categories);
    categories.set(built.code, built);
    state = { ...state, categories };
  }
  const service = new StationService(state, journal);
  return { router: new Router(libraryRoutes(service)), service, journal };
}

function call(
  router: Router,
  op: string,
  params: Record<string, unknown>,
): ReturnType<Router['handle']> {
  counter += 1;
  return router.handle({ op, id: `r${counter}`, at: BASE, params });
}

const CART = {
  number: 'M0001',
  title: 'Ferry Road',
  billed: 'The Lint Committee',
  runtime: '3:12',
  category: 'A',
};

const RECORDING = {
  isrc: 'GBAAA2300001',
  title: 'Ferry Road',
  label: 'Bright Terrace',
  releaseYear: 2023,
};

describe('library.add', () => {
  it('adds a cart and answers with its number', () => {
    const { router, service } = harness();
    const response = call(router, 'library.add', { cart: CART });
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ cart: 'M0001' });
    expect(size(service.current().library)).toBe(1);
  });

  it('adds the recording alongside the cart when one is given', () => {
    const { router, service } = harness();
    expect(call(router, 'library.add', { cart: CART, recording: RECORDING }).ok).toBe(true);
    const entry = service.current().library.byNumber.get('M0001' as never);
    expect(entry?.recording?.isrc).toBe('GBAAA2300001');
  });

  it('refuses params that are not a cart at all, and writes nothing', () => {
    const { router, service, journal } = harness();
    const response = call(router, 'library.add', { cart: { title: 'no number' } });
    expect(response.ok).toBe(false);
    expect(response.problems.every((item) => item.code === BAD_PARAMS)).toBe(true);
    expect(size(service.current().library)).toBe(0);
    expect(journal.readAll().records).toHaveLength(0);
  });

  it('refuses a cart that will not build, before the journal is touched', () => {
    const { router, journal } = harness();
    const response = call(router, 'library.add', { cart: { ...CART, runtime: 'soon' } });
    expect(response.ok).toBe(false);
    expect(journal.readAll().records).toHaveLength(0);
  });

  it('refuses a recording that will not build, and does not add the cart either', () => {
    const { router, service } = harness();
    const response = call(router, 'library.add', {
      cart: CART,
      recording: { ...RECORDING, isrc: 'nope' },
    });
    expect(response.ok).toBe(false);
    expect(size(service.current().library)).toBe(0);
  });

  it('reads the release year against the caller clock, not ours', () => {
    const { router } = harness();
    // BASE is in 2023, so a 2024 release has not happened yet as far as the
    // request is concerned, and a batch replayed later must read the same.
    const response = call(router, 'library.add', {
      cart: CART,
      recording: { ...RECORDING, releaseYear: 2024 },
    });
    expect(response.ok).toBe(false);
  });

  it('refuses the second add of the same cart', () => {
    const { router } = harness();
    call(router, 'library.add', { cart: CART });
    expect(call(router, 'library.add', { cart: CART }).ok).toBe(false);
  });
});

describe('library.update', () => {
  it('replaces a cart that is there', () => {
    const { router, service } = harness();
    call(router, 'library.add', { cart: CART });
    const response = call(router, 'library.update', {
      cart: { ...CART, title: 'Ferry Road (remaster)' },
    });
    expect(response.ok).toBe(true);
    expect(service.current().library.byNumber.get('M0001' as never)?.cart.title).toBe(
      'Ferry Road (remaster)',
    );
  });

  it('refuses a cart that was never added', () => {
    const { router } = harness();
    expect(call(router, 'library.update', { cart: CART }).ok).toBe(false);
  });
});

describe('library.remove', () => {
  it('takes the cart out', () => {
    const { router, service } = harness();
    call(router, 'library.add', { cart: CART });
    expect(call(router, 'library.remove', { cart: 'M0001' }).ok).toBe(true);
    expect(size(service.current().library)).toBe(0);
  });

  it('refuses a cart number that is not one', () => {
    const { router } = harness();
    const response = call(router, 'library.remove', { cart: 'not a cart' });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.code).toBe(BAD_PARAMS);
  });

  it('refuses a cart that is not in the library', () => {
    const { router } = harness();
    expect(call(router, 'library.remove', { cart: 'M0404' }).ok).toBe(false);
  });

  it('refuses a request with no cart at all', () => {
    const { router } = harness();
    expect(call(router, 'library.remove', {}).ok).toBe(false);
  });
});

describe('library.card', () => {
  it('moves a cart into another category and answers with the carding', () => {
    const { router } = harness();
    call(router, 'library.add', { cart: CART });
    const response = call(router, 'library.card', { cart: 'M0001', to: 'B', note: 'burned out' });
    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({ cart: 'M0001', to: 'B' });
  });

  it('works without a note', () => {
    const { router } = harness();
    call(router, 'library.add', { cart: CART });
    expect(call(router, 'library.card', { cart: 'M0001', to: 'B' }).ok).toBe(true);
  });

  it('refuses a target category that is not a code', () => {
    const { router } = harness();
    call(router, 'library.add', { cart: CART });
    const response = call(router, 'library.card', { cart: 'M0001', to: 'not a code' });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('to');
  });
});

describe('library.get', () => {
  it('reads a cart back', () => {
    const { router } = harness();
    call(router, 'library.add', { cart: CART, recording: RECORDING });
    const response = call(router, 'library.get', { cart: 'M0001' });
    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({
      cart: 'M0001',
      title: 'Ferry Road',
      category: 'A',
      isrc: 'GBAAA2300001',
    });
  });

  it('answers with an empty isrc for a cart with no recording', () => {
    const { router } = harness();
    call(router, 'library.add', { cart: CART });
    expect(call(router, 'library.get', { cart: 'M0001' }).data).toMatchObject({ isrc: '' });
  });

  it('refuses a cart that is not there', () => {
    const { router } = harness();
    const response = call(router, 'library.get', { cart: 'M0404' });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('M0404');
  });

  it('does not write', () => {
    const { router } = harness();
    expect(router.writes('library.get')).toBe(false);
  });
});

describe('library.count', () => {
  it('counts the whole library when no category is named', () => {
    const { router } = harness();
    call(router, 'library.add', { cart: CART });
    call(router, 'library.add', { cart: { ...CART, number: 'M0002' } });
    expect(call(router, 'library.count', {}).data).toEqual({ carts: 2 });
  });

  it('counts one category', () => {
    const { router } = harness();
    call(router, 'library.add', { cart: CART });
    call(router, 'library.add', { cart: { ...CART, number: 'M0002', category: 'B' } });
    expect(call(router, 'library.count', { category: 'A' }).data).toEqual({ carts: 1 });
  });

  it('counts nothing for a category nobody has carded into', () => {
    const { router } = harness();
    expect(call(router, 'library.count', { category: 'C' }).data).toEqual({ carts: 0 });
  });

  it('refuses a category that is not a code', () => {
    const { router } = harness();
    expect(call(router, 'library.count', { category: 'not a code' }).ok).toBe(false);
  });
});

describe('category.add', () => {
  it('defines a category', () => {
    const { router, service } = harness();
    const response = call(router, 'category.add', { code: 'Z', name: 'Overnight gold' });
    expect(response.ok).toBe(true);
    expect(service.current().categories.has('Z' as never)).toBe(true);
  });

  it('refuses one that is already defined', () => {
    const { router } = harness();
    expect(call(router, 'category.add', { code: 'A', name: 'Current' }).ok).toBe(false);
  });

  it('refuses a code that is not a code', () => {
    const { router } = harness();
    expect(call(router, 'category.add', { code: 'not a code', name: 'x' }).ok).toBe(false);
  });

  it('refuses a request with no name', () => {
    const { router } = harness();
    const response = call(router, 'category.add', { code: 'Z' });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('name');
  });
});
