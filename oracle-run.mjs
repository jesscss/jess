/**
 * Legacy-oracle producer for benchmark.less (node-process, BUILT packages).
 *
 * The AST-v2 driver runs in a vitest SOURCE module graph; the legacy import-
 * resolving oracle cannot share that graph (the built less-parser lib's parseman
 * shape collides with source parseman under vitest's SSR transform -> unwrapTrivia
 * TypeError, which also fells the existing import-byte-identity suite in a fresh
 * worktree). And the source bare-context `renderRealOracle` throws on this file's
 * extend section (legacy spine-extend emit bug). So the trustworthy legacy oracle
 * is the PRODUCTION Compiler in a plain node process against the BUILT packages:
 * imports stay present -> the root is not spine-eligible -> full legacy eval runs,
 * dodging the spine bug. Writes packages/core/.bmark-ast/oracle.css + timings.
 *
 * Run: `node ./oracle-run.mjs` from the repo root (requires a full non-docs build).
 */
import { Compiler } from './packages/jess/lib/index.js';
import lessPlugin from './packages/syntax/less/jess-plugin-less/lib/index.js';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const f = fileURLToPath(new URL('./packages/jess/benchmark/benchmark.less', import.meta.url));
const benchmarkConfig = {
  output: { collapseNesting: true },
  compile: { plugins: [lessPlugin()] }
};

// This is the canonical flat-CSS benchmark.  Do not silently fall back to the
// nested renderer: recursive generator mixins then exercise a different,
// dramatically larger workload.
if (benchmarkConfig.output.collapseNesting !== true) {
  throw new Error('benchmark.less oracle requires output.collapseNesting === true');
}

const mk = () => new Compiler(benchmarkConfig);

let css;
try {
  css = await mk().render(f);
} catch (e) {
  console.log('THREW', e && e.message);
  console.log((e && e.stack || '').split('\n').slice(0, 10).join('\n'));
  process.exit(1);
}
fs.mkdirSync('./packages/core/.bmark-ast', { recursive: true });
fs.writeFileSync('./packages/core/.bmark-ast/oracle.css', css);
console.log('oracle bytes:', css.length);

const WARMUP = 3, N = 15, times = [];
for (let i = 0; i < WARMUP; i++) {
  await mk().render(f);
}
for (let i = 0; i < N; i++) {
  const t0 = performance.now(); await mk().render(f); times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
console.log('legacy full-eval (Compiler.render, incl. disk+setup): median',
  times[Math.floor(N / 2)].toFixed(3), 'ms, min', times[0].toFixed(3), 'ms');
