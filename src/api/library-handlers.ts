/**
 * Library operations over the envelope.
 *
 * The schemas do the parsing and the building, so each handler is the one thing
 * it is actually about: call the service, say what happened. The order that
 * used to be kept by care is now kept by construction, because a cart that will
 * not build never reaches the handler, and the journal is only ever touched
 * from inside one.
 */

import { z } from 'zod';
import { refuse, succeed } from './envelope.js';
import type { Route } from './dispatch.js';
import { answering, built, defined, idField, route } from './handler.js';
import { error } from '../util/problem.js';
import { NOT_FOUND } from '../service/guard.js';
import { parseCartNumber, parseCategoryCode } from '../util/ids.js';
import { makeCart } from '../domain/cart.js';
import { makeCategory } from '../domain/category.js';
import { makeRecording } from '../domain/recording.js';
import { inCategory, lookup } from '../library/library.js';
import type { LibraryEntry } from '../library/library.js';
import type { StationService } from '../service/station-service.js';

const cartNumber = idField(parseCartNumber);
const categoryCode = idField(parseCategoryCode);

const cartSchema = z.object({
  number: z.string(),
  title: z.string(),
  billed: z.string().optional(),
  runtime: z.string(),
  category: z.string().optional(),
  intro: z.string().optional(),
  endType: z.string().optional(),
  tail: z.string().optional(),
});

const recordingSchema = z.object({
  isrc: z.string(),
  title: z.string(),
  label: z.string(),
  payee: z.string().optional(),
  releaseYear: z.number().int(),
});

const categorySchema = z.object({
  code: z.string(),
  name: z.string(),
  packets: z.number().int().optional(),
  music: z.boolean().optional(),
  artistMinutes: z.number().optional(),
  titleMinutes: z.number().optional(),
  recordingMinutes: z.number().optional(),
  soundMinutes: z.number().optional(),
  priority: z.number().optional(),
});

/**
 * A release year only means anything against a clock, and the clock that counts
 * is the caller's rather than ours, so this schema is built per request. It is
 * the one place in the api where that is true.
 */
interface EntryParams {
  readonly cart: LibraryEntry['cart'];
  readonly recording?: LibraryEntry['recording'];
}

function entrySchema(at: number): z.ZodType<EntryParams, z.ZodTypeDef, unknown> {
  const year = new Date(at).getUTCFullYear();
  return z.object({
    cart: built(cartSchema, (input) => makeCart(defined(input))),
    recording: built(recordingSchema, (input) => makeRecording(defined(input), year)).optional(),
  });
}

function entryOf(parsed: EntryParams): LibraryEntry {
  return parsed.recording === undefined
    ? { cart: parsed.cart }
    : { cart: parsed.cart, recording: parsed.recording };
}

function describeEntry(entry: LibraryEntry): Record<string, unknown> {
  return {
    cart: entry.cart.number,
    title: entry.cart.title,
    billed: entry.cart.billed,
    category: entry.cart.category,
    runtime: entry.cart.runtime,
    isrc: entry.recording?.isrc ?? '',
  };
}

export function libraryRoutes(service: StationService): Route[] {
  return [
    route({
      op: 'library.add',
      summary: 'add a cart, and its recording if it has one',
      writes: true,
      params: (request) => entrySchema(request.at),
      answer: (params, request) => {
        const entry = entryOf(params);
        return answering(request, service.addCart(entry, request.at), () => ({
          cart: entry.cart.number,
        }));
      },
    }),
    route({
      op: 'library.update',
      summary: 'replace a cart that is already there',
      writes: true,
      params: (request) => entrySchema(request.at),
      answer: (params, request) => {
        const entry = entryOf(params);
        return answering(request, service.updateCart(entry, request.at), () => ({
          cart: entry.cart.number,
        }));
      },
    }),
    route({
      op: 'library.remove',
      summary: 'take a cart out of the library',
      writes: true,
      params: z.object({ cart: cartNumber }),
      answer: (params, request) =>
        answering(request, service.removeCart(params.cart, request.at), () => ({
          cart: params.cart,
        })),
    }),
    route({
      op: 'library.card',
      summary: 'move a cart into another category',
      writes: true,
      params: z.object({ cart: cartNumber, to: categoryCode, note: z.string().optional() }),
      answer: (params, request) =>
        answering(
          request,
          service.card(params.cart, params.to, request.at, params.note),
          (carding) => carding,
        ),
    }),
    route({
      op: 'library.get',
      summary: 'read one cart',
      writes: false,
      params: z.object({ cart: cartNumber }),
      answer: (params, request) => {
        const entry = lookup(service.current().library, params.cart);
        return entry === undefined
          ? refuse(request, [error(NOT_FOUND, params.cart, 'is not in the library')])
          : succeed(request, describeEntry(entry));
      },
    }),
    route({
      op: 'library.count',
      summary: 'count the carts, by category if one is named',
      writes: false,
      params: z.object({ category: categoryCode.optional() }),
      answer: (params, request) =>
        succeed(request, {
          carts:
            params.category === undefined
              ? service.current().library.entries.length
              : inCategory(service.current().library, params.category).length,
        }),
    }),
    route({
      op: 'category.add',
      summary: 'define a rotation category',
      writes: true,
      params: built(categorySchema, (input) => makeCategory(defined(input))),
      answer: (category, request) =>
        answering(request, service.addCategory(category, request.at), () => ({
          code: category.code,
        })),
    }),
  ];
}
