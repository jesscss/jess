// Render benchmark.less with collapseNesting:true; report bytes+sha+median.
import { Compiler } from '../../jess/lib/index.js';
import lessPlugin from '../../jess-plugin-less/lib/index.js';
import { lessCompatPlugin } from '../../jess-plugin-less-compat/lib/index.js';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '../../jess/benchmark/benchmark.less');
const opts = () => ({ output: { collapseNesting: true }, compile: { plugins: [lessPlugin(), lessCompatPlugin()] } });
const WARMUP = Number(process.env.WARMUP ?? 12);
const N = Number(process.env.N ?? 25);
const render = async () => new Compiler(opts()).render(file);

const first = await render();
console.log(`output bytes=${first.length} sha=${createHash('sha256').update(first).digest('hex').slice(0, 16)}`);
for (let i = 0; i < WARMUP; i++) {
  await render();
}
const t = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  await render();
  t.push(performance.now() - t0);
}
t.sort((a, b) => a - b);
console.log(`render median ${t[t.length >> 1].toFixed(1)}ms (min ${t[0].toFixed(1)}, max ${t[t.length - 1].toFixed(1)}, n=${N})`);
