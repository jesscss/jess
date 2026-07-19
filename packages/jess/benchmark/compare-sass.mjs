// Head-to-head: dart-sass vs Jess (legacy tree/ eval) vs Jess (ast/ v2) on a
// matched, generated workload. Same warmup + N-median methodology as
// core/perf/bench-extend.mjs. All engines read their source from disk and
// produce a CSS string, so the paths are symmetric (parse + eval + serialize).
//
// Two Jess rows:
//   • Jess (legacy render)  — Compiler.render(): the LEGACY tree/ eval path
//     (Less plugins + legacy tree.eval/render). Still the production default.
//   • Jess (ast/ v2)        — Compiler.renderAstLess(): the engine-cutover ast/
//     path. Routes the SAME .less through @jesscss/plugin-less's
//     renderLessFileViaAst, over core's public @jesscss/core/ast-render pipeline
//     (parseToAst → serialize; grammar + inline-JS guard + builtin fn evaluator
//     injected on the consumer side, so core imports no parser and no fns).
// Both Jess rows use the SAME config cascade (prepareRender) so collapseNesting
// matches; the shas are directly comparable (same source, two engines).
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
const runJessAst = async () => {
  const c = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
  });
  return c.renderAstLess(lessFile);
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
const jessAst = await bench('Jess (ast/ v2)', runJessAst);
const dsass = await bench('dart-sass', runSass);

const row = r =>
  `${r.label.padEnd(20)} median ${r.med.toFixed(1).padStart(6)}ms  `
  + `(min ${r.min.toFixed(1)}, max ${r.max.toFixed(1)})  `
  + `out ${r.bytes}B sha=${r.sha}`;
console.log(row(jess));
console.log(row(jessAst));
console.log(row(dsass));

const rel = (a, b) => a >= b
  ? (a / b).toFixed(2) + '× slower'
  : (b / a).toFixed(2) + '× faster';
console.log(
  `\nJess legacy is ${rel(jess.med, dsass.med)} than dart-sass (median/median).`
);
console.log(
  `Jess ast/ v2 is ${rel(jessAst.med, dsass.med)} than dart-sass (median/median).`
);
console.log(
  `Jess ast/ v2 is ${rel(jessAst.med, jess.med)} than Jess legacy (median/median).`
);
console.log(
  jessAst.sha === jess.sha
    ? `ast/ output is BYTE-IDENTICAL to legacy (sha=${jessAst.sha}).`
    : `ast/ output DIFFERS from legacy (ast ${jessAst.bytes}B sha=${jessAst.sha} vs `
      + `legacy ${jess.bytes}B sha=${jess.sha}) — same source, two engines; a real diff.`
);
