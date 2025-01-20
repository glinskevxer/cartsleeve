/**
 * A cart.
 *
 * The name is older than the system. A cart was a tape cartridge on a rack, and
 * a cart is still the unit the automation fires: one playable item with a
 * number, a runtime and a place in the log. Music carts rotate. Jingles,
 * sweepers, promos and commercials do not, but they take time in the hour and
 * so they move every music decision after them.
 */

import { cartFamily, isMusicCart, parseCartNumber } from '../util/ids.js';
import type { CartNumber, CategoryCode } from '../util/ids.js';
import { parseCategoryCode } from '../util/ids.js';
import { parseDuration } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';
import { formatCredits, parseCredits } from './artist.js';
import type { Credit } from './artist.js';
import { DEFAULT_TIMING, auditTiming, parseEndType } from './segue.js';
import type { Timing } from './segue.js';

export interface Cart {
  readonly number: CartNumber;
  readonly title: string;
  readonly billed: string;
  readonly credits: readonly Credit[];
  readonly runtime: Tenths;
  readonly category: CategoryCode;
  readonly music: boolean;
  readonly timing: Timing;
}

export interface CartInput {
  readonly number: string;
  readonly title: string;
  readonly billed?: string;
  readonly runtime: string;
  readonly category?: string;
  readonly intro?: string;
  readonly endType?: string;
  readonly tail?: string;
}

const CART = (n: number): string => codeFor('library', n);

/** The shortest and longest a music cart can plausibly be, in tenths. */
export const MIN_MUSIC_RUNTIME = 300;
export const MAX_MUSIC_RUNTIME = 9000;

export function makeCart(input: CartInput): Result<Cart, Problem[]> {
  const problems: Problem[] = [];
  const number = parseCartNumber(input.number);
  if (!number.ok) {
    problems.push(error(CART(20), input.number, number.error.reason));
  }
  const title = input.title.trim();
  if (title.length === 0) {
    problems.push(error(CART(21), input.number, 'has no title'));
  }
  const runtime = parseDuration(input.runtime);
  if (!runtime.ok) {
    problems.push(error(CART(22), input.number, `runtime ${runtime.error.reason}`));
  }
  const music = number.ok ? isMusicCart(number.value) : false;
  const billed = (input.billed ?? '').trim();
  if (music && billed.length === 0) {
    problems.push(error(CART(23), input.number, 'is a music cart with no artist'));
  }
  const intro = input.intro === undefined ? ok(DEFAULT_TIMING.intro) : parseDuration(input.intro);
  if (!intro.ok) {
    problems.push(error(CART(29), input.number, `intro ${intro.error.reason}`));
  }
  const tail = input.tail === undefined ? ok(DEFAULT_TIMING.tail) : parseDuration(input.tail);
  if (!tail.ok) {
    problems.push(error(CART(30), input.number, `tail ${tail.error.reason}`));
  }
  const endType = input.endType === undefined ? 'cold' : parseEndType(input.endType);
  if (endType === undefined) {
    problems.push(
      error(CART(31), input.number, 'has an end type that is not cold, fade or sustain'),
    );
  }
  const categoryText = input.category ?? (music ? 'A' : 'X');
  const category = parseCategoryCode(categoryText);
  if (!category.ok) {
    problems.push(error(CART(24), input.number, category.error.reason));
  }
  if (
    !number.ok ||
    !runtime.ok ||
    !category.ok ||
    !intro.ok ||
    !tail.ok ||
    endType === undefined ||
    problems.length > 0
  ) {
    return err(problems);
  }
  return ok({
    number: number.value,
    title,
    billed,
    credits: parseCredits(billed),
    runtime: runtime.value,
    category: category.value,
    music,
    timing: { intro: intro.value, endType, tail: tail.value },
  });
}

/**
 * Findings that do not stop a cart being scheduled but a programme director
 * wants to see. A four second music cart is a bad import, not a song, and a
 * twelve minute one will not fit any clock element it is coded for.
 */
export function auditCart(cart: Cart): Problem[] {
  const problems: Problem[] = [];
  if (cart.music && cart.runtime < MIN_MUSIC_RUNTIME) {
    problems.push(
      warning(CART(25), cart.number, 'is shorter than any real music cart', {
        tenths: cart.runtime,
      }),
    );
  }
  if (cart.music && cart.runtime > MAX_MUSIC_RUNTIME) {
    problems.push(
      warning(CART(26), cart.number, 'is longer than any clock element allows', {
        tenths: cart.runtime,
      }),
    );
  }
  if (cart.music && cart.credits.length === 0) {
    problems.push(warning(CART(27), cart.number, 'has an artist that parsed to nothing'));
  }
  problems.push(...auditTiming(cart.number, cart.runtime, cart.timing));
  if (!cart.music && cart.category !== 'X') {
    problems.push(
      warning(CART(28), cart.number, 'is not music but is carded into a rotating category', {
        category: cart.category,
      }),
    );
  }
  return problems;
}

export function familyOf(cart: Cart): string {
  return cartFamily(cart.number);
}

export function describeCart(cart: Cart): string {
  const artist = formatCredits(cart.credits);
  return artist.length === 0
    ? `${cart.number} ${cart.title}`
    : `${cart.number} ${cart.title} / ${artist}`;
}
