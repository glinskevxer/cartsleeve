/**
 * Carding.
 *
 * Putting a cart into a category, and moving it between them. The name is from
 * the rack card that used to travel with the tape, and the operation is the
 * single most common thing a music director does: a current is carded down from
 * A to B as it cools, then to R, then to G, and each move changes how often it
 * plays and which separation minimums it is held to.
 *
 * A move is not free. Rest is measured against the category the cart was in, so
 * a cart carded from A into G arrives in a category whose rotation it has no
 * position in. This module decides whether a move is allowed and what it costs;
 * where the cart lands in the new rotation is the rotation layer's problem.
 */

import type { CategoryCode } from '../util/ids.js';
import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { Check, take } from '../util/check.js';
import type { Result } from '../util/result.js';
import type { Category } from '../domain/category.js';
import type { Library, LibraryEntry } from './library.js';
import { lookup, withEntry } from './library.js';
import type { CartNumber } from '../util/ids.js';

const CRD = (n: number): string => codeFor('library', n);

export type CardingKind = 'initial' | 'promotion' | 'demotion' | 'lateral' | 'retire';

export interface Carding {
  readonly cart: CartNumber;
  readonly from?: CategoryCode;
  readonly to: CategoryCode;
  readonly kind: CardingKind;
  readonly at: number;
  readonly note: string;
}

/**
 * Which way a move goes, read off the priorities rather than the letters.
 * A station that renames its categories still gets the right answer, and a
 * station that reorders them gets a different one, which is correct.
 */
export function cardingKind(from: Category | undefined, to: Category): CardingKind {
  if (from === undefined) {
    return 'initial';
  }
  if (!to.music) {
    return 'retire';
  }
  if (to.priority < from.priority) {
    return 'promotion';
  }
  if (to.priority > from.priority) {
    return 'demotion';
  }
  return 'lateral';
}

export interface CardingRequest {
  readonly cart: CartNumber;
  readonly to: CategoryCode;
  readonly at: number;
  readonly note?: string;
}

export interface CardingOutcome {
  readonly library: Library;
  readonly carding: Carding;
}

export function cardCart(
  library: Library,
  categories: ReadonlyMap<CategoryCode, Category>,
  request: CardingRequest,
): Result<CardingOutcome, Problem[]> {
  const check = new Check();
  const found = lookup(library, request.cart);
  check.ensure(found !== undefined, CRD(40), request.cart, 'is not in the library');
  const target = categories.get(request.to);
  check.ensure(
    target !== undefined,
    CRD(41),
    request.cart,
    'is carded into a category nothing defines',
    {
      category: request.to,
    },
  );
  if (found !== undefined && target !== undefined) {
    check.ensure(
      found.cart.category !== request.to,
      CRD(42),
      request.cart,
      'is already in that category',
      { category: request.to },
    );
    check.ensure(
      found.cart.music || !target.music,
      CRD(43),
      request.cart,
      'is not music and cannot go into a rotating category',
      { category: request.to },
    );
    check.ensure(
      !found.cart.music || target.music || request.note !== undefined,
      CRD(44),
      request.cart,
      'is music being retired and needs a note saying why',
    );
  }
  return check.result(() => {
    const existing = take(found, 'entry');
    const from = categories.get(existing.cart.category);
    const moved: LibraryEntry = {
      ...existing,
      cart: { ...existing.cart, category: request.to },
    };
    return {
      library: withEntry(library, moved),
      carding: {
        cart: request.cart,
        ...(from === undefined ? {} : { from: from.code }),
        to: request.to,
        kind: cardingKind(from, take(target, 'category')),
        at: request.at,
        note: request.note ?? '',
      },
    };
  });
}

/** Card several carts in one pass, stopping nothing on the first failure. */
export function cardMany(
  library: Library,
  categories: ReadonlyMap<CategoryCode, Category>,
  requests: readonly CardingRequest[],
): { library: Library; cardings: Carding[]; problems: Problem[] } {
  let current = library;
  const cardings: Carding[] = [];
  const problems: Problem[] = [];
  for (const request of requests) {
    const outcome = cardCart(current, categories, request);
    if (outcome.ok) {
      current = outcome.value.library;
      cardings.push(outcome.value.carding);
    } else {
      problems.push(...outcome.error);
    }
  }
  return { library: current, cardings, problems };
}

export function describeCarding(carding: Carding): string {
  const from = carding.from ?? 'nothing';
  return `${carding.cart} ${carding.kind} ${from} to ${carding.to}`;
}
