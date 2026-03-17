/**
 * Station operations.
 *
 * The first layer that is allowed to change anything. Everything below is either
 * a value or a pure function over values; this owns the journal and is the only
 * place a decision becomes a fact.
 *
 * Every operation follows the same shape and it is worth stating once. Validate
 * against the current state, refuse with problems if it does not hold, append a
 * record if it does, and return the new state. Nothing writes to the journal
 * without having validated first, and nothing validates without the caller being
 * able to see why it failed.
 *
 * The service holds state in memory and the journal is the record of how it got
 * there. That means a restart replays rather than reads, which is slower to
 * start and impossible to get subtly wrong.
 */

import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';
import { ALREADY_THERE, NOT_FOUND, requireAbsent, requirePresent } from './guard.js';
import type { CartNumber, CategoryCode } from '../util/ids.js';
import type { Station } from '../domain/station.js';
import type { Category } from '../domain/category.js';
import type { Clock } from '../domain/clock.js';
import type { Library, LibraryEntry } from '../library/library.js';
import { makeLibrary, lookup, withEntry, withoutCart } from '../library/library.js';
import { cardCart } from '../library/carding.js';
import type { Carding } from '../library/carding.js';
import { EMPTY_HISTORY, withCarding } from '../library/membership.js';
import type { History } from '../library/membership.js';
import type { Journal } from '../store/append.js';

export { ALREADY_THERE, NOT_FOUND };

export interface StationState {
  readonly station: Station;
  readonly library: Library;
  readonly categories: ReadonlyMap<CategoryCode, Category>;
  readonly clocks: ReadonlyMap<string, Clock>;
  readonly history: History;
}

export function emptyState(station: Station): StationState {
  return {
    station,
    library: makeLibrary([]),
    categories: new Map<CategoryCode, Category>(),
    clocks: new Map<string, Clock>(),
    history: EMPTY_HISTORY,
  };
}

export class StationService {
  constructor(
    private state: StationState,
    private readonly journal: Journal,
  ) {}

  current(): StationState {
    return this.state;
  }

  /** Add a cart, refusing one that is already there. */
  addCart(entry: LibraryEntry, at: number): Result<StationState, Problem[]> {
    const free = requireAbsent(
      lookup(this.state.library, entry.cart.number) !== undefined,
      entry.cart.number,
      'in the library',
    );
    if (!free.ok) {
      return err(free.error);
    }
    this.journal.append(
      'cart.added',
      { cart: entry.cart.number, category: entry.cart.category },
      at,
    );
    this.state = { ...this.state, library: withEntry(this.state.library, entry) };
    return ok(this.state);
  }

  /** Replace a cart that is already there, refusing one that is not. */
  updateCart(entry: LibraryEntry, at: number): Result<StationState, Problem[]> {
    const found = requirePresent(
      lookup(this.state.library, entry.cart.number),
      entry.cart.number,
      'in the library',
    );
    if (!found.ok) {
      return err(found.error);
    }
    this.journal.append('cart.updated', { cart: entry.cart.number }, at);
    this.state = { ...this.state, library: withEntry(this.state.library, entry) };
    return ok(this.state);
  }

  removeCart(cart: CartNumber, at: number): Result<StationState, Problem[]> {
    const found = requirePresent(lookup(this.state.library, cart), cart, 'in the library');
    if (!found.ok) {
      return err(found.error);
    }
    this.journal.append('cart.removed', { cart }, at);
    this.state = { ...this.state, library: withoutCart(this.state.library, cart) };
    return ok(this.state);
  }

  /** Card a cart into another category, recording the move in the history. */
  card(cart: CartNumber, to: CategoryCode, at: number, note?: string): Result<Carding, Problem[]> {
    const outcome = cardCart(this.state.library, this.state.categories, {
      cart,
      to,
      at,
      ...(note === undefined ? {} : { note }),
    });
    if (!outcome.ok) {
      return err(outcome.error);
    }
    this.journal.append('cart.carded', { cart, to, note: note ?? '' }, at);
    this.state = {
      ...this.state,
      library: outcome.value.library,
      history: withCarding(this.state.history, outcome.value.carding),
    };
    return ok(outcome.value.carding);
  }

  addCategory(category: Category, at: number): Result<StationState, Problem[]> {
    const free = requireAbsent(this.state.categories.has(category.code), category.code, 'defined');
    if (!free.ok) {
      return err(free.error);
    }
    const categories = new Map(this.state.categories);
    categories.set(category.code, category);
    this.journal.append('category.added', { code: category.code, name: category.name }, at);
    this.state = { ...this.state, categories };
    return ok(this.state);
  }

  addClock(clock: Clock, at: number): Result<StationState, Problem[]> {
    const free = requireAbsent(this.state.clocks.has(clock.name), clock.name, 'defined');
    if (!free.ok) {
      return err(free.error);
    }
    const clocks = new Map(this.state.clocks);
    clocks.set(clock.name, clock);
    this.journal.append('clock.added', { name: clock.name, elements: clock.elements.length }, at);
    this.state = { ...this.state, clocks };
    return ok(this.state);
  }

  /** Replace a clock, which changes every hour of the grid that runs it. */
  replaceClock(clock: Clock, at: number): Result<StationState, Problem[]> {
    const found = requirePresent(this.state.clocks.get(clock.name), clock.name, 'defined');
    if (!found.ok) {
      return err(found.error);
    }
    const clocks = new Map(this.state.clocks);
    clocks.set(clock.name, clock);
    this.journal.append('clock.replaced', { name: clock.name }, at);
    this.state = { ...this.state, clocks };
    return ok(this.state);
  }
}
