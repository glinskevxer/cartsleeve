/**
 * Library operations over the envelope.
 *
 * Each handler does the same four things in the same order: read the params,
 * build the domain value, call the service, wrap the answer. The order matters
 * and it is the reason the handlers are not thinner. A cart that will not build
 * must be refused before the service is asked, because the service appends to
 * the journal and a journal is not something you take back.
 *
 * Params are read with a schema rather than by hand because this is the only
 * place in cartsleeve where the input is genuinely unknown. Everything below
 * here has been through a parser and carries a type that says so.
 */

import { z } from 'zod';
import { BAD_PARAMS, fromResult, refuse, succeed } from './envelope.js';
import type { ApiRequest, ApiResponse } from './envelope.js';
import type { Route } from './dispatch.js';
import { error } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { parseCartNumber, parseCategoryCode } from '../util/ids.js';
import { makeCart } from '../domain/cart.js';
import { makeCategory } from '../domain/category.js';
import { makeRecording } from '../domain/recording.js';
import { inCategory, lookup } from '../library/library.js';
import type { LibraryEntry } from '../library/library.js';
import type { StationService } from '../service/station-service.js';
import { NOT_FOUND } from '../service/guard.js';

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

const addSchema = z.object({
  cart: cartSchema,
  recording: recordingSchema.optional(),
});

const cartNumberSchema = z.object({ cart: z.string() });

const countSchema = z.object({ category: z.string().optional() });

const cardSchema = z.object({
  cart: z.string(),
  to: z.string(),
  note: z.string().optional(),
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
 * A schema that allows a field to be missing gives back an object with the key
 * present and the value undefined, and the domain builders are compiled with
 * exact optional properties, which is not the same thing. Dropping the empty
 * keys is the whole difference between "the caller said nothing" and "the
 * caller said nothing on purpose", and the builders read the first one.
 */
type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

function defined<T extends Record<string, unknown>>(value: T): Defined<T> {
  const kept: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      kept[key] = item;
    }
  }
  return kept as Defined<T>;
}

function paramProblems(issues: readonly z.ZodIssue[]): Problem[] {
  return issues.map((issue) =>
    error(BAD_PARAMS, issue.path.length === 0 ? 'params' : issue.path.join('.'), issue.message),
  );
}

/**
 * Build the library entry a request describes, or the reasons it does not. The
 * release year is checked against the caller's clock rather than ours, so a
 * batch replayed from last year's journal reads the same as it did then.
 */
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

function entryFromParams(
  input: z.infer<typeof addSchema>,
  at: number,
): { ok: true; value: LibraryEntry } | { ok: false; error: Problem[] } {
  const cart = makeCart(defined(input.cart));
  if (!cart.ok) {
    return { ok: false, error: cart.error };
  }
  if (input.recording === undefined) {
    return { ok: true, value: { cart: cart.value } };
  }
  const recording = makeRecording(defined(input.recording), new Date(at).getUTCFullYear());
  if (!recording.ok) {
    return { ok: false, error: recording.error };
  }
  return { ok: true, value: { cart: cart.value, recording: recording.value } };
}

export function libraryRoutes(service: StationService): Route[] {
  return [
    {
      op: 'library.add',
      summary: 'add a cart, and its recording if it has one',
      writes: true,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = addSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const entry = entryFromParams(params.data, request.at);
        if (!entry.ok) {
          return refuse(request, entry.error);
        }
        const added = service.addCart(entry.value, request.at);
        return added.ok
          ? succeed(request, { cart: entry.value.cart.number })
          : refuse(request, added.error);
      },
    },
    {
      op: 'library.update',
      summary: 'replace a cart that is already there',
      writes: true,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = addSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const entry = entryFromParams(params.data, request.at);
        if (!entry.ok) {
          return refuse(request, entry.error);
        }
        const updated = service.updateCart(entry.value, request.at);
        return updated.ok
          ? succeed(request, { cart: entry.value.cart.number })
          : refuse(request, updated.error);
      },
    },
    {
      op: 'library.remove',
      summary: 'take a cart out of the library',
      writes: true,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = cartNumberSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const number = parseCartNumber(params.data.cart);
        if (!number.ok) {
          return refuse(request, [error(BAD_PARAMS, 'cart', number.error.reason)]);
        }
        const removed = service.removeCart(number.value, request.at);
        return removed.ok
          ? succeed(request, { cart: number.value })
          : refuse(request, removed.error);
      },
    },
    {
      op: 'library.card',
      summary: 'move a cart into another category',
      writes: true,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = cardSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const number = parseCartNumber(params.data.cart);
        if (!number.ok) {
          return refuse(request, [error(BAD_PARAMS, 'cart', number.error.reason)]);
        }
        const to = parseCategoryCode(params.data.to);
        if (!to.ok) {
          return refuse(request, [error(BAD_PARAMS, 'to', to.error.reason)]);
        }
        return fromResult(
          request,
          service.card(number.value, to.value, request.at, params.data.note),
        );
      },
    },
    {
      op: 'library.get',
      summary: 'read one cart',
      writes: false,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = cartNumberSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const number = parseCartNumber(params.data.cart);
        if (!number.ok) {
          return refuse(request, [error(BAD_PARAMS, 'cart', number.error.reason)]);
        }
        const entry = lookup(service.current().library, number.value);
        if (entry === undefined) {
          return refuse(request, [error(NOT_FOUND, number.value, 'is not in the library')]);
        }
        return succeed(request, describeEntry(entry));
      },
    },
    {
      op: 'library.count',
      summary: 'count the carts, by category if one is named',
      writes: false,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = countSchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const library = service.current().library;
        if (params.data.category === undefined) {
          return succeed(request, { carts: library.entries.length });
        }
        const code = parseCategoryCode(params.data.category);
        if (!code.ok) {
          return refuse(request, [error(BAD_PARAMS, 'category', code.error.reason)]);
        }
        return succeed(request, { carts: inCategory(library, code.value).length });
      },
    },
    {
      op: 'category.add',
      summary: 'define a rotation category',
      writes: true,
      handler: (request: ApiRequest): ApiResponse<unknown> => {
        const params = categorySchema.safeParse(request.params);
        if (!params.success) {
          return refuse(request, paramProblems(params.error.issues));
        }
        const category = makeCategory(defined(params.data));
        if (!category.ok) {
          return refuse(request, category.error);
        }
        const added = service.addCategory(category.value, request.at);
        return added.ok
          ? succeed(request, { code: category.value.code })
          : refuse(request, added.error);
      },
    },
  ];
}
