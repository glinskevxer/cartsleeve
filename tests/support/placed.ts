import type { Placed } from '../../src/rules/rule.js';
import { tenths } from '../../src/util/duration.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { cellOf } from '../../src/domain/daypart.js';
import { entry } from './fixtures.js';
import type { EntrySpec } from './fixtures.js';

export interface PlacedSpec extends EntrySpec {
  readonly position: number;
  /** Start time in tenths from the beginning of the broadcast day. */
  readonly at: number;
  readonly hour?: number;
  readonly day?: number;
}

/** Build a placed item, reusing the library fixture builder for the entry. */
export function placed(spec: PlacedSpec): Placed {
  const { position, at, hour = 7, day = 1, ...entrySpec } = spec;
  const built = entry(entrySpec);
  return {
    cart: built.cart.number,
    entry: built,
    position,
    at: tenths(at),
    category: built.cart.category,
    cell: cellOf(day, hour),
  };
}

export const cartNo = (value: string): CartNumber => value as CartNumber;
export const catCode = (value: string): CategoryCode => value as CategoryCode;
