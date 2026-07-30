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

const times = [];
for (let i = 0; i < samples; i++) {
  if (globalThis.gc) { globalThis.gc(); globalThis.gc(); }
  const t0 = performance.now();
  const r = parseCssCst(src);
  times.push(performance.now() - t0);
  if (!r.ok && i === 0) { console.error(`${variant}: parse NOT ok`); }
}
times.sort((a, b) => a - b);
const med = times[times.length >> 1];

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

console.log(JSON.stringify({
  variant, median: med, min: times[0], p75: times[Math.floor(times.length * 0.75)],
  samples: times.length, nodes, leaves, tagged, load: loadavg()[0]
}));
