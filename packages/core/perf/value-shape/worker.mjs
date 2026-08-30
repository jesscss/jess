/**
 * One workload, one FRESH process. Emits a JSON line on stdout.
 * Cross-process by construction so JIT/heap state cannot leak between variants.
 *
 *   node packages/core/perf/value-shape/worker.mjs bootstrap 15
 */
import { performance } from 'node:perf_hooks';
import { REPO, resolveWorkload, NEEDS_LESS_PLUGINS } from './workloads.mjs';

const { Compiler } = await import(`${REPO}/packages/jess/lib/index.js`);
const lessPlugin = (await import(`${REPO}/packages/jess-plugin-less/lib/index.js`)).default;
const { lessCompatPlugin } = await import(`${REPO}/packages/jess-plugin-less-compat/lib/index.js`);

const workload = process.argv[2];
const iters = Number(process.argv[3] ?? 15);
const files = resolveWorkload(workload);
const opts = { output: { collapseNesting: false }, suppressWarnings: true, breakOnError: false };
const mk = NEEDS_LESS_PLUGINS.has(workload)
  ? () => new Compiler({ compile: { plugins: [lessPlugin(), lessCompatPlugin()] } })
  : () => new Compiler();

async function once() {
  const c = mk();
  let n = 0;
  for (const f of files) {
    try {
      n += (await c.render(f, opts)).length;
    } catch { /* corpora carry known failures */ }
  }
  return n;
}

for (let i = 0; i < 3; i++) {
  await once();
}

const samples = [];
let peakHeap = 0, peakRss = 0, bytes = 0;
for (let i = 0; i < iters; i++) {
  const t0 = performance.now();
  bytes = await once();
  samples.push(performance.now() - t0);
  const m = process.memoryUsage();
  if (m.heapUsed > peakHeap) {
    peakHeap = m.heapUsed;
  }
  if (m.rss > peakRss) {
    peakRss = m.rss;
  }
}
const sorted = [...samples].sort((a, b) => a - b);
process.stdout.write(`${JSON.stringify({
  workload, iters, bytes,
  median: sorted[sorted.length >> 1],
  min: sorted[0],
  max: sorted[sorted.length - 1],
  mean: samples.reduce((a, b) => a + b, 0) / samples.length,
  peakHeap, peakRss
})}\n`);
