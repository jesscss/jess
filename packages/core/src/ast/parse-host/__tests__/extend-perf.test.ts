import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lessGrammar } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import type { Root, Statement } from '../../index.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';
import { parseToAst } from '../dispatch-host.js';
import { createImportState, resolveDirectImports } from '../import.js';

/**
 * DIAGNOSTIC extend perf + memory harness (never fails). Measures the WHOLE render
 * cost (serialize, which invokes computeExtends) on benchmark.less, plus an
 * allocation proxy (heapUsed delta) and — when run under `--expose-gc` — a
 * post-GC retained-heap delta. Same-worktree git-toggle before/after.
 *
 * Run: cd packages/core && NODE_OPTIONS=--expose-gc pnpm test extend-perf
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../../..');
const BENCHMARK = path.join(REPO_ROOT, 'packages/jess/benchmark/benchmark.less');

function evaluator() {
  return buildEvaluator(makeBuiltinRegistry());
}

/** Parse + resolve imports once → a fully-resolved Root ready for serialize. */
function resolveRoot(src: string, filePath: string): Root {
  const g = lessGrammar as Record<string, unknown>;
  const grammar = g['Stylesheet'];
  const trivia = g['rw'];
  const parse = (source: string): Statement[] => {
    const res = parseToAst(source, grammar, undefined, { trivia });
    return res.root ? res.root.children : [];
  };
  const built = parseToAst(src, grammar, undefined, { trivia });
  const root = built.root!;
  const resolved = resolveDirectImports(
    root.children,
    filePath,
    createImportState(parse),
    parse,
    () => {},
  );
  return { ...root, children: resolved };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

describe('extend perf + memory (diagnostic)', () => {
  it('serialize-only median + allocation proxy on benchmark.less', () => {
    const src = fs.readFileSync(BENCHMARK, 'utf8');
    const ev = evaluator();
    const root = resolveRoot(src, BENCHMARK);

    // Byte stability: repeated serialize must be pure (identical bytes).
    const first = (serialize(root, { evaluator: ev }) as { css: string }).css;
    const second = (serialize(root, { evaluator: ev }) as { css: string }).css;
    expect(second).toBe(first);
    console.log('\n===== EXTEND PERF (serialize-only, benchmark.less) =====');
    console.log('css bytes :', first.length);

    const WARMUP = 20;
    const N = 101;
    for (let i = 0; i < WARMUP; i++) serialize(root, { evaluator: ev });

    const gc = (globalThis as { gc?: () => void }).gc;
    if (gc) { gc(); gc(); }
    const heapBefore = process.memoryUsage().heapUsed;

    const times: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      serialize(root, { evaluator: ev });
      times.push(performance.now() - t0);
    }
    const heapAfter = process.memoryUsage().heapUsed;
    const med = median(times);
    const min = [...times].sort((a, b) => a - b)[0]!;
    console.log(`serialize: median ${med.toFixed(4)} ms, min ${min.toFixed(4)} ms  (N=${N})`);
    console.log(`heapUsed delta over ${N} serializes: ${((heapAfter - heapBefore) / 1024).toFixed(1)} KiB` +
      ` (~${((heapAfter - heapBefore) / N / 1024).toFixed(2)} KiB/render, alloc proxy)`);

    if (gc) {
      gc(); gc();
      const retained = process.memoryUsage().heapUsed;
      console.log(`post-GC retained heap: ${(retained / 1024 / 1024).toFixed(2)} MiB`);
    } else {
      console.log('post-GC retained heap: (run with NODE_OPTIONS=--expose-gc for GC-neutrality proof)');
    }
    expect(true).toBe(true);
  });
});
