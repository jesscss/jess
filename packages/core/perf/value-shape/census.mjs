/**
 * Construction census: how many value nodes a REAL compile builds, per type,
 * and how many V8 maps the CONDITIONAL factory spelling actually produces.
 *
 * This is the exact, noise-free half of the value-shape question. Once the
 * counts are known the memory delta is arithmetic — see `memory.mjs`.
 *
 * Requires `instrument.mjs` to have been applied and core rebuilt:
 *   node packages/core/perf/value-shape/instrument.mjs
 *   pnpm --filter @jesscss/core build
 *   node packages/core/perf/value-shape/census.mjs bootstrap results/census-bootstrap.json
 *   git checkout -- packages/core/src/ast/value-factory.ts
 */
import { writeFileSync } from 'node:fs';
import { REPO, resolveWorkload, NEEDS_LESS_PLUGINS } from './workloads.mjs';

const { Compiler } = await import(`${REPO}/packages/jess/lib/index.js`);
const lessPlugin = (await import(`${REPO}/packages/jess-plugin-less/lib/index.js`)).default;
const { lessCompatPlugin } = await import(`${REPO}/packages/jess-plugin-less-compat/lib/index.js`);

const workload = process.argv[2];
const outfile = process.argv[3];
const files = resolveWorkload(workload);
const opts = { output: { collapseNesting: false }, suppressWarnings: true, breakOnError: false };

const compiler = NEEDS_LESS_PLUGINS.has(workload)
  ? new Compiler({ compile: { plugins: [lessPlugin(), lessCompatPlugin()] } })
  : new Compiler();

if (!globalThis.__VF__) {
  console.error('NO INSTRUMENTATION: run instrument.mjs and rebuild core first.');
  process.exit(1);
}

/*
 * Clear IN PLACE — the factory module captured this object reference, so
 * reassigning globalThis.__VF__ would silently detach the counters and report 0.
 */
for (const k of Object.keys(globalThis.__VF__)) {
  delete globalThis.__VF__[k];
}

let ok = 0, failed = 0, outBytes = 0;
for (const f of files) {
  try {
    outBytes += (await compiler.render(f, opts)).length;
    ok++;
  } catch {
    failed++;
  }
}

const result = { workload, files: files.length, ok, failed, outBytes, counts: {} };
for (const [k, v] of Object.entries(globalThis.__VF__)) {
  result.counts[k] = { total: v.total, combos: v.combos, mapsObserved: Object.keys(v.combos).length };
}
if (outfile) {
  writeFileSync(outfile, JSON.stringify(result, null, 2));
}
console.log(`${workload}: files=${files.length} ok=${ok} failed=${failed} outBytes=${outBytes}`);
for (const [k, v] of Object.entries(result.counts).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${k.padEnd(24)} total=${String(v.total).padStart(8)}  mapsObserved=${v.mapsObserved}  ${JSON.stringify(v.combos)}`);
}
