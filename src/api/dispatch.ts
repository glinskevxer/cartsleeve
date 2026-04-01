/**
 * Dispatch.
 *
 * A table of operation names to handlers, and the one place a request turns
 * into an answer. It is small on purpose. The only things it owns are the
 * things every operation needs to behave the same way about: parsing, an
 * unknown name, a handler that throws, and the order a batch runs in.
 *
 * A handler must not throw. It will anyway, one day, on a shape nobody thought
 * of, and the caller of an overnight batch is asleep. So a throw is caught here
 * and reported as a refusal with the operation named, which keeps the rest of
 * the batch running and leaves a record of which request it was.
 */

import { HANDLER_THREW, parseRequest, refuse, unknownOp } from './envelope.js';
import type { ApiRequest, ApiResponse } from './envelope.js';
import { error } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { compareText } from '../util/ordering.js';

export type Handler = (request: ApiRequest) => ApiResponse<unknown>;

export interface Route {
  readonly op: string;
  readonly handler: Handler;
  /** One line, printed by the help operation and by the command line. */
  readonly summary: string;
  /** True if the operation writes. Used by the read only guard. */
  readonly writes: boolean;
}

export interface BatchOptions {
  /** Stop after the first refusal. Off by default, because reads are cheap. */
  readonly stopOnRefusal?: boolean;
  /** Refuse every write before it runs. */
  readonly readOnly?: boolean;
}

export const READ_ONLY = 'API020';

/** The response for a request that would not parse, with no id to echo. */
export function malformed(problems: readonly Problem[]): ApiResponse<never> {
  return { ok: false, op: '', id: '', at: 0, problems };
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

export class Router {
  private readonly routes = new Map<string, Route>();

  constructor(routes: readonly Route[] = []) {
    for (const route of routes) {
      this.register(route);
    }
  }

  /** Registering a name twice is a programming error, not a request error. */
  register(route: Route): this {
    if (this.routes.has(route.op)) {
      throw new Error(`operation ${route.op} is already registered`);
    }
    this.routes.set(route.op, route);
    return this;
  }

  ops(): string[] {
    return [...this.routes.keys()].sort(compareText);
  }

  route(op: string): Route | undefined {
    return this.routes.get(op);
  }

  writes(op: string): boolean {
    return this.routes.get(op)?.writes ?? false;
  }

  /** Run one parsed request. The unparsed door is `handle`. */
  run(request: ApiRequest, options: BatchOptions = {}): ApiResponse<unknown> {
    const route = this.routes.get(request.op);
    if (route === undefined) {
      return unknownOp(request, this.ops());
    }
    if (options.readOnly === true && route.writes) {
      return refuse(request, [
        error(READ_ONLY, request.op, 'writes and this session is read only'),
      ]);
    }
    try {
      return route.handler(request);
    } catch (thrown: unknown) {
      return refuse(request, [
        error(HANDLER_THREW, request.op, 'failed and did not report why', {
          thrown: messageOf(thrown),
        }),
      ]);
    }
  }

  /** Parse and run. This is what a transport calls. */
  handle(raw: unknown, options: BatchOptions = {}): ApiResponse<unknown> {
    const parsed = parseRequest(raw);
    if (!parsed.ok) {
      return malformed(parsed.error);
    }
    return this.run(parsed.value, options);
  }

  /**
   * Run a batch in order. A refusal does not roll back what ran before it,
   * because the services write as they go and there is no transaction to undo.
   * The caller that needs all or nothing asks for `stopOnRefusal` and reads the
   * responses to find out how far it got.
   */
  handleBatch(raws: readonly unknown[], options: BatchOptions = {}): ApiResponse<unknown>[] {
    const responses: ApiResponse<unknown>[] = [];
    for (const raw of raws) {
      const response = this.handle(raw, options);
      responses.push(response);
      if (options.stopOnRefusal === true && !response.ok) {
        break;
      }
    }
    return responses;
  }
}

/** How far a batch got, for a caller that stopped early. */
export function completed(responses: readonly ApiResponse<unknown>[]): number {
  const failed = responses.findIndex((response) => !response.ok);
  return failed < 0 ? responses.length : failed;
}

/** The operations a router knows, with their summaries, for a help listing. */
export function describeRoutes(router: Router): { op: string; summary: string; writes: boolean }[] {
  return router.ops().map((op) => {
    const route = router.route(op);
    return { op, summary: route?.summary ?? '', writes: route?.writes ?? false };
  });
}
