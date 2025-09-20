/**
 * Comparing two schedules.
 *
 * A director changes a clock, or a minimum, or restricts a handful of carts, and
 * wants to know what it did before committing to it. Rerunning the pass gives
 * two logs, and the useful thing is not either log but the difference.
 *
 * The comparison is by slot rather than by cart, because a cart that moved from
 * 07:20 to 07:40 has not been added and removed, it has moved, and a report that
 * says otherwise buries the four real changes in forty false ones.
 */

import { ascending } from '../util/ordering.js';
import type { Tenths } from '../util/duration.js';
import type { Placed } from '../rules/rule.js';

export type ChangeKind = 'unchanged' | 'replaced' | 'moved' | 'added' | 'removed';

export interface SlotChange {
  readonly position: number;
  readonly kind: ChangeKind;
  readonly was?: string;
  readonly now?: string;
  /** How far the cart moved in time, when it moved. */
  readonly by?: Tenths;
}

export interface ScheduleDiff {
  readonly changes: readonly SlotChange[];
  readonly unchanged: number;
  readonly replaced: number;
  readonly moved: number;
  readonly added: number;
  readonly removed: number;
}

function indexByPosition(placed: readonly Placed[]): Map<number, Placed> {
  return new Map(placed.map((item) => [item.position, item]));
}

function indexByCart(placed: readonly Placed[]): Map<string, Placed[]> {
  const index = new Map<string, Placed[]>();
  for (const item of placed) {
    const bucket = index.get(item.cart);
    if (bucket === undefined) {
      index.set(item.cart, [item]);
    } else {
      bucket.push(item);
    }
  }
  return index;
}

export function diffSchedules(before: readonly Placed[], after: readonly Placed[]): ScheduleDiff {
  const wasAt = indexByPosition(before);
  const nowAt = indexByPosition(after);
  const nowByCart = indexByCart(after);
  const wasByCart = indexByCart(before);
  const positions = [...new Set([...wasAt.keys(), ...nowAt.keys()])].sort(ascending);
  const changes: SlotChange[] = [];

  for (const position of positions) {
    const was = wasAt.get(position);
    const now = nowAt.get(position);
    if (was !== undefined && now !== undefined) {
      const kind = was.cart === now.cart ? 'unchanged' : 'replaced';
      changes.push({ position, kind, was: was.cart, now: now.cart });
      continue;
    }
    if (was !== undefined) {
      // Gone from this slot, but the same cart may be somewhere else now.
      const elsewhere = (nowByCart.get(was.cart) ?? []).find((item) => item.position !== position);
      if (elsewhere === undefined) {
        changes.push({ position, kind: 'removed', was: was.cart });
      } else {
        changes.push({
          position,
          kind: 'moved',
          was: was.cart,
          now: was.cart,
          by: (elsewhere.at - was.at) as Tenths,
        });
      }
      continue;
    }
    if (now !== undefined) {
      const wasElsewhere = (wasByCart.get(now.cart) ?? []).find(
        (item) => item.position !== position,
      );
      if (wasElsewhere === undefined) {
        changes.push({ position, kind: 'added', now: now.cart });
      }
    }
  }

  const count = (kind: ChangeKind): number =>
    changes.filter((change) => change.kind === kind).length;

  return {
    changes,
    unchanged: count('unchanged'),
    replaced: count('replaced'),
    moved: count('moved'),
    added: count('added'),
    removed: count('removed'),
  };
}

/** Everything that is not unchanged, which is what a director reads. */
export function realChanges(diff: ScheduleDiff): SlotChange[] {
  return diff.changes.filter((change) => change.kind !== 'unchanged');
}

export function isIdentical(diff: ScheduleDiff): boolean {
  return realChanges(diff).length === 0;
}

/** How much of the schedule survived, as a fraction of what was there. */
export function stability(diff: ScheduleDiff): number {
  const before = diff.unchanged + diff.replaced + diff.moved + diff.removed;
  return before === 0 ? 1 : diff.unchanged / before;
}
