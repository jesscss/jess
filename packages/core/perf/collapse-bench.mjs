// Self-contained collapse-vs-nested render bench for the walk-minimization work.
// Generates its own synthetic nested-static stylesheet (no benchmark.less dependency).
// Usage:
//   node packages/core/perf/collapse-bench.mjs            # timing A/B
//   node --cpu-prof --cpu-prof-dir=packages/core/perf/prof \
//        packages/core/perf/collapse-bench.mjs collapse   # profile the collapse path only
import { Compiler } from '../../jess/lib/index.js';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let src = '';
for (let i = 0; i < 1500; i++) {
  src += `.block-${i} { color: #abc; padding: ${i}px; .inner { margin: ${i}px; &:hover { color: #def; } .leaf { border: ${i}px; } } }\n`;
}
const p = join(here, 'synth.less');
writeFileSync(p, src);

const mode = process.argv[2]; // 'collapse' | 'nested' | undefined (both)
async function bench(label, opts, iters) {
  const t = [];
  for (let i = 0; i < 3; i++) {
    await new Compiler().render(p, opts);
  }      // warmup
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    await new Compiler().render(p, opts);
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  console.log(`${label}: median ${t[t.length >> 1].toFixed(1)}ms (min ${t[0].toFixed(1)}, max ${t[t.length - 1].toFixed(1)})`);
}

if (mode === 'collapse') {
  await bench('collapse', { output: { collapseNesting: true } }, 40);
} else if (mode === 'nested') {
  await bench('nested', { output: { collapseNesting: false } }, 40);
} else {
  await bench('collapseNesting:true ', { output: { collapseNesting: true } }, 15);
  await bench('collapseNesting:false', { output: { collapseNesting: false } }, 15);
}
