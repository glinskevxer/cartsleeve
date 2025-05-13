import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REDEAL_THRESHOLD,
  EMPTY_ROTATION_STATE,
  drift,
  freshState,
  progress,
  refresh,
  stateFor,
  withCategoryState,
  withCursor,
} from '../../src/rotation/state.js';
import { advance, dealPackets, drawOrder, startCursor } from '../../src/rotation/packet.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';

const A = 'A' as CategoryCode;
const cart = (value: string): CartNumber => value as CartNumber;

function carts(count: number, from = 1): CartNumber[] {
  return Array.from(
    { length: count },
    (_, index) => `M${String(index + from).padStart(4, '0')}` as CartNumber,
  );
}

describe('freshState', () => {
  it('deals the packets and starts at the beginning', () => {
    const state = freshState(A, carts(6), 3);
    expect(state.cursor).toEqual(startCursor(A));
    expect(state.laps).toBe(0);
    expect(drawOrder(state.packets)).toHaveLength(6);
  });

  it('reports no progress at the start and full progress when spent', () => {
    const state = freshState(A, carts(4), 2);
    expect(progress(state)).toBe(0);
    let cursor = state.cursor;
    for (let step = 0; step < 4; step += 1) {
      cursor = advance(state.packets, cursor);
    }
    expect(progress({ ...state, cursor })).toBe(1);
  });

  it('reports full progress on an empty category', () => {
    expect(progress(freshState(A, [], 3))).toBe(1);
  });

  it('reports partial progress part way through', () => {
    const state = freshState(A, carts(6), 3);
    const cursor = advance(state.packets, advance(state.packets, state.cursor));
    expect(progress({ ...state, cursor })).toBeCloseTo(2 / 6);
  });
});

describe('drift', () => {
  it('is zero when the membership has not moved', () => {
    expect(drift(dealPackets(A, carts(10), 2), carts(10))).toBe(0);
  });

  it('is one when nothing is shared', () => {
    expect(drift(dealPackets(A, carts(5), 2), carts(5, 100))).toBe(1);
  });

  it('grows with the size of the change', () => {
    const dealt = dealPackets(A, carts(10), 2);
    const small = drift(dealt, [...carts(9), cart('M9999')]);
    const large = drift(dealt, [...carts(5), ...carts(5, 100)]);
    expect(small).toBeLessThan(large);
    expect(small).toBeGreaterThan(0);
  });

  it('counts a removal as readily as an addition', () => {
    const dealt = dealPackets(A, carts(10), 2);
    expect(drift(dealt, carts(9))).toBeGreaterThan(0);
    expect(drift(dealt, carts(11))).toBeGreaterThan(0);
  });

  it('is zero when both sides are empty', () => {
    expect(drift(dealPackets(A, [], 2), [])).toBe(0);
  });

  it('does not care about the order', () => {
    const dealt = dealPackets(A, carts(6), 2);
    expect(drift(dealt, [...carts(6)].reverse())).toBe(0);
  });
});

describe('refresh', () => {
  const seeded = (): ReturnType<typeof withCategoryState> =>
    withCategoryState(EMPTY_ROTATION_STATE, A, freshState(A, carts(10), 2));

  it('deals fresh when the category has no state yet', () => {
    const next = refresh(EMPTY_ROTATION_STATE, A, carts(6), 3, { policy: 'keep' });
    expect(next.laps).toBe(0);
    expect(progress(next)).toBe(0);
  });

  it('keeps the cursor under the keep policy even when the library moved', () => {
    const state = seeded();
    const before = stateFor(state, A);
    const moved = withCursor(
      state,
      A,
      advance(before?.packets ?? dealPackets(A, [], 1), before?.cursor ?? startCursor(A)),
    );
    const next = refresh(moved, A, [...carts(9), cart('M9999')], 2, { policy: 'keep' });
    expect(next.cursor).toEqual(stateFor(moved, A)?.cursor);
  });

  it('deals again under the redeal policy and keeps the lap count', () => {
    const state = seeded();
    const before = stateFor(state, A);
    const moved = withCursor(
      state,
      A,
      advance(before?.packets ?? dealPackets(A, [], 1), before?.cursor ?? startCursor(A)),
    );
    const next = refresh(moved, A, carts(10), 2, { policy: 'redeal' });
    expect(progress(next)).toBe(0);
    expect(next.laps).toBe(0);
  });

  it('keeps a small change under auto and redeals a large one', () => {
    const state = seeded();
    const before = stateFor(state, A);
    const moved = withCursor(
      state,
      A,
      advance(before?.packets ?? dealPackets(A, [], 1), before?.cursor ?? startCursor(A)),
    );
    const small = refresh(moved, A, [...carts(9), cart('M9999')], 2, { policy: 'auto' });
    const large = refresh(moved, A, carts(10, 100), 2, { policy: 'auto' });
    expect(progress(small)).toBeGreaterThan(0);
    expect(progress(large)).toBe(0);
  });

  it('honours a threshold that is set explicitly', () => {
    const state = seeded();
    const before = stateFor(state, A);
    const moved = withCursor(
      state,
      A,
      advance(before?.packets ?? dealPackets(A, [], 1), before?.cursor ?? startCursor(A)),
    );
    const nudged = [...carts(9), cart('M9999')];
    expect(
      progress(refresh(moved, A, nudged, 2, { policy: 'auto', threshold: 0.5 })),
    ).toBeGreaterThan(0);
    expect(progress(refresh(moved, A, nudged, 2, { policy: 'auto', threshold: 0.01 }))).toBe(0);
    expect(DEFAULT_REDEAL_THRESHOLD).toBe(0.2);
  });

  it('deals again and counts a lap once the cycle is spent, whatever the policy', () => {
    let state = withCategoryState(EMPTY_ROTATION_STATE, A, freshState(A, carts(4), 2));
    const packets = stateFor(state, A)?.packets ?? dealPackets(A, [], 1);
    let cursor = startCursor(A);
    for (let step = 0; step < 4; step += 1) {
      cursor = advance(packets, cursor);
    }
    state = withCursor(state, A, cursor);
    const next = refresh(state, A, carts(4), 2, { policy: 'keep' });
    expect(next.laps).toBe(1);
    expect(progress(next)).toBe(0);
  });
});

describe('holding the state', () => {
  it('stores and reads back a category', () => {
    const state = withCategoryState(EMPTY_ROTATION_STATE, A, freshState(A, carts(4), 2));
    expect(stateFor(state, A)?.laps).toBe(0);
    expect(stateFor(state, 'G' as CategoryCode)).toBeUndefined();
  });

  it('leaves the state it was given alone', () => {
    const state = withCategoryState(EMPTY_ROTATION_STATE, A, freshState(A, carts(4), 2));
    withCategoryState(state, 'G' as CategoryCode, freshState('G' as CategoryCode, carts(2), 1));
    expect(state.byCategory.size).toBe(1);
  });

  it('ignores a cursor set on a category that has no state', () => {
    const state = withCursor(EMPTY_ROTATION_STATE, A, startCursor(A));
    expect(state.byCategory.size).toBe(0);
  });
});
