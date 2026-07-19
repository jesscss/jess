// Head-to-head: dart-sass vs Jess compile→eval→serialize time on a matched,
// generated workload. Same warmup + N-median methodology as
// core/perf/bench-extend.mjs. Both engines read their source from disk and
// produce a CSS string, so the paths are symmetric (parse + eval + serialize).
//
// NOTE: Compiler.render() drives the LEGACY tree/ eval path (src/index.ts:1360),
// NOT the ast/ v2 evaluator — ast/ render is still test-only during cutover. So
// this measures Jess's *current production* path (legacy eval + Less plugins +
// Less dialect) vs dart-sass. Treat the ratio as an UPPER BOUND on the true
// engine gap; repoint at ast/ + split parse/eval/serialize to isolate it.
//
//   node compare-sass.mjs                 # default scale
//   COMPONENTS=400 VARIANTS=8 node compare-sass.mjs
//   WARMUP=15 N=31 node compare-sass.mjs
//
// dart-sass runs the plain `sass` package (Dart→JS via dart2js) — same runtime
// class as Jess, which is what people actually `npm install`.

import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as sass from 'sass';
import { Compiler } from '../lib/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { generate } from './gen-workload.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = Number(process.env.COMPONENTS ?? 220);
const VARIANTS = Number(process.env.VARIANTS ?? 6);
const WARMUP = Number(process.env.WARMUP ?? 12);
const N = Number(process.env.N ?? 25);

// ── emit matched sources ─────────────────────────────────────────────────────
const lessSrc = generate('less', { components: COMPONENTS, variants: VARIANTS });
const scssSrc = generate('scss', { components: COMPONENTS, variants: VARIANTS });
const lessFile = join(here, 'gen-workload.less');
const scssFile = join(here, 'gen-workload.scss');
writeFileSync(lessFile, lessSrc);
writeFileSync(scssFile, scssSrc);

const short = s => createHash('sha256').update(s).digest('hex').slice(0, 12);
const median = (t) => {
  t.sort((a, b) => a - b);
  return t[t.length >> 1];
};

// silence sass deprecation chatter so it neither pollutes output nor timing
const sassLogger = { warn() {}, debug() {} };

const runJess = async () => {
  const c = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
  });
  return c.render(lessFile);
};
const runSass = async () =>
  sass.compile(scssFile, { style: 'expanded', logger: sassLogger }).css;

async function bench(label, fn) {
  const first = await fn();
  for (let i = 0; i < WARMUP; i++) {
    await fn();
  }
  const t = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await fn();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return {
    label,
    med: median(t.slice()),
    min: t[0],
    max: t[t.length - 1],
    bytes: first.length,
    sha: short(first)
  };
}

console.log(
  `workload: ${COMPONENTS} components × ${VARIANTS} variants  `
  + `(less ${lessSrc.length}B / scss ${scssSrc.length}B)  warmup=${WARMUP} n=${N}\n`
);

// interleave-agnostic: run each engine's full suite; order fixed for determinism
const jess = await bench('Jess (legacy render)', runJess);
const dsass = await bench('dart-sass', runSass);

const row = r =>
  `${r.label.padEnd(20)} median ${r.med.toFixed(1).padStart(6)}ms  `
  + `(min ${r.min.toFixed(1)}, max ${r.max.toFixed(1)})  `
  + `out ${r.bytes}B sha=${r.sha}`;
console.log(row(jess));
console.log(row(dsass));

const ratio = jess.med / dsass.med;
console.log(
  `\nJess is ${ratio >= 1 ? ratio.toFixed(2) + '× slower' : (1 / ratio).toFixed(2) + '× faster'} `
  + `than dart-sass on this workload (median/median).`
);
