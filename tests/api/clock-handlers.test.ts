import { beforeEach, describe, expect, it } from 'vitest';
import { Router } from '../../src/api/dispatch.js';
import { clockRoutes } from '../../src/api/clock-handlers.js';
import { StationService, emptyState } from '../../src/service/station-service.js';
import { Journal } from '../../src/store/append.js';
import { MemoryStorage } from '../../src/store/storage.js';
import { resetFixtures, station } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const BASE = 1_700_000_000_000;
let counter = 0;

function harness(): { router: Router; service: StationService } {
  const journal = Journal.open(new MemoryStorage());
  const service = new StationService(emptyState(station()), journal);
  return { router: new Router(clockRoutes(service)), service };
}

function call(
  router: Router,
  op: string,
  params: Record<string, unknown>,
): ReturnType<Router['handle']> {
  counter += 1;
  return router.handle({ op, id: `c${counter}`, at: BASE, params });
}

const MUSIC_HOUR = {
  name: 'AMD',
  elements: [
    { kind: 'music', target: '0:00', category: 'A' },
    { kind: 'stopset', target: '10:00', budget: '3:00', name: 'break one' },
    { kind: 'music', target: '14:00', category: 'B' },
    { kind: 'music', target: '18:00', category: 'A' },
    { kind: 'stopset', target: '30:00', budget: '4:00', name: 'break two' },
    { kind: 'music', target: '36:00', category: 'C' },
  ],
};

describe('clock.add', () => {
  it('defines a clock and answers with what it will do to the hour', () => {
    const { router, service } = harness();
    const response = call(router, 'clock.add', MUSIC_HOUR);
    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({ name: 'AMD', elements: 6, music: 4 });
    expect(service.current().clocks.has('AMD')).toBe(true);
  });

  it('reports the category demand the clock creates', () => {
    const { router } = harness();
    const data = call(router, 'clock.add', MUSIC_HOUR).data as Record<string, unknown>;
    expect(String(data['categories'])).toContain('Ax2');
    expect(String(data['categories'])).toContain('Bx1');
  });

  it('reports the stopset budget as a duration, not a number of tenths', () => {
    const { router } = harness();
    const data = call(router, 'clock.add', MUSIC_HOUR).data as Record<string, unknown>;
    expect(String(data['stopsetBudget'])).toBe('7:00');
  });

  it('warns about a clock with no music in it, and still defines it', () => {
    const { router, service } = harness();
    const response = call(router, 'clock.add', {
      name: 'NEWS',
      elements: [{ kind: 'news', target: '0:00', length: '5:00', name: 'network news' }],
    });
    expect(response.ok).toBe(true);
    expect(response.problems).toHaveLength(1);
    expect(response.problems[0]?.severity).toBe('warning');
    expect(service.current().clocks.has('NEWS')).toBe(true);
  });

  it('refuses a clock with no elements', () => {
    const { router } = harness();
    expect(call(router, 'clock.add', { name: 'AMD', elements: [] }).ok).toBe(false);
  });

  it('refuses an element kind nobody has heard of', () => {
    const { router } = harness();
    const response = call(router, 'clock.add', {
      name: 'AMD',
      elements: [{ kind: 'jingle', target: '0:00' }],
    });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toContain('kind');
  });

  it('refuses a target that is not a time', () => {
    const { router } = harness();
    const response = call(router, 'clock.add', {
      name: 'AMD',
      elements: [{ kind: 'music', target: 'soon', category: 'A' }],
    });
    expect(response.ok).toBe(false);
  });

  it('refuses the second definition of the same name', () => {
    const { router } = harness();
    call(router, 'clock.add', MUSIC_HOUR);
    expect(call(router, 'clock.add', MUSIC_HOUR).ok).toBe(false);
  });
});

describe('clock.replace', () => {
  it('replaces a clock and says what the music count was before', () => {
    const { router } = harness();
    call(router, 'clock.add', MUSIC_HOUR);
    const response = call(router, 'clock.replace', {
      name: 'AMD',
      elements: [
        { kind: 'music', target: '0:00', category: 'A' },
        { kind: 'music', target: '4:00', category: 'A' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({ music: 2, musicWas: 4 });
  });

  it('refuses to replace a clock nobody defined', () => {
    const { router } = harness();
    expect(call(router, 'clock.replace', MUSIC_HOUR).ok).toBe(false);
  });

  it('leaves the old clock in place when the new one will not build', () => {
    const { router, service } = harness();
    call(router, 'clock.add', MUSIC_HOUR);
    const response = call(router, 'clock.replace', {
      name: 'AMD',
      elements: [{ kind: 'music', target: 'soon', category: 'A' }],
    });
    expect(response.ok).toBe(false);
    expect(service.current().clocks.get('AMD')?.elements).toHaveLength(6);
  });
});

describe('clock.get', () => {
  it('reads a clock back with a line for each element', () => {
    const { router } = harness();
    call(router, 'clock.add', MUSIC_HOUR);
    const response = call(router, 'clock.get', { name: 'AMD' });
    expect(response.ok).toBe(true);
    const data = response.data as Record<string, unknown>;
    expect(data['lines']).toHaveLength(6);
  });

  it('refuses a name that is not defined', () => {
    const { router } = harness();
    const response = call(router, 'clock.get', { name: 'PMD' });
    expect(response.ok).toBe(false);
    expect(response.problems[0]?.subject).toBe('PMD');
  });

  it('refuses an empty name rather than looking one up', () => {
    const { router } = harness();
    expect(call(router, 'clock.get', { name: '' }).ok).toBe(false);
  });
});

describe('clock.list', () => {
  it('lists nothing on a new station', () => {
    const { router } = harness();
    expect(call(router, 'clock.list', {}).data).toEqual([]);
  });

  it('lists the clocks by name', () => {
    const { router } = harness();
    call(router, 'clock.add', MUSIC_HOUR);
    call(router, 'clock.add', { ...MUSIC_HOUR, name: 'ALL' });
    const rows = call(router, 'clock.list', {}).data as { name: string }[];
    expect(rows.map((row) => row.name)).toEqual(['ALL', 'AMD']);
  });
});

describe('clock.hour', () => {
  it('answers with the length of an hour both ways', () => {
    const { router } = harness();
    expect(call(router, 'clock.hour', {}).data).toEqual({ tenths: 36_000, length: '60:00' });
  });
});

describe('read only', () => {
  it('refuses every clock write and lets every read through', () => {
    const { router } = harness();
    const writes = ['clock.add', 'clock.replace'];
    for (const op of writes) {
      expect(router.writes(op)).toBe(true);
    }
    for (const op of ['clock.get', 'clock.list', 'clock.hour']) {
      expect(router.writes(op)).toBe(false);
    }
    expect(
      router.handle(
        { op: 'clock.add', id: 'x', at: BASE, params: MUSIC_HOUR },
        {
          readOnly: true,
        },
      ).ok,
    ).toBe(false);
  });
});
