/**
 * The library.
 *
 * Every cart the station owns, indexed the four ways the scheduler asks for
 * them: by number, by category, by artist and by recording. The indexes are
 * built once and shared, because a rule that walks the whole library for every
 * candidate at every slot turns a day pass into minutes.
 *
 * A cart and its recording are joined here rather than on the cart, so that one
 * recording can sit behind two carts without either of them owning it. That is
 * the join the recording separation rule needs and the cart number cannot give.
 */

import type { CartNumber, CategoryCode, Isrc } from '../util/ids.js';
import { groupBy } from '../util/ordering.js';
import type { Cart } from '../domain/cart.js';
import { separationKeys } from '../domain/artist.js';
import type { CreditPolicy } from '../domain/station.js';
import type { Recording } from '../domain/recording.js';
import type { Attributes } from './attributes.js';

export interface LibraryEntry {
  readonly cart: Cart;
  /** Absent on carts that are not music, and on music nobody has coded yet. */
  readonly recording?: Recording;
  /** Absent until somebody codes the cart by ear. */
  readonly attributes?: Attributes;
}

export interface Library {
  readonly entries: readonly LibraryEntry[];
  readonly byNumber: ReadonlyMap<CartNumber, LibraryEntry>;
  readonly byCategory: ReadonlyMap<CategoryCode, readonly LibraryEntry[]>;
  readonly byIsrc: ReadonlyMap<Isrc, readonly LibraryEntry[]>;
  readonly byTitleKey: ReadonlyMap<string, readonly LibraryEntry[]>;
}

export function makeLibrary(entries: readonly LibraryEntry[]): Library {
  const byNumber = new Map<CartNumber, LibraryEntry>();
  const byIsrc = new Map<Isrc, LibraryEntry[]>();
  const byTitleKey = new Map<string, LibraryEntry[]>();
  for (const entry of entries) {
    byNumber.set(entry.cart.number, entry);
    const recording = entry.recording;
    if (recording === undefined) {
      continue;
    }
    const sameMaster = byIsrc.get(recording.isrc);
    if (sameMaster === undefined) {
      byIsrc.set(recording.isrc, [entry]);
    } else {
      sameMaster.push(entry);
    }
    const sameTitle = byTitleKey.get(recording.titleKey);
    if (sameTitle === undefined) {
      byTitleKey.set(recording.titleKey, [entry]);
    } else {
      sameTitle.push(entry);
    }
  }
  return {
    entries,
    byNumber,
    byCategory: groupBy(entries, (entry) => entry.cart.category),
    byIsrc,
    byTitleKey,
  };
}

export function lookup(library: Library, number: CartNumber): LibraryEntry | undefined {
  return library.byNumber.get(number);
}

export function inCategory(library: Library, category: CategoryCode): readonly LibraryEntry[] {
  return library.byCategory.get(category) ?? [];
}

export function size(library: Library): number {
  return library.entries.length;
}

export function musicSize(library: Library): number {
  return library.entries.filter((entry) => entry.cart.music).length;
}

/** Every cart that shares this master, which is what a second carding creates. */
export function sameRecording(library: Library, isrc: Isrc): readonly LibraryEntry[] {
  return library.byIsrc.get(isrc) ?? [];
}

/** Every cart of this title, originals and covers alike. */
export function sameTitle(library: Library, titleKey: string): readonly LibraryEntry[] {
  return library.byTitleKey.get(titleKey) ?? [];
}

/**
 * Carts whose separation keys include this artist, under the given policy.
 * Under `billed` a guest appearance is invisible here, and under `strict` it is
 * not, which is exactly the difference the policy exists to make.
 */
export function byArtist(
  library: Library,
  key: string,
  policy: CreditPolicy,
): readonly LibraryEntry[] {
  return library.entries.filter((entry) =>
    separationKeys(entry.cart.credits, policy).includes(key),
  );
}

/** Masters carded more than once. Harmless, but the rules have to know. */
export function doubleCarded(library: Library): readonly (readonly LibraryEntry[])[] {
  const out: (readonly LibraryEntry[])[] = [];
  for (const group of library.byIsrc.values()) {
    if (group.length > 1) {
      out.push(group);
    }
  }
  return out;
}

export function withEntry(library: Library, entry: LibraryEntry): Library {
  const without = library.entries.filter((each) => each.cart.number !== entry.cart.number);
  return makeLibrary([...without, entry]);
}

export function withoutCart(library: Library, number: CartNumber): Library {
  return makeLibrary(library.entries.filter((entry) => entry.cart.number !== number));
}
