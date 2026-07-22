// Measure benchmark.less (collapseNesting:true): bytes+sha, whole-compile median,
// and processExtends ms/render (the governed hot function). Used for the extend
// conservative-filter / deferral cost-contract A/B. Run once per build variant.
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

globalThis.__JESS_EXTEND_PROFILE_COUNTERS__ = {};
const counters = globalThis.__JESS_EXTEND_PROFILE_COUNTERS__;

const here = dirname(fileURLToPath(import.meta.url));
const { Compiler } = await import('../../jess/lib/index.js');
const lessPlugin = (await import('../../jess-plugin-less/lib/index.js')).default;
const { lessCompatPlugin } = await import('../../jess-plugin-less-compat/lib/index.js');

const file = join(here, '../../jess/benchmark/benchmark.less');
const opts = () => ({ output: { collapseNesting: true }, compile: { plugins: [lessPlugin(), lessCompatPlugin()] } });
const WARMUP = Number(process.env.WARMUP ?? 20);
const N = Number(process.env.N ?? 45);
const render = async () => new Compiler(opts()).render(file);

const first = await render();
const sha = createHash('sha256').update(first).digest('hex');
console.log(`bytes=${first.length} sha16=${sha.slice(0, 16)} sha256=${sha}`);

for (let i = 0; i < WARMUP; i++) {
  await render();
}

const compileMs = [];
const extendMs = [];
for (let i = 0; i < N; i++) {
  for (const k of Object.keys(counters)) {
    delete counters[k];
  }
  const t0 = performance.now();
  await render();
  compileMs.push(performance.now() - t0);
  const passes = counters['processExtends.calls'] ?? 0;
  const ms = counters['processExtends.ms'] ?? 0;
  extendMs.push(passes > 0 ? ms / passes : 0);
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
console.log(`compile median ${median(compileMs).toFixed(3)}ms (n=${N})`);
console.log(`processExtends median ${median(extendMs).toFixed(3)}ms/render (n=${N})`);
console.log(JSON.stringify({ compileMedianMs: Number(median(compileMs).toFixed(3)), processExtendsMedianMs: Number(median(extendMs).toFixed(3)), bytes: first.length, sha256: sha }));
if (process.env.DUMP) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.DUMP, JSON.stringify({ compileMs, extendMs, bytes: first.length, sha256: sha }));
}
