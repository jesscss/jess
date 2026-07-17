import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAstFile, renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * T1 empirical inventory runner (BENCHMARK-PERF-PATH.md).
 *
 * Drives the whole-document AST-v2 driver on the REAL `benchmark.less` and records
 * what blocks a byte-identical render:
 *   1. render-or-throw through `ast/`
 *   2. writes the AST-v2 CSS to `packages/core/.bmark-ast/ast.css` for an OFFLINE
 *      diff against the legacy oracle (`oracle.css`, produced by the node-process
 *      `oracle-run.mjs` at the repo root — see the inventory doc for WHY the oracle
 *      cannot be produced in this same vitest module graph).
 *   3. a directional-only AST-v2 perf median.
 *
 * DIAGNOSTIC: never fails the suite. Run `pnpm test bmark-ast-driver`, read stdout.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/core/src/ast/parse-host/__tests__ → repo root is 6 up.
const REPO_ROOT = path.resolve(HERE, '../../../../../..');
const BENCHMARK = path.join(REPO_ROOT, 'packages/jess/benchmark/benchmark.less');
const SCRATCH = path.join(REPO_ROOT, 'packages/core/.bmark-ast');

function evaluator() {
  return buildEvaluator(makeBuiltinRegistry());
}

function head(s: string, n = 400): string {
  return JSON.stringify(s.slice(0, n));
}

describe('benchmark.less whole-document AST-v2 driver (diagnostic)', () => {
  it('renders benchmark.less through ast/ and writes ast.css', () => {
    const res = renderAstFile(BENCHMARK, { evaluator: evaluator() });
    console.log('\n===== AST-v2 render of benchmark.less (full file) =====');
    console.log('threw     :', res.threw ? `${res.threw.name}: ${res.threw.message}` : 'NO');
    console.log('parseErrs :', res.parseErrors.length);
    if (res.parseErrors.length) {
      console.log('first parse errs:', JSON.stringify(res.parseErrors.slice(0, 8)));
    }
    console.log('css bytes :', res.css === undefined ? 'undefined' : res.css.length);
    if (res.css !== undefined) {
      console.log('css head  :', head(res.css, 320));
      fs.mkdirSync(SCRATCH, { recursive: true });
      fs.writeFileSync(path.join(SCRATCH, 'ast.css'), res.css);
      console.log('wrote     :', path.join(SCRATCH, 'ast.css'));
    }
    if (res.threw) {
      console.log('stack     :', res.threw.stack?.split('\n').slice(0, 5).join(' | '));
    }
    expect(true).toBe(true);
  });

  it('preliminary AST-v2 perf median (DIRECTIONAL ONLY — not byte-identical)', () => {
    const src = fs.readFileSync(BENCHMARK, 'utf8');
    const ev = evaluator();
    const WARMUP = 5;
    const N = 25;

    const astRenders = renderAstDoc(src, { filePath: BENCHMARK, evaluator: ev }).threw === null;
    const times: number[] = [];
    for (let i = 0; i < WARMUP; i++) {
      renderAstDoc(src, { filePath: BENCHMARK, evaluator: ev });
    }
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      renderAstDoc(src, { filePath: BENCHMARK, evaluator: ev });
      times.push(performance.now() - t0);
    }
    const s = [...times].sort((a, b) => a - b);
    const median = s[Math.floor(s.length / 2)]!;
    const min = s[0]!;

    console.log('\n===== PRELIMINARY AST-v2 PERF (DIRECTIONAL ONLY, NOT BYTE-IDENTICAL) =====');
    console.log('WARNING: AST-v2 does NOT yet render benchmark.less byte-identically —');
    console.log('it emits ~28KB LESS than the oracle (unexpanded mixins / detached');
    console.log('rulesets / namespaces / unresolved vars), so this UNDER-counts real work.');
    console.log('AST-v2 renders end-to-end without throwing:', astRenders);
    console.log(`ast-v2 parse+build+serialize: median ${median.toFixed(3)} ms, min ${min.toFixed(3)} ms`);
    console.log('(legacy full-eval baseline is timed by the node-process oracle-run.mjs.)');
    expect(true).toBe(true);
  });
});
