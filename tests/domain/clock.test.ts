import { describe, expect, it } from 'vitest';
import {
  HOUR_TENTHS,
  categoryDemand,
  describeElement,
  elementAt,
  makeClock,
  musicBounds,
  musicCount,
  musicElements,
  stopsetBudget,
  stopsets,
} from '../../src/domain/clock.js';
import type { ElementInput } from '../../src/domain/clock.js';
import { expectErr, expectOk } from '../support/result.js';

const AMD: ElementInput[] = [
  { kind: 'fixed', target: '0:00', cart: 'J0001' },
  { kind: 'music', target: '0:08', category: 'A', noOpen: false },
  { kind: 'music', target: '3:50', category: 'B' },
  { kind: 'stopset', target: '7:30', name: 'break one', budget: '2:30' },
  { kind: 'news', target: '10:00', length: '3:00' },
  { kind: 'music', target: '13:00', category: 'A' },
  { kind: 'music', target: '16:40', category: 'G', noClose: true },
  { kind: 'stopset', target: '20:00', name: 'break two', budget: '3:00' },
];

const clock = () => expectOk(makeClock('AMD hot', AMD));

describe('makeClock', () => {
  it('builds every element kind in order', () => {
    const built = clock();
    expect(built.name).toBe('AMD hot');
    expect(built.elements).toHaveLength(8);
    expect(built.elements.map((e) => e.kind)).toEqual([
      'fixed',
      'music',
      'music',
      'stopset',
      'news',
      'music',
      'music',
      'stopset',
    ]);
  });

  it('numbers every element by its position', () => {
    expect(clock().elements.map((e) => e.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('parses the targets into tenths', () => {
    expect(elementAt(clock(), 2)?.target).toBe(2300);
  });

  it('keeps the open and close restrictions only where they were set', () => {
    const built = clock();
    const second = musicElements(built)[0];
    const gold = musicElements(built)[3];
    expect(second?.noOpen).toBe(false);
    expect('noClose' in (second ?? {})).toBe(false);
    expect(gold?.noClose).toBe(true);
  });

  it('defaults a stopset budget and a news length', () => {
    const built = expectOk(
      makeClock('x', [
        { kind: 'stopset', target: '0:00', name: 'b' },
        { kind: 'news', target: '5:00' },
      ]),
    );
    expect(stopsets(built)[0]?.budget).toBe(1200);
    expect(built.elements[1]?.kind).toBe('news');
  });

  it('rejects a clock with no name or no elements', () => {
    expect(expectErr(makeClock(' ', AMD))[0]?.code).toBe('CLK-038');
    expect(expectErr(makeClock('x', []))[0]?.code).toBe('CLK-039');
  });

  it('rejects a target that is not a clock time or is past the hour', () => {
    expect(
      expectErr(makeClock('x', [{ kind: 'music', target: 'nope', category: 'A' }]))[0]?.code,
    ).toBe('CLK-030');
    expect(
      expectErr(makeClock('x', [{ kind: 'music', target: '61:00', category: 'A' }]))[0]?.code,
    ).toBe('CLK-031');
  });

  it('rejects a target of exactly one hour', () => {
    expect(
      expectErr(makeClock('x', [{ kind: 'music', target: '60:00', category: 'A' }]))[0]?.code,
    ).toBe('CLK-031');
  });

  it('rejects each element kind that is missing what it needs', () => {
    expect(expectErr(makeClock('x', [{ kind: 'music', target: '0:00' }]))[0]?.code).toBe('CLK-032');
    expect(expectErr(makeClock('x', [{ kind: 'fixed', target: '0:00' }]))[0]?.code).toBe('CLK-033');
    expect(expectErr(makeClock('x', [{ kind: 'stopset', target: '0:00' }]))[0]?.code).toBe(
      'CLK-034',
    );
    expect(
      expectErr(makeClock('x', [{ kind: 'stopset', target: '0:00', name: 'b', budget: 'x' }]))[0]
        ?.code,
    ).toBe('CLK-035');
    expect(
      expectErr(makeClock('x', [{ kind: 'news', target: '0:00', length: 'x' }]))[0]?.code,
    ).toBe('CLK-036');
  });

  it('rejects an element whose target goes backwards', () => {
    const problems = expectErr(
      makeClock('x', [
        { kind: 'music', target: '10:00', category: 'A' },
        { kind: 'music', target: '5:00', category: 'B' },
      ]),
    );
    expect(problems[0]?.code).toBe('CLK-040');
    expect(problems[0]?.detail?.['previous']).toBe(6000);
  });

  it('accepts two elements sharing a target', () => {
    expect(
      expectOk(
        makeClock('x', [
          { kind: 'fixed', target: '0:00', cart: 'J0001' },
          { kind: 'music', target: '0:00', category: 'A' },
        ]),
      ).elements,
    ).toHaveLength(2);
  });
});

describe('reading a clock', () => {
  it('counts the music elements', () => {
    expect(musicCount(clock())).toBe(4);
    expect(musicElements(clock()).map((e) => e.category)).toEqual(['A', 'B', 'A', 'G']);
  });

  it('sums what each category is asked for', () => {
    expect([...categoryDemand(clock())]).toEqual([
      ['A', 2],
      ['B', 1],
      ['G', 1],
    ]);
  });

  it('sums the commercial time the clock is built to hold', () => {
    expect(stopsetBudget(clock())).toBe(3300);
    expect(
      stopsetBudget(expectOk(makeClock('x', [{ kind: 'music', target: '0:00', category: 'A' }]))),
    ).toBe(0);
  });

  it('finds the first and last music positions', () => {
    expect(musicBounds(clock())).toEqual({ first: 1, last: 6 });
  });

  it('reports no bounds on a clock with no music', () => {
    const built = expectOk(makeClock('x', [{ kind: 'stopset', target: '0:00', name: 'b' }]));
    expect(musicBounds(built)).toEqual({});
  });

  it('returns undefined for a position past the end', () => {
    expect(elementAt(clock(), 99)).toBeUndefined();
  });

  it('describes each element kind', () => {
    const built = clock();
    expect(built.elements.map(describeElement)).toEqual([
      '0 fixed J0001',
      '1 music A',
      '2 music B',
      '3 stopset break one',
      '4 news',
      '5 music A',
      '6 music G',
      '7 stopset break two',
    ]);
  });

  it('knows an hour is sixty minutes of tenths', () => {
    expect(HOUR_TENTHS).toBe(36000);
  });
});
