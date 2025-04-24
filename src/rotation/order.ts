/**
 * The rotation order.
 *
 * Given a category and a moment, which carts may play and in what order the
 * scheduler should try them. Everything upstream feeds in here: membership says
 * who is in the category, the window says who is live today, the restriction
 * says who may play in this cell of the week, and rest says who goes first.
 *
 * The order matters more than it looks. The scheduler tries candidates in this
 * order and takes the first that passes every rule, so changing the order does
 * not change which carts are legal, it changes which legal cart is chosen, and
 * therefore which rule rejects the ones before it. Two orderings over the same
 * library produce different logs and different breach reports.
 */

import type { CartNumber, CategoryCode } from '../util/ids.js';
import type { WeekCell } from '../domain/daypart.js';
import type { BroadcastDay } from '../util/time.js';
import { inCategory } from '../library/library.js';
import type { Library, LibraryEntry } from '../library/library.js';
import { allowedInCell } from '../library/restriction.js';
import type { RestrictionMap } from '../library/restriction.js';
import { liveOn } from '../library/window.js';
import type { WindowMap } from '../library/window.js';
import { restOrder } from './position.js';
import type { PositionIndex } from './position.js';

export interface EligibilityContext {
  readonly library: Library;
  readonly positions: PositionIndex;
  readonly restrictions: RestrictionMap;
  readonly windows: WindowMap;
  readonly day: BroadcastDay;
  readonly cell: WeekCell;
}

export type ExclusionReason = 'retired' | 'restricted';

export interface Exclusion {
  readonly cart: CartNumber;
  readonly reason: ExclusionReason;
}

export interface Eligibility {
  readonly eligible: readonly LibraryEntry[];
  readonly excluded: readonly Exclusion[];
}

/**
 * Split the category into what may play here and what may not, keeping the
 * reason. The reasons are what makes a hole explainable rather than a mystery.
 */
export function eligibleIn(context: EligibilityContext, category: CategoryCode): Eligibility {
  const eligible: LibraryEntry[] = [];
  const excluded: Exclusion[] = [];
  for (const entry of inCategory(context.library, category)) {
    const cart = entry.cart.number;
    if (!liveOn(context.windows, cart, context.day)) {
      excluded.push({ cart, reason: 'retired' });
      continue;
    }
    if (!allowedInCell(context.restrictions, cart, context.cell)) {
      excluded.push({ cart, reason: 'restricted' });
      continue;
    }
    eligible.push(entry);
  }
  return { eligible, excluded };
}

/** The eligible carts of a category, best rested first. */
export function rotationOrder(context: EligibilityContext, category: CategoryCode): LibraryEntry[] {
  const { eligible } = eligibleIn(context, category);
  const byNumber = new Map(eligible.map((entry) => [entry.cart.number, entry]));
  const ordered = restOrder(
    context.positions,
    eligible.map((entry) => entry.cart.number),
    category,
  );
  const out: LibraryEntry[] = [];
  for (const number of ordered) {
    const entry = byNumber.get(number);
    if (entry !== undefined) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * How big the category really is here, as against how big it is on paper. This
 * is the number turnover should be computed from, and computing it from the
 * paper size is the single most common way a turnover report lies.
 */
export function effectiveSize(context: EligibilityContext, category: CategoryCode): number {
  return eligibleIn(context, category).eligible.length;
}

export function paperSize(context: EligibilityContext, category: CategoryCode): number {
  return inCategory(context.library, category).length;
}

/** How much of the category this cell cannot reach, as a fraction. */
export function shrinkage(context: EligibilityContext, category: CategoryCode): number {
  const paper = paperSize(context, category);
  if (paper === 0) {
    return 0;
  }
  return (paper - effectiveSize(context, category)) / paper;
}

export function excludedFor(
  context: EligibilityContext,
  category: CategoryCode,
  reason: ExclusionReason,
): CartNumber[] {
  return eligibleIn(context, category)
    .excluded.filter((exclusion) => exclusion.reason === reason)
    .map((exclusion) => exclusion.cart);
}
