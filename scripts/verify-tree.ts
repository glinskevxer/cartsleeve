/**
 * The tree gate.
 *
 * Two rules about the shape of the source, both of which a person will break by
 * accident and neither of which a type checker can see.
 *
 * The first is the layering. Every directory under src sits at a level, and a
 * module may import from its own level or below it and never above. This is the
 * rule that keeps the domain from knowing about the command line. It was broken
 * once already, by a report reaching into a service for a station name, and the
 * only sign was that a unit test needed a journal to run.
 *
 * The second is that every module has a test file. Not that it is tested well,
 * which nothing can check, but that somebody wrote one. A module with no test
 * file is not a gap in coverage, it is a module nobody has run on purpose.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Low to high. A module may import its own layer and anything before it. */
export const LAYERS = [
  'util',
  'domain',
  'library',
  'rotation',
  'rules',
  'schedule',
  // Printing sits here rather than at the top, which surprised me and then
  // stopped surprising me. A report is a pure function from values to lines and
  // it depends on nothing above the schedule. Putting it at the top would have
  // forced a second copy of the page frame into the royalty filing, which is
  // exactly the duplication the frame was written to remove.
  'report',
  'traffic',
  'aired',
  'royalty',
  'store',
  'service',
  'api',
  'cli',
] as const;

export type Layer = (typeof LAYERS)[number];

/** Windows and posix write a path differently and both reach this. */
const SEPARATOR = /[\\/]/;

export interface Violation {
  readonly file: string;
  readonly kind: 'upward import' | 'unknown layer' | 'no test';
  readonly detail: string;
}

export function layerOf(path: string): Layer | undefined {
  const parts = path.split(SEPARATOR);
  const at = parts.indexOf('src');
  const name = at < 0 ? parts[0] : parts[at + 1];
  return LAYERS.find((layer) => layer === name);
}

export function rankOf(layer: Layer): number {
  return LAYERS.indexOf(layer);
}

const IMPORT = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/g;

/** The relative specifiers a file imports. Bare package names are not ours. */
export function importsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(IMPORT)) {
    const specifier = match[1];
    if (specifier !== undefined && specifier.startsWith('.')) {
      found.push(specifier);
    }
  }
  return found;
}

/** Which layer an import specifier lands in, read from the path it walks. */
export function targetLayer(fromFile: string, specifier: string): Layer | undefined {
  const resolved = resolve(join(fromFile, '..'), specifier);
  const parts = resolved.split(SEPARATOR);
  const at = parts.lastIndexOf('src');
  return at < 0 ? undefined : LAYERS.find((layer) => layer === parts[at + 1]);
}

export function walk(root: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path));
    } else if (name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found.sort();
}

export interface TreeInput {
  readonly sourceRoot: string;
  readonly testRoot: string;
  /** Read a file. Injected so the checks can be run over a tree in memory. */
  readonly read: (path: string) => string;
  readonly exists: (path: string) => boolean;
  readonly files: readonly string[];
}

export function checkTree(input: TreeInput): Violation[] {
  const violations: Violation[] = [];
  for (const file of input.files) {
    const relativePath = relative(input.sourceRoot, file).split(SEPARATOR).join('/');
    const layer = layerOf(`src/${relativePath}`);
    if (layer === undefined) {
      violations.push({
        file: relativePath,
        kind: 'unknown layer',
        detail: 'sits in a directory that is not a layer',
      });
      continue;
    }
    for (const specifier of importsIn(input.read(file))) {
      const target = targetLayer(file, specifier);
      if (target !== undefined && rankOf(target) > rankOf(layer)) {
        violations.push({
          file: relativePath,
          kind: 'upward import',
          detail: `${layer} imports ${target} through ${specifier}`,
        });
      }
    }
    const test = join(input.testRoot, relativePath.replace(/\.ts$/, '.test.ts'));
    if (!input.exists(test) && !relativePath.endsWith('main.ts')) {
      violations.push({
        file: relativePath,
        kind: 'no test',
        detail: `has no ${relative(input.sourceRoot, test).split(SEPARATOR).join('/')}`,
      });
    }
  }
  return violations;
}

export function report(violations: readonly Violation[]): string[] {
  if (violations.length === 0) {
    return ['tree ok'];
  }
  return [
    ...violations.map((violation) => `${violation.file}: ${violation.kind}, ${violation.detail}`),
    `${violations.length} problems`,
  ];
}

function main(): void {
  const root = resolve(process.argv[2] ?? '.');
  const sourceRoot = join(root, 'src');
  const violations = checkTree({
    sourceRoot,
    testRoot: join(root, 'tests'),
    read: (path) => readFileSync(path, 'utf8'),
    exists: (path) => {
      try {
        statSync(path);
        return true;
      } catch {
        return false;
      }
    },
    files: walk(sourceRoot),
  });
  for (const line of report(violations)) {
    process.stdout.write(`${line}\n`);
  }
  process.exitCode = violations.length === 0 ? 0 : 1;
}

// Run when invoked directly, and stay quiet when imported by a test.
if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-tree.ts')) {
  main();
}
