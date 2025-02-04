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
import { codeFor, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { Result } from '../util/result.js';
import { Check, take } from '../util/check.js';
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
  const check = new Check();
  const number = check.require(
    parseCartNumber(input.number),
    CART(20),
    input.number,
    (problem) => problem.reason,
  );
  const title = input.title.trim();
  check.ensure(title.length > 0, CART(21), input.number, 'has no title');
  const runtime = check.require(
    parseDuration(input.runtime),
    CART(22),
    input.number,
    (problem) => `runtime ${problem.reason}`,
  );
  const music = number === undefined ? false : isMusicCart(number);
  const billed = (input.billed ?? '').trim();
  check.ensure(
    !music || billed.length > 0,
    CART(23),
    input.number,
    'is a music cart with no artist',
  );
  const category = check.require(
    parseCategoryCode(input.category ?? (music ? 'A' : 'X')),
    CART(24),
    input.number,
    (problem) => problem.reason,
  );
  const intro =
    input.intro === undefined
      ? DEFAULT_TIMING.intro
      : check.require(
          parseDuration(input.intro),
          CART(29),
          input.number,
          (problem) => `intro ${problem.reason}`,
        );
  const tail =
    input.tail === undefined
      ? DEFAULT_TIMING.tail
      : check.require(
          parseDuration(input.tail),
          CART(30),
          input.number,
          (problem) => `tail ${problem.reason}`,
        );
  const endType = input.endType === undefined ? 'cold' : parseEndType(input.endType);
  check.ensure(
    endType !== undefined,
    CART(31),
    input.number,
    'has an end type that is not cold, fade or sustain',
  );
  return check.result(() => ({
    number: take(number, 'number'),
    title,
    billed,
    credits: parseCredits(billed),
    runtime: take(runtime, 'runtime'),
    category: take(category, 'category'),
    music,
    timing: {
      intro: take(intro, 'intro'),
      endType: take(endType, 'endType'),
      tail: take(tail, 'tail'),
    },
  }));
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
