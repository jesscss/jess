/*
 * Measure the canonical AST extend path on the owner-maintained reference-import
 * fixture: bytes+sha, whole-compile median, and deterministic astExtend operation
 * counts. Used for matched-build A/B; run once per build variant.
 */
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

globalThis.__JESS_EXTEND_PROFILE_COUNTERS__ = {};
const counters = globalThis.__JESS_EXTEND_PROFILE_COUNTERS__;

const here = dirname(fileURLToPath(import.meta.url));
const { Compiler } = await import('../../jess/lib/index.js');
const lessPlugin = (await import('../../syntax/less/jess-plugin-less/lib/index.js')).default;
const { lessCompatPlugin } = await import('../../syntax/less/jess-plugin-less-compat/lib/index.js');

const file = process.env.FIXTURE
  ?? join(here, '../../../node_modules/@less/test-data/tests-unit/import/import-reference.less');
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
const metricNames = [
  'astExtend.plan.subjects',
  'astExtend.plan.instructions',
  'astExtend.match.branchComparisons',
  'astExtend.preflight.overlaySubjects',
  'astExtend.preflight.overlayInstructions',
  'astExtend.preflight.loopPlacements'
];
const metricSamples = Object.fromEntries(metricNames.map(name => [name, []]));
for (let i = 0; i < N; i++) {
  for (const k of Object.keys(counters)) {
    delete counters[k];
  }
  const t0 = performance.now();
  await render();
  compileMs.push(performance.now() - t0);
  for (const name of metricNames) {
    metricSamples[name].push(counters[name] ?? 0);
  }
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
console.log(`compile median ${median(compileMs).toFixed(3)}ms (n=${N})`);
const metricMedians = Object.fromEntries(metricNames.map(name => [name, median(metricSamples[name])]));
console.log(JSON.stringify({ compileMedianMs: Number(median(compileMs).toFixed(3)), metrics: metricMedians, bytes: first.length, sha256: sha }));
if (process.env.DUMP) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.DUMP, JSON.stringify({ compileMs, metricSamples, bytes: first.length, sha256: sha }));
}
