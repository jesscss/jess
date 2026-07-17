import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * HARD MODULE BOUNDARY enforcement.
 *
 * No engine file directly under `packages/core/src/ast/` may import from
 * `../tree` (legacy node types, helpers, serializers, extend, materialization —
 * nothing). Only sibling engine files and neutral runtime modules may be
 * imported. The `parse-host/` subtree is excluded: it is the parser build host
 * and its test scaffolding, which legitimately bridge to the legacy tree.
 *
 * Note: this guard lives under `parse-host/` so that its own reference to the
 * forbidden path (in string form, for matching) does not pollute the engine
 * directory that the invariant scans.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// .../src/ast/parse-host/__tests__/harness/__tests__ -> .../src/ast
const ENGINE_DIR = join(HERE, '..', '..', '..', '..');
// The parser build host + its scaffolding may cross the boundary; exclude it.
const EXCLUDED = 'parse-host';

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === EXCLUDED) continue;
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
 * `tree` directory — i.e. a path segment is exactly `tree`.
 */
function crossesBoundary(spec: string): boolean {
  return /(^|\/)tree(\/|$)/.test(spec);
}

describe('engine hard module boundary', () => {
  it('no engine source file imports from ../tree', () => {
    const files = collectFiles(ENGINE_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const spec of importSpecifiers(source)) {
        if (crossesBoundary(spec)) {
          violations.push(`${relative(ENGINE_DIR, file)} imports "${spec}"`);
        }
      }
    }
    expect(violations, `engine boundary violations:\n${violations.join('\n')}`).toEqual([]);
  });
});
