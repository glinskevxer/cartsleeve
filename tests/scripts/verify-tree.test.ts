import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LAYERS,
  checkTree,
  importsIn,
  layerOf,
  rankOf,
  report,
  targetLayer,
  walk,
} from '../../scripts/verify-tree.js';

const ROOT = join(import.meta.dirname, '..', '..');
const SOURCE = join(ROOT, 'src');

describe('the layers', () => {
  it('are listed low to high with no repeats', () => {
    expect(new Set(LAYERS).size).toBe(LAYERS.length);
    expect(rankOf('util')).toBe(0);
    expect(rankOf('cli')).toBe(LAYERS.length - 1);
  });

  it('put printing below the layers that print', () => {
    expect(rankOf('report')).toBeLessThan(rankOf('royalty'));
    expect(rankOf('report')).toBeLessThan(rankOf('aired'));
  });
});

describe('layerOf', () => {
  it('reads the layer out of a path', () => {
    expect(layerOf('src/rules/rule.ts')).toBe('rules');
    expect(layerOf('src/api/envelope.ts')).toBe('api');
  });

  it('reads a windows path the same way', () => {
    expect(layerOf('src\\rules\\rule.ts')).toBe('rules');
  });

  it('says nothing for a directory that is not a layer', () => {
    expect(layerOf('src/helpers/thing.ts')).toBeUndefined();
  });
});

describe('importsIn', () => {
  it('finds a plain import', () => {
    expect(importsIn("import { a } from './a.js';")).toEqual(['./a.js']);
  });

  it('finds a type only import', () => {
    expect(importsIn("import type { A } from '../domain/a.js';")).toEqual(['../domain/a.js']);
  });

  it('finds a re-export', () => {
    expect(importsIn("export { a } from './a.js';")).toEqual(['./a.js']);
  });

  it('ignores a package, because a package is not ours to layer', () => {
    expect(importsIn("import { z } from 'zod';")).toEqual([]);
  });

  it('finds every import in a file, not the first', () => {
    const text = ["import { a } from './a.js';", "import { b } from './b.js';"].join('\n');
    expect(importsIn(text)).toEqual(['./a.js', './b.js']);
  });

  it('ignores the word import inside a comment or a string', () => {
    expect(importsIn("const note = 'import x from y';")).toEqual([]);
  });
});

describe('targetLayer', () => {
  it('reads the layer an import lands in', () => {
    expect(targetLayer(join(SOURCE, 'rules', 'rule.ts'), '../domain/cart.js')).toBe('domain');
    expect(targetLayer(join(SOURCE, 'api', 'envelope.ts'), '../util/result.js')).toBe('util');
  });

  it('reads an import inside the same layer as that layer', () => {
    expect(targetLayer(join(SOURCE, 'api', 'dispatch.ts'), './envelope.js')).toBe('api');
  });

  it('says nothing for an import that leaves the source tree', () => {
    expect(
      targetLayer(join(SOURCE, 'api', 'a.ts'), '../../scripts/verify-tree.js'),
    ).toBeUndefined();
  });
});

describe('checkTree', () => {
  const tree = (files: Record<string, string>, tests: readonly string[] = []) =>
    checkTree({
      sourceRoot: SOURCE,
      testRoot: join(ROOT, 'tests'),
      read: (path) => files[path] ?? '',
      exists: (path) => tests.includes(path),
      files: Object.keys(files),
    });

  it('passes a downward import', () => {
    const file = join(SOURCE, 'rules', 'rule.ts');
    const test = join(ROOT, 'tests', 'rules', 'rule.test.ts');
    expect(tree({ [file]: "import { a } from '../domain/cart.js';" }, [test])).toEqual([]);
  });

  it('catches an import that reaches up a layer', () => {
    const file = join(SOURCE, 'domain', 'cart.ts');
    const test = join(ROOT, 'tests', 'domain', 'cart.test.ts');
    const found = tree({ [file]: "import { a } from '../service/station-service.js';" }, [test]);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('upward import');
    expect(found[0]?.detail).toContain('domain imports service');
  });

  it('passes an import inside the same layer', () => {
    const file = join(SOURCE, 'api', 'dispatch.ts');
    const test = join(ROOT, 'tests', 'api', 'dispatch.test.ts');
    expect(tree({ [file]: "import { a } from './envelope.js';" }, [test])).toEqual([]);
  });

  it('catches a module with no test file', () => {
    const file = join(SOURCE, 'api', 'dispatch.ts');
    const found = tree({ [file]: '' });
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('no test');
    expect(found[0]?.detail).toContain('api/dispatch.test.ts');
  });

  it('lets the entry point off the test rule, because it is wiring', () => {
    const file = join(SOURCE, 'cli', 'main.ts');
    expect(tree({ [file]: '' })).toEqual([]);
  });

  it('catches a directory that is not a layer at all', () => {
    const file = join(SOURCE, 'helpers', 'thing.ts');
    const found = tree({ [file]: '' });
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('unknown layer');
  });

  it('reports every problem in one file, not the first', () => {
    const file = join(SOURCE, 'domain', 'cart.ts');
    const found = tree({
      [file]: [
        "import { a } from '../service/station-service.js';",
        "import { b } from '../cli/render.js';",
      ].join('\n'),
    });
    expect(found).toHaveLength(3);
  });
});

describe('report', () => {
  it('says so when there is nothing wrong', () => {
    expect(report([])).toEqual(['tree ok']);
  });

  it('lists each problem and then counts them', () => {
    const lines = report([
      { file: 'a.ts', kind: 'no test', detail: 'has no a.test.ts' },
      { file: 'b.ts', kind: 'upward import', detail: 'domain imports cli' },
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('2 problems');
  });
});

describe('the real tree', () => {
  it('has no upward import and no untested module', () => {
    const violations = checkTree({
      sourceRoot: SOURCE,
      testRoot: join(ROOT, 'tests'),
      read: (path) => readFileSync(path, 'utf8'),
      exists: (path) => existsSync(path),
      files: walk(SOURCE),
    });
    expect(violations.map((violation) => `${violation.file}: ${violation.detail}`)).toEqual([]);
  });
});
