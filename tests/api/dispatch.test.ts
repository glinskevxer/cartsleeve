import { describe, expect, it } from 'vitest';
import { READ_ONLY, Router, completed, describeRoutes, malformed } from '../../src/api/dispatch.js';
import type { Route } from '../../src/api/dispatch.js';
import { HANDLER_THREW, MALFORMED, UNKNOWN_OP, refuse, succeed } from '../../src/api/envelope.js';
import type { ApiRequest } from '../../src/api/envelope.js';
import { error } from '../../src/util/problem.js';

function request(op: string, id = 'r1', params: Record<string, unknown> = {}): ApiRequest {
  return { op, id, at: 1_000, params };
}

function raw(op: string, id = 'r1'): unknown {
  return { op, id, at: 1_000, params: {} };
}

const echo: Route = {
  op: 'station.state',
  handler: (input) => succeed(input, { seen: input.id }),
  summary: 'read the current state',
  writes: false,
};

const write: Route = {
  op: 'library.add',
  handler: (input) => succeed(input, { added: input.params['cart'] }),
  summary: 'add a cart',
  writes: true,
};

const sulk: Route = {
  op: 'library.remove',
  handler: (input) => refuse(input, [error('LIB030', String(input.params['cart']), 'is missing')]),
  summary: 'remove a cart',
  writes: true,
};

const blows: Route = {
  op: 'schedule.day',
  handler: () => {
    throw new Error('slot table was undefined');
  },
  summary: 'schedule a day',
  writes: true,
};

function router(): Router {
  return new Router([echo, write, sulk, blows]);
}

describe('Router.register', () => {
  it('keeps the operations it was given', () => {
    expect(router().ops()).toEqual([
      'library.add',
      'library.remove',
      'schedule.day',
      'station.state',
    ]);
  });

  it('refuses to register the same name twice', () => {
    expect(() => router().register(echo)).toThrow(/already registered/);
  });

  it('knows which operations write', () => {
    expect(router().writes('library.add')).toBe(true);
    expect(router().writes('station.state')).toBe(false);
  });

  it('says an operation it has never heard of does not write', () => {
    expect(router().writes('nothing.here')).toBe(false);
  });
});

describe('Router.handle', () => {
  it('runs the handler registered under the name', () => {
    const response = router().handle(raw('station.state', 'r9'));
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ seen: 'r9' });
    expect(response.id).toBe('r9');
  });

  it('refuses a name it does not know', () => {
    const response = router().handle(raw('station.stat'));
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.code).toBe(UNKNOWN_OP);
    expect(response.problems[0]?.message).toContain('station.state');
  });

  it('refuses an envelope that will not parse, with no id to echo', () => {
    const response = router().handle({ op: 'station.state' });
    expect(response.ok).toBe(false);
    expect(response.id).toBe('');
    expect(response.problems.every((item) => item.code === MALFORMED)).toBe(true);
  });

  it('catches a handler that throws and names the operation', () => {
    const response = router().handle(raw('schedule.day'));
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.code).toBe(HANDLER_THREW);
    expect(response.problems[0]?.subject).toBe('schedule.day');
    expect(response.problems[0]?.detail?.['thrown']).toBe('slot table was undefined');
  });

  it('catches a handler that throws something that is not an error', () => {
    const odd = new Router([
      {
        op: 'odd',
        handler: () => {
          // The point of the test is the code that does not use Error.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'a bare string';
        },
        summary: 'throws badly',
        writes: false,
      },
    ]);
    const response = odd.handle(raw('odd'));
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.detail?.['thrown']).toBe('a bare string');
  });

  it('passes a handler refusal through untouched', () => {
    const response = router().handle({
      op: 'library.remove',
      id: 'r1',
      at: 1,
      params: { cart: 'M0404' },
    });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.code).toBe('LIB030');
    expect(response.problems[0]?.subject).toBe('M0404');
  });
});

describe('read only', () => {
  it('lets a read through', () => {
    expect(router().handle(raw('station.state'), { readOnly: true }).ok).toBe(true);
  });

  it('refuses a write before the handler runs', () => {
    const response = router().handle(raw('library.add'), { readOnly: true });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.code).toBe(READ_ONLY);
  });

  it('refuses the write that throws without letting it throw', () => {
    const response = router().handle(raw('schedule.day'), { readOnly: true });
    expect(response.problems[0]?.code).toBe(READ_ONLY);
  });
});

describe('Router.handleBatch', () => {
  it('answers every request in order', () => {
    const responses = router().handleBatch([
      raw('station.state', 'a'),
      raw('library.add', 'b'),
      raw('station.state', 'c'),
    ]);
    expect(responses.map((response) => response.id)).toEqual(['a', 'b', 'c']);
    expect(responses.every((response) => response.ok)).toBe(true);
  });

  it('keeps going past a refusal by default', () => {
    const responses = router().handleBatch([
      raw('station.state', 'a'),
      raw('schedule.day', 'b'),
      raw('station.state', 'c'),
    ]);
    expect(responses).toHaveLength(3);
    expect(responses[2]?.ok).toBe(true);
  });

  it('stops at the first refusal when asked to', () => {
    const responses = router().handleBatch(
      [raw('station.state', 'a'), raw('schedule.day', 'b'), raw('station.state', 'c')],
      { stopOnRefusal: true },
    );
    expect(responses).toHaveLength(2);
    expect(responses[1]?.ok).toBe(false);
  });

  it('reports how far it got', () => {
    const responses = router().handleBatch([raw('station.state', 'a'), raw('schedule.day', 'b')], {
      stopOnRefusal: true,
    });
    expect(completed(responses)).toBe(1);
  });

  it('reports the whole batch when nothing was refused', () => {
    const responses = router().handleBatch([raw('station.state', 'a'), raw('library.add', 'b')]);
    expect(completed(responses)).toBe(2);
  });

  it('answers an empty batch with nothing', () => {
    expect(router().handleBatch([])).toEqual([]);
  });

  it('carries the read only guard into every request', () => {
    const responses = router().handleBatch([raw('library.add', 'a'), raw('library.remove', 'b')], {
      readOnly: true,
    });
    expect(responses.every((response) => response.problems[0]?.code === READ_ONLY)).toBe(true);
  });
});

describe('describeRoutes', () => {
  it('lists every operation with its summary, sorted', () => {
    const described = describeRoutes(router());
    expect(described.map((row) => row.op)).toEqual([
      'library.add',
      'library.remove',
      'schedule.day',
      'station.state',
    ]);
    expect(described[3]?.summary).toBe('read the current state');
    expect(described[3]?.writes).toBe(false);
  });
});

describe('malformed', () => {
  it('answers with no operation and no id, because neither was readable', () => {
    const response = malformed([error(MALFORMED, 'request', 'is not an object')]);
    expect(response.ok).toBe(false);
    expect(response.op).toBe('');
    expect(response.id).toBe('');
    expect(response.at).toBe(0);
  });
});

describe('Router.run', () => {
  it('takes an already parsed request', () => {
    const response = router().run(request('station.state', 'r5'));
    expect(response.data).toEqual({ seen: 'r5' });
  });

  it('refuses an unknown name the same way handle does', () => {
    expect(router().run(request('nope')).problems[0]?.code).toBe(UNKNOWN_OP);
  });
});
