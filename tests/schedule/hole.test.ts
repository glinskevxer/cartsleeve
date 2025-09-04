import { describe, expect, it } from 'vitest';
import {
  DOMINANT_SHARE,
  HOLE_CODE,
  alwaysRejected,
  describeCause,
  diagnose,
  toProblem,
} from '../../src/schedule/hole.js';
import type { Hole } from '../../src/schedule/search.js';

function hole(
  rejections: readonly { cart: string; rules: readonly string[] }[],
  reason: Hole['reason'] = 'nothing passed',
): Hole {
  return { reason, rejections, considered: rejections.length };
}

const EMPTY: Hole = { reason: 'no candidates', rejections: [], considered: 0 };

describe('diagnose', () => {
  it('calls an empty candidate list an empty category', () => {
    const found = diagnose(EMPTY);
    expect(found.cause).toBe('category empty');
    expect(found.considered).toBe(0);
  });

  it('blames one rule when it rejected nearly everything', () => {
    const found = diagnose(
      hole([
        { cart: 'M0001', rules: ['artist separation'] },
        { cart: 'M0002', rules: ['artist separation'] },
        { cart: 'M0003', rules: ['artist separation'] },
        { cart: 'M0004', rules: ['artist separation'] },
        { cart: 'M0005', rules: ['tempo flow'] },
      ]),
    );
    expect(found.cause).toBe('one rule');
    expect(found.rule).toBe('artist separation');
    expect(found.rejected).toBe(4);
    expect(found.considered).toBe(5);
  });

  it('blames nothing in particular when the rules are spread', () => {
    const found = diagnose(
      hole([
        { cart: 'M0001', rules: ['artist separation'] },
        { cart: 'M0002', rules: ['title separation'] },
        { cart: 'M0003', rules: ['tempo flow'] },
        { cart: 'M0004', rules: ['sound separation'] },
      ]),
    );
    expect(found.cause).toBe('no single cause');
    expect(found.rule).toBeDefined();
  });

  it('calls it restriction when eligibility rejected nearly everything', () => {
    const found = diagnose(
      hole([
        { cart: 'M0001', rules: ['eligibility'] },
        { cart: 'M0002', rules: ['eligibility'] },
      ]),
    );
    expect(found.cause).toBe('all restricted');
    expect(found.rule).toBe('eligibility');
  });

  it('needs the dominant share before it blames one rule', () => {
    const half = diagnose(
      hole([
        { cart: 'M0001', rules: ['artist separation'] },
        { cart: 'M0002', rules: ['tempo flow'] },
      ]),
    );
    expect(half.cause).toBe('no single cause');
    expect(DOMINANT_SHARE).toBeGreaterThan(0.5);
  });

  it('blames one rule when every candidate failed it', () => {
    const found = diagnose(
      hole([
        { cart: 'M0001', rules: ['artist separation', 'tempo flow'] },
        { cart: 'M0002', rules: ['artist separation'] },
      ]),
    );
    expect(found.cause).toBe('one rule');
    expect(found.rule).toBe('artist separation');
  });

  it('says unknown when nothing was recorded', () => {
    expect(diagnose(hole([])).cause).toBe('unknown');
    expect(diagnose(hole([{ cart: 'M0001', rules: [] }])).cause).toBe('unknown');
  });

  it('gives the same answer whichever order the rejections arrive', () => {
    const rejections = [
      { cart: 'M0001', rules: ['artist separation'] },
      { cart: 'M0002', rules: ['artist separation'] },
      { cart: 'M0003', rules: ['tempo flow'] },
    ];
    const once = diagnose(hole(rejections));
    const again = diagnose(hole([...rejections].reverse()));
    expect(again.rule).toBe(once.rule);
    expect(again.cause).toBe(once.cause);
  });
});

describe('describeCause', () => {
  it('words each cause differently', () => {
    const causes = [
      diagnose(EMPTY),
      diagnose(hole([{ cart: 'M0001', rules: ['eligibility'] }])),
      diagnose(hole([{ cart: 'M0001', rules: ['artist separation'] }])),
      diagnose(hole([])),
    ].map(describeCause);
    expect(new Set(causes).size).toBe(4);
  });

  it('names the rule and the counts when one rule is to blame', () => {
    const said = describeCause(
      diagnose(
        hole([
          { cart: 'M0001', rules: ['artist separation'] },
          { cart: 'M0002', rules: ['artist separation'] },
        ]),
      ),
    );
    expect(said).toContain('artist separation');
    expect(said).toContain('2 of 2');
  });
});

describe('toProblem', () => {
  it('raises a hole as an error, because a hole is dead air', () => {
    const problem = toProblem({
      position: 4,
      category: 'A',
      diagnosis: diagnose(hole([{ cart: 'M0001', rules: ['artist separation'] }])),
    });
    expect(problem.severity).toBe('error');
    expect(problem.code).toBe(HOLE_CODE);
    expect(problem.subject).toBe('slot 4');
    expect(problem.detail?.['rule']).toBe('artist separation');
    expect(problem.detail?.['category']).toBe('A');
  });

  it('raises an empty category as only a warning', () => {
    const problem = toProblem({ position: 4, category: 'A', diagnosis: diagnose(EMPTY) });
    expect(problem.severity).toBe('warning');
    expect(problem.detail?.['rule']).toBeUndefined();
  });
});

describe('alwaysRejected', () => {
  it('finds the carts rejected in every hole', () => {
    const holes = [
      hole([
        { cart: 'M0001', rules: ['artist separation'] },
        { cart: 'M0002', rules: ['artist separation'] },
      ]),
      hole([
        { cart: 'M0001', rules: ['title separation'] },
        { cart: 'M0003', rules: ['artist separation'] },
      ]),
    ];
    expect(alwaysRejected(holes)).toEqual(['M0001']);
  });

  it('finds nothing when no cart appears in every hole', () => {
    const holes = [
      hole([{ cart: 'M0001', rules: ['x'] }]),
      hole([{ cart: 'M0002', rules: ['x'] }]),
    ];
    expect(alwaysRejected(holes)).toEqual([]);
  });

  it('ignores holes with no rejections at all', () => {
    expect(alwaysRejected([EMPTY, hole([{ cart: 'M0001', rules: ['x'] }])])).toEqual(['M0001']);
    expect(alwaysRejected([EMPTY])).toEqual([]);
    expect(alwaysRejected([])).toEqual([]);
  });
});
