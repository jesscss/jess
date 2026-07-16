import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * HARD MODULE BOUNDARY enforcement.
 *
 * No file under `packages/core/src/tree2/` may import from `../tree` (legacy
 * node types, helpers, serializers, extend, materialization — nothing). Only
 * sibling `tree2` files and neutral runtime modules may be imported. This test
 * fails if any tree2 file references the legacy tree.
 *
 * Note: this guard lives OUTSIDE `tree2/` so that its own reference to the
 * forbidden path (in string form, for matching) does not pollute the tree2
 * directory that the `grep` invariant scans.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// .../src/tree2-harness/__tests__ -> .../src/tree2
const TREE2_DIR = join(HERE, '..', '..', 'tree2');

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Extract every module specifier from static/dynamic import + re-export. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    specs.push((m[1] ?? m[2])!);
  }
  return specs;
}

/**
 * A specifier crosses the forbidden boundary if it resolves into the legacy
 * `tree` directory — i.e. a path segment is exactly `tree` (not `tree2`).
 */
function crossesBoundary(spec: string): boolean {
  return /(^|\/)tree(\/|$)/.test(spec);
}

describe('tree2 hard module boundary', () => {
  it('no tree2 source file imports from ../tree', () => {
    const files = collectFiles(TREE2_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const spec of importSpecifiers(source)) {
        if (crossesBoundary(spec)) {
          violations.push(`${relative(TREE2_DIR, file)} imports "${spec}"`);
        }
      }
    }
    expect(violations, `tree2 boundary violations:\n${violations.join('\n')}`).toEqual([]);
  });
});
