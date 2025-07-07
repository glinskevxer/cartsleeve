import { makeCart } from '../../src/domain/cart.js';
import type { Cart, CartInput } from '../../src/domain/cart.js';
import { makeRecording } from '../../src/domain/recording.js';
import type { Recording } from '../../src/domain/recording.js';
import { makeStation } from '../../src/domain/station.js';
import type { Station, StationInput } from '../../src/domain/station.js';
import { makeAttributes } from '../../src/library/attributes.js';
import { makeLibrary } from '../../src/library/library.js';
import type { Library, LibraryEntry } from '../../src/library/library.js';
import { expectOk } from './result.js';

export const FIXTURE_YEAR = 2025;

let sequence = 0;

/** A fresh cart number each call, so a fixture never collides by accident. */
export function nextCartNumber(family = 'M'): string {
  sequence += 1;
  return `${family}${String(sequence % 10_000).padStart(4, '0')}`;
}

export function resetFixtures(): void {
  sequence = 0;
}

export function cart(overrides: Partial<CartInput> = {}): Cart {
  return expectOk(
    makeCart({
      number: nextCartNumber(),
      title: 'Untitled',
      billed: 'A Test Artist',
      runtime: '3:30',
      ...overrides,
    }),
  );
}

export function recording(overrides: Partial<Parameters<typeof makeRecording>[0]> = {}): Recording {
  sequence += 1;
  return expectOk(
    makeRecording(
      {
        isrc: `USTST${String(FIXTURE_YEAR).slice(2)}${String(sequence % 100_000).padStart(5, '0')}`,
        title: 'Untitled',
        label: 'Test Records',
        releaseYear: 2001,
        ...overrides,
      },
      FIXTURE_YEAR,
    ),
  );
}

export interface EntrySpec extends Partial<CartInput> {
  readonly isrc?: string;
  readonly releaseYear?: number;
  readonly label?: string;
  readonly recordingTitle?: string;
  readonly noRecording?: boolean;
  /** Coded attributes. Any of these present gives the entry an attribute block. */
  readonly tempo?: string;
  readonly mood?: string;
  readonly texture?: string;
  readonly sounds?: readonly string[];
}

export function entry(spec: EntrySpec = {}): LibraryEntry {
  const {
    isrc,
    releaseYear,
    label,
    recordingTitle,
    noRecording = false,
    tempo,
    mood,
    texture,
    sounds,
    ...cartInput
  } = spec;
  const built = cart(cartInput);
  const anyCoded =
    tempo !== undefined || mood !== undefined || texture !== undefined || sounds !== undefined;
  const coded = anyCoded
    ? {
        attributes: expectOk(
          makeAttributes(built.number, {
            ...(tempo === undefined ? {} : { tempo }),
            ...(mood === undefined ? {} : { mood }),
            ...(texture === undefined ? {} : { texture }),
            ...(sounds === undefined ? {} : { sounds }),
          }),
        ),
      }
    : {};
  if (noRecording) {
    return { cart: built, ...coded };
  }
  return {
    cart: built,
    recording: recording({
      ...(isrc === undefined ? {} : { isrc }),
      ...(releaseYear === undefined ? {} : { releaseYear }),
      ...(label === undefined ? {} : { label }),
      title: recordingTitle ?? built.title,
    }),
    ...coded,
  };
}

export function library(specs: readonly EntrySpec[]): Library {
  return makeLibrary(specs.map((spec) => entry(spec)));
}

export function station(overrides: Partial<StationInput> = {}): Station {
  return expectOk(
    makeStation({
      callSign: 'KHRT',
      name: 'Heart Country',
      format: 'country',
      dayStartHour: 5,
      ...overrides,
    }),
  );
}
