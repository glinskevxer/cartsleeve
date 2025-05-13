/**
 * Rotation state between runs.
 *
 * Packets only spread a category if the cursor survives from one scheduling run
 * to the next. A day pass that redeals from scratch every morning draws the same
 * opening packet every day, which is worse than not packeting at all.
 *
 * So the cursors are state, and the awkward question is what to do when the
 * library moves under them. A cart carded out of the category mid cycle leaves a
 * hole; twenty carts carded in leave a cycle that will not reach them for a
 * fortnight. Three policies, and the right one depends on the size of the move:
 *
 *   `keep`    carry on and pick the newcomers up next cycle
 *   `redeal`  deal again from the current rest order, losing the cycle position
 *   `auto`    keep for a small change and redeal once the category has moved
 *             more than a threshold, which is what a director would do by hand
 */

import type { CartNumber, CategoryCode } from '../util/ids.js';
import { dealPackets, isSpent, startCursor, totalCarts } from './packet.js';
import type { PacketCursor, Packets } from './packet.js';

export type RedealPolicy = 'keep' | 'redeal' | 'auto';

export interface CategoryState {
  readonly packets: Packets;
  readonly cursor: PacketCursor;
  /** How many full cycles this category has completed. */
  readonly laps: number;
}

export interface RotationState {
  readonly byCategory: ReadonlyMap<CategoryCode, CategoryState>;
}

export const EMPTY_ROTATION_STATE: RotationState = {
  byCategory: new Map<CategoryCode, CategoryState>(),
};

export function stateFor(state: RotationState, category: CategoryCode): CategoryState | undefined {
  return state.byCategory.get(category);
}

export function freshState(
  category: CategoryCode,
  ordered: readonly CartNumber[],
  packetCount: number,
): CategoryState {
  return {
    packets: dealPackets(category, ordered, packetCount),
    cursor: startCursor(category),
    laps: 0,
  };
}

/** How far the membership has moved since the packets were dealt, as a fraction. */
export function drift(existing: Packets, ordered: readonly CartNumber[]): number {
  const dealt = new Set(existing.groups.flat());
  const now = new Set(ordered);
  if (dealt.size === 0 && now.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const cart of now) {
    if (dealt.has(cart)) {
      shared += 1;
    }
  }
  const union = dealt.size + now.size - shared;
  return union === 0 ? 0 : 1 - shared / union;
}

export const DEFAULT_REDEAL_THRESHOLD = 0.2;

export interface AdvanceOptions {
  readonly policy: RedealPolicy;
  readonly threshold?: number;
}

/**
 * Bring a category's state up to date against the current rest order. A spent
 * cycle always redeals, whatever the policy, because carrying on past the end
 * of the packets is not a thing the cursor can do.
 */
export function refresh(
  state: RotationState,
  category: CategoryCode,
  ordered: readonly CartNumber[],
  packetCount: number,
  options: AdvanceOptions,
): CategoryState {
  const existing = state.byCategory.get(category);
  if (existing === undefined) {
    return freshState(category, ordered, packetCount);
  }
  if (isSpent(existing.packets, existing.cursor)) {
    return { ...freshState(category, ordered, packetCount), laps: existing.laps + 1 };
  }
  if (options.policy === 'redeal') {
    return { ...freshState(category, ordered, packetCount), laps: existing.laps };
  }
  if (options.policy === 'auto') {
    const moved = drift(existing.packets, ordered);
    if (moved > (options.threshold ?? DEFAULT_REDEAL_THRESHOLD)) {
      return { ...freshState(category, ordered, packetCount), laps: existing.laps };
    }
  }
  return existing;
}

export function withCategoryState(
  state: RotationState,
  category: CategoryCode,
  next: CategoryState,
): RotationState {
  const byCategory = new Map(state.byCategory);
  byCategory.set(category, next);
  return { byCategory };
}

export function withCursor(
  state: RotationState,
  category: CategoryCode,
  cursor: PacketCursor,
): RotationState {
  const existing = state.byCategory.get(category);
  if (existing === undefined) {
    return state;
  }
  return withCategoryState(state, category, { ...existing, cursor });
}

/** How far through its cycle a category is, from 0 to 1. */
export function progress(state: CategoryState): number {
  const total = totalCarts(state.packets);
  if (total === 0) {
    return 1;
  }
  let drawn = 0;
  for (const [index, group] of state.packets.groups.entries()) {
    const offset = index < state.cursor.packet ? state.cursor.offset + 1 : state.cursor.offset;
    drawn += Math.min(offset, group.length);
  }
  return Math.min(1, drawn / total);
}
