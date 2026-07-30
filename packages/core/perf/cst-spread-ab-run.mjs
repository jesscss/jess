/*
 * Real-parse A/B: buildCssCstNode's conditional object SPREAD vs two explicit
 * branches producing the SAME two hidden classes.
 *
 * Both lanes are copies of the SAME built bundle in the SAME directory; only
 * the object-literal construction site differs. Separate child processes per
 * lane so neither can pollute the other's JIT feedback.
 *
 * argv: --variant=base|patched --file=<css> --samples=N
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadavg } from 'node:os';

const arg = n => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const variant = arg('variant') ?? 'base';
const file = arg('file');
const samples = Number(arg('samples') ?? 25);
const warmup = 10;

const dir = process.env.AB_DIR ?? '/tmp/jess-cst-spread-ab';
/*
 * The bundle mangles export names (parseCssCst is exported as `t`); import the
 * public `cst.js` facade instead, which re-exports the stable names.
 */
const mod = await import(pathToFileURL(`${dir}/${variant}/cst.js`).href);
const parseCssCst = mod.parseCssCst;
if (typeof parseCssCst !== 'function') {
  throw new TypeError(`no parseCssCst in ${variant}: ${Object.keys(mod)}`);
}
const src = readFileSync(file, 'utf8');

for (let i = 0; i < warmup; i++) { parseCssCst(src); }

/*
 * Wall clock AND CPU time. On a loaded machine wall-clock quantiles are charged
 * for preemption by unrelated processes, and the review of this change showed
 * wall-clock MEDIAN inverting run to run while the floor stayed stable --
 * min-only reporting hid that. `process.cpuUsage()` is not charged for
 * preemption, so it is the honest estimator here; wall clock is kept alongside
 * so the contamination stays visible rather than being asserted away.
 */
const times = [];
const cpus = [];
for (let i = 0; i < samples; i++) {
  if (globalThis.gc) { globalThis.gc(); globalThis.gc(); }
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const r = parseCssCst(src);
  const wall = performance.now() - t0;
  const c1 = process.cpuUsage(c0);
  times.push(wall);
  cpus.push((c1.user + c1.system) / 1000);
  if (!r.ok && i === 0) { console.error(`${variant}: parse NOT ok`); }
}
times.sort((a, b) => a - b);
cpus.sort((a, b) => a - b);
const med = times[times.length >> 1];
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.round((xs.length - 1) * p))];

/* Node/leaf counts prove both lanes built the same tree. */
let nodes = 0, leaves = 0, tagged = 0;
const stack = [parseCssCst(src).tree];
while (stack.length) {
  const n = stack.pop();
  if (n._tag === 'node') {
    nodes++;
    if (n.tags !== undefined) { tagged++; }
    for (const c of n.rules) { stack.push(c); }
  } else if (n._tag === 'leaf') { leaves++; }
}

const r3 = x => Math.round(x * 1000) / 1000;
console.log(JSON.stringify({
  variant,
  wall: { min: r3(times[0]), p25: r3(q(times, 0.25)), median: r3(med), p75: r3(q(times, 0.75)) },
  cpu: { min: r3(cpus[0]), p25: r3(q(cpus, 0.25)), median: r3(q(cpus, 0.5)), p75: r3(q(cpus, 0.75)) },
  samples: times.length, nodes, leaves, tagged, load: r3(loadavg()[0])
}));
