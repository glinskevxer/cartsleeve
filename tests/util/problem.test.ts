import { describe, expect, it } from 'vitest';
import {
  AREAS,
  areaOf,
  atLeast,
  codeFor,
  countByCode,
  countBySeverity,
  error,
  formatProblem,
  hasErrors,
  info,
  isAtLeast,
  problem,
  warning,
  worstSeverity,
} from '../../src/util/problem.js';
import type { Problem } from '../../src/util/problem.js';

const SAMPLE: Problem[] = [
  info('LIB-001', 'M0001', 'has no intro time'),
  warning('LIB-014', 'M0002', 'has no era coded'),
  error('LIB-030', 'M0003', 'has no runtime'),
  warning('SCH-002', 'slot 4', 'filled at a relaxed tier'),
];

describe('building a problem', () => {
  it('carries code, severity, subject and message', () => {
    const item = problem('LIB-001', 'warning', 'M0001', 'is short');
    expect(item).toEqual({
      code: 'LIB-001',
      severity: 'warning',
      subject: 'M0001',
      message: 'is short',
    });
  });

  it('omits detail entirely when none is given', () => {
    expect('detail' in problem('LIB-001', 'info', 'x', 'y')).toBe(false);
  });

  it('keeps detail when it is given', () => {
    const item = error('SCH-002', 'slot 4', 'artist too close', { minutes: 38, needed: 40 });
    expect(item.detail).toEqual({ minutes: 38, needed: 40 });
  });

  it('has a shorthand for each severity', () => {
    expect(info('A-001', 's', 'm').severity).toBe('info');
    expect(warning('A-001', 's', 'm').severity).toBe('warning');
    expect(error('A-001', 's', 'm').severity).toBe('error');
  });
});

describe('severity', () => {
  it('orders info below warning below error', () => {
    expect(isAtLeast('error', 'warning')).toBe(true);
    expect(isAtLeast('warning', 'warning')).toBe(true);
    expect(isAtLeast('info', 'warning')).toBe(false);
  });

  it('filters to a floor', () => {
    expect(atLeast(SAMPLE, 'warning')).toHaveLength(3);
    expect(atLeast(SAMPLE, 'error')).toHaveLength(1);
    expect(atLeast(SAMPLE, 'info')).toHaveLength(4);
  });

  it('reports whether anything is an error', () => {
    expect(hasErrors(SAMPLE)).toBe(true);
    expect(hasErrors(SAMPLE.slice(0, 2))).toBe(false);
    expect(hasErrors([])).toBe(false);
  });

  it('finds the worst severity present', () => {
    expect(worstSeverity(SAMPLE)).toBe('error');
    expect(worstSeverity(SAMPLE.slice(0, 2))).toBe('warning');
    expect(worstSeverity(SAMPLE.slice(0, 1))).toBe('info');
    expect(worstSeverity([])).toBeUndefined();
  });
});

describe('counting', () => {
  it('counts by severity including the zeroes', () => {
    expect(countBySeverity(SAMPLE)).toEqual({ info: 1, warning: 2, error: 1 });
    expect(countBySeverity([])).toEqual({ info: 0, warning: 0, error: 0 });
  });

  it('counts by code', () => {
    const doubled = [...SAMPLE, warning('LIB-014', 'M0009', 'has no era coded')];
    expect(countByCode(doubled).get('LIB-014')).toBe(2);
    expect(countByCode(doubled).get('LIB-001')).toBe(1);
  });
});

describe('formatting', () => {
  it('prints without detail', () => {
    expect(formatProblem(SAMPLE[0] as Problem)).toBe('LIB-001 info M0001: has no intro time');
  });

  it('prints detail in a stable key order', () => {
    const item = error('SCH-002', 'slot 4', 'artist too close', { needed: 40, minutes: 38 });
    expect(formatProblem(item)).toBe(
      'SCH-002 error slot 4: artist too close [minutes=38 needed=40]',
    );
  });
});

describe('codes', () => {
  it('pads the number to three digits', () => {
    expect(codeFor('library', 1)).toBe('LIB-001');
    expect(codeFor('schedule', 42)).toBe('SCH-042');
    expect(codeFor('royalty', 130)).toBe('ROY-130');
  });

  it('reads the area back off a code', () => {
    expect(areaOf('LIB-001')).toBe('library');
    expect(areaOf('ROY-130')).toBe('royalty');
    expect(areaOf('ZZZ-001')).toBeUndefined();
  });

  it('round trips every area it knows', () => {
    for (const name of Object.keys(AREAS)) {
      expect(areaOf(codeFor(name as keyof typeof AREAS, 7))).toBe(name);
    }
  });

  it('gives every area a distinct prefix', () => {
    expect(new Set(Object.values(AREAS)).size).toBe(Object.keys(AREAS).length);
  });
});
