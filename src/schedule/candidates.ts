/**
 * The candidate set for one slot.
 *
 * Everything upstream comes together here. The rotation order says which carts
 * are eligible and in what order rest wants them tried; the packets say which
 * slice of the category is being drawn from; and the rules say which of them may
 * actually go in.
 *
 * The order matters more than it looks. The search takes the first candidate
 * that passes, so the order does not change which carts are legal, it changes
 * which legal cart is chosen, and therefore which rule ends up rejecting the
 * ones before it. Two orderings over the same library produce different logs and
 * different breach reports, and both are correct.
 *
 * The set is built lazily in the sense that it stops as soon as it has enough:
 * a category of four hundred gold carts does not need all four hundred scored
 * to fill one slot, and scoring them all is the difference between a day pass
 * taking a second and taking a minute.
 */

import type { CategoryCode } from '../util/ids.js';
import type { LibraryEntry } from '../library/library.js';
import { rotationOrder } from '../rotation/order.js';
import type { EligibilityContext } from '../rotation/order.js';
import { drawOrder } from '../rotation/packet.js';
import type { Packets } from '../rotation/packet.js';

export interface CandidateOptions {
  /** How many candidates to gather before stopping. */
  readonly depth: number;
  /** Draw through these packets rather than straight down the rest order. */
  readonly packets?: Packets;
}

export const DEFAULT_DEPTH = 40;

/**
 * The carts to try, in the order to try them.
 *
 * With no packets this is the rest order truncated to the depth. With packets
 * it is the packet draw order, filtered to what is eligible here, because a
 * packet was dealt from the whole category and this hour may not be able to
 * play all of it.
 */
export function candidatesFor(
  context: EligibilityContext,
  category: CategoryCode,
  options: CandidateOptions,
): LibraryEntry[] {
  const eligible = rotationOrder(context, category);
  if (options.packets === undefined) {
    return eligible.slice(0, Math.max(0, options.depth));
  }
  const byNumber = new Map(eligible.map((entry) => [entry.cart.number, entry]));
  const out: LibraryEntry[] = [];
  for (const cart of drawOrder(options.packets)) {
    if (out.length >= options.depth) {
      break;
    }
    const entry = byNumber.get(cart);
    if (entry !== undefined) {
      out.push(entry);
    }
  }
  // A packet draw that reached nothing eligible falls back to the rest order,
  // because a hole is worse than a cart drawn out of packet sequence.
  return out.length > 0 ? out : eligible.slice(0, Math.max(0, options.depth));
}

/**
 * How deep the search actually had to go. Recorded per slot, because a category
 * that routinely needs thirty candidates to fill one slot is a library problem
 * showing up as a scheduling statistic.
 */
export interface SearchDepth {
  readonly considered: number;
  readonly available: number;
}

export function depthOf(considered: number, available: number): SearchDepth {
  return { considered, available };
}

/** Whether the set is thin enough that the slot is likely to breach or hole. */
export function isThin(depth: SearchDepth, floor = 5): boolean {
  return depth.available < floor;
}
