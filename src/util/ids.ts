/**
 * Identifiers as they are actually written on a rack card and typed into an
 * automation system. They are short, they are case insensitive in practice, and
 * operators transpose them, so every one of them parses through a check that
 * says what went wrong rather than returning undefined.
 */

import { err, ok } from './result.js';
import type { Result } from './result.js';

export type CartNumber = string & { readonly __brand: 'CartNumber' };
export type CallSign = string & { readonly __brand: 'CallSign' };
export type CategoryCode = string & { readonly __brand: 'CategoryCode' };
export type Isrc = string & { readonly __brand: 'Isrc' };

export interface IdProblem {
  readonly field: string;
  readonly given: string;
  readonly reason: string;
}

function problem(field: string, given: string, reason: string): IdProblem {
  return { field, given, reason };
}

/**
 * A cart number is a family letter and four digits. The family letter says what
 * kind of thing it is, and the scheduler leans on that rather than on a
 * separate type column, because the legacy exports only carry the number.
 */
const CART_PATTERN = /^([A-Z])(\d{4})$/;

export const CART_FAMILIES: Record<string, string> = {
  M: 'music',
  C: 'commercial',
  J: 'jingle',
  S: 'sweeper',
  P: 'promo',
  N: 'news',
  T: 'traffic report',
};

export function parseCartNumber(raw: string): Result<CartNumber, IdProblem> {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length === 0) {
    return err(problem('cart', raw, 'is empty'));
  }
  const match = CART_PATTERN.exec(trimmed);
  if (match === null) {
    return err(problem('cart', raw, 'is not a family letter and four digits'));
  }
  const family = match[1] ?? '';
  if (!(family in CART_FAMILIES)) {
    return err(problem('cart', raw, `has an unknown family letter ${family}`));
  }
  return ok(trimmed as CartNumber);
}

export function cartFamily(cart: CartNumber): string {
  return cart.slice(0, 1);
}

export function isMusicCart(cart: CartNumber): boolean {
  return cartFamily(cart) === 'M';
}

export function cartSequence(cart: CartNumber): number {
  return Number.parseInt(cart.slice(1), 10);
}

/** Call signs west of the Mississippi start with K and east of it with W. */
const CALL_PATTERN = /^[KW][A-Z]{2,3}$/;

export function parseCallSign(raw: string): Result<CallSign, IdProblem> {
  const trimmed = raw
    .trim()
    .toUpperCase()
    .replace(/-FM$|-AM$/, '');
  if (!CALL_PATTERN.test(trimmed)) {
    return err(problem('callSign', raw, 'is not three or four letters starting K or W'));
  }
  return ok(trimmed as CallSign);
}

/**
 * A category code is a letter and an optional digit. A is the heaviest current
 * rotation, G is gold, and the digit splits a category into subcategories that
 * rotate on their own clocks.
 */
const CATEGORY_PATTERN = /^([A-Z])(\d?)$/;

export function parseCategoryCode(raw: string): Result<CategoryCode, IdProblem> {
  const trimmed = raw.trim().toUpperCase();
  if (!CATEGORY_PATTERN.test(trimmed)) {
    return err(problem('category', raw, 'is not a letter and an optional digit'));
  }
  return ok(trimmed as CategoryCode);
}

export function categoryFamily(code: CategoryCode): string {
  return code.slice(0, 1);
}

export function isSubcategory(code: CategoryCode): boolean {
  return code.length === 2;
}

/**
 * An ISRC is a country code, a registrant, the year of reference and a
 * designation. Royalty reporting is keyed on it, and a missing or malformed one
 * is the single most common reason a performance report is rejected on filing.
 */
const ISRC_PATTERN = /^([A-Z]{2})([A-Z0-9]{3})(\d{2})(\d{5})$/;

export function parseIsrc(raw: string): Result<Isrc, IdProblem> {
  const trimmed = raw.trim().toUpperCase().replace(/-/g, '');
  if (trimmed.length === 0) {
    return err(problem('isrc', raw, 'is empty'));
  }
  if (!ISRC_PATTERN.test(trimmed)) {
    return err(problem('isrc', raw, 'is not a twelve character ISRC'));
  }
  return ok(trimmed as Isrc);
}

export interface IsrcParts {
  readonly country: string;
  readonly registrant: string;
  readonly year: number;
  readonly designation: string;
}

export function isrcParts(isrc: Isrc): IsrcParts {
  const match = ISRC_PATTERN.exec(isrc);
  const country = match?.[1] ?? '';
  const registrant = match?.[2] ?? '';
  const yearDigits = match?.[3] ?? '00';
  const designation = match?.[4] ?? '';
  const twoDigit = Number.parseInt(yearDigits, 10);
  return {
    country,
    registrant,
    year: twoDigit >= 40 ? 1900 + twoDigit : 2000 + twoDigit,
    designation,
  };
}

/** The hyphenated form, which is what the filing format wants on the wire. */
export function formatIsrc(isrc: Isrc): string {
  const parts = ISRC_PATTERN.exec(isrc);
  if (parts === null) {
    return isrc;
  }
  return `${parts[1] ?? ''}-${parts[2] ?? ''}-${parts[3] ?? ''}-${parts[4] ?? ''}`;
}
