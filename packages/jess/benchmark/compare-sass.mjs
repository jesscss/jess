// Head-to-head: dart-sass vs Jess on a matched, generated workload. Same
// warmup + N-median methodology as core/perf/bench-extend.mjs. All engines read
// their source from disk and produce a CSS string, so the paths are symmetric
// (parse + eval + serialize).
//
//   node compare-sass.mjs                    # default: jess-scss vs dart-sass
//   node compare-sass.mjs --engines=all      # full reconciliation matrix
//   node compare-sass.mjs --sequential       # old non-interleaved ordering
//   COMPONENTS=400 VARIANTS=8 node compare-sass.mjs
//   WARMUP=25 N=31 node compare-sass.mjs
//   JESS_PROFILE=1 node compare-sass.mjs     # adds jess parse/eval split
//
// dart-sass runs the plain `sass` package (Dart→JS via dart2js) — same runtime
// class as Jess, which is what people actually `npm install`.
//
// IMPORTANT — the two axes that made earlier measurements disagree:
//
//   1. WHICH JESS FRONTEND. `jess-less` compiles gen-workload.LESS through the
//      Less plugin; `jess-scss` compiles gen-workload.SCSS through the SCSS
//      plugin. They are different grammars over the same generated spec, and
//      they do NOT cost the same. Only `jess-scss` is an apples-to-apples
//      "jess-Sass+ vs dart-sass" number.
//   2. INTERLEAVING. Running each engine's full suite back to back lets the
//      first engine run on a clean heap and charges the second one the GC.
//      Interleaved (the default here) cancels that.

import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as sass from 'sass';
import { Compiler } from '../lib/index.js';
import lessPlugin from '@jesscss/plugin-less';
import scssPlugin from '@jesscss/plugin-scss';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { generate } from './gen-workload.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// `sass` does not export package.json; `sass.info` is the documented version
// surface ("dart-sass\t<version>\t(Sass Compiler)\t[Dart]").
const sassVersion = String(sass.info).split(/\s+/)[1] ?? String(sass.info);

const COMPONENTS = Number(process.env.COMPONENTS ?? 220);
const VARIANTS = Number(process.env.VARIANTS ?? 6);
const WARMUP = Number(process.env.WARMUP ?? 25);
const N = Number(process.env.N ?? 31);

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = name => argv.includes(`--${name}`);

const INTERLEAVE = !flag('sequential');

const require_ = createRequire(import.meta.url);
const bootstrapEntry = join(
  dirname(require_.resolve('bootstrap/package.json')),
  'scss',
  'bootstrap.scss'
);

// ── emit matched sources ─────────────────────────────────────────────────────
const lessSrc = generate('less', { components: COMPONENTS, variants: VARIANTS });
const scssSrc = generate('scss', { components: COMPONENTS, variants: VARIANTS });
const lessFile = join(here, 'gen-workload.less');
const scssFile = join(here, 'gen-workload.scss');
writeFileSync(lessFile, lessSrc);
writeFileSync(scssFile, scssSrc);

const median = (t) => {
  const s = [...t].sort((a, b) => a - b);
  return s[s.length >> 1];
};

// silence sass deprecation chatter so it neither pollutes output nor timing
const sassLogger = { warn() {}, debug() {} };

// ── engines ──────────────────────────────────────────────────────────────────
// Each entry is a full compile: read source → CSS string.

const jessCompiler = (plugins, output) =>
  new Compiler({ output, compile: { plugins } });

const ENGINES = {
  'jess-scss': {
    label: 'Jess (SCSS frontend)',
    api: 'Compiler.render(gen-workload.scss)',
    run: () => jessCompiler([scssPlugin()], { collapseNesting: true }).render(scssFile)
  },
  'jess-scss-nested': {
    label: 'Jess (SCSS, collapseNesting:false)',
    api: 'Compiler.render(gen-workload.scss), nested output',
    // Jess NESTED output is a first-class shape, not a flat-CSS variant. It is
    // excluded from the semantic gate: comparing nested text against dart-sass's
    // flat text is meaningless, and the flat `jess-scss` run already carries the
    // equivalence proof.
    nested: true,
    run: () => jessCompiler([scssPlugin()], { collapseNesting: false }).render(scssFile)
  },
  'jess-less': {
    label: 'Jess (Less frontend)',
    api: 'Compiler.render(gen-workload.less)',
    run: () => jessCompiler([lessPlugin(), lessCompatPlugin()], { collapseNesting: true }).render(lessFile)
  },
  'dart-sass': {
    label: 'dart-sass compile()',
    api: `sass.compile(file) — sass ${sassVersion}, sync, style:'expanded'`,
    run: async () => sass.compile(scssFile, { style: 'expanded', logger: sassLogger }).css
  },
  'dart-sass-string': {
    label: 'dart-sass compileString()',
    api: `sass.compileString(src) — sass ${sassVersion}, sync, style:'expanded'`,
    run: async () => sass.compileString(scssSrc, { style: 'expanded', logger: sassLogger }).css
  },
  // DIFFERENT FIXTURE — Bootstrap, not gen-workload. Single-engine only: Jess
  // cannot parse Bootstrap's SCSS yet (see test/scss/CORPUS-REPORT.md), so there
  // is no valid cross-engine ratio here. Run it on its own.
  'dart-sass-bootstrap': {
    label: 'dart-sass compile() [BOOTSTRAP]',
    api: `sass.compile(bootstrap/scss/bootstrap.scss) — sass ${sassVersion}, sync, style:'expanded'`,
    fixture: 'bootstrap',
    run: async () => sass.compile(bootstrapEntry, { style: 'expanded', logger: sassLogger }).css
  }
};

const selected = (() => {
  const spec = arg('engines', 'jess-scss,dart-sass');
  if (spec === 'all') {
    return Object.keys(ENGINES);
  }
  return spec.split(',').map(s => s.trim()).filter(Boolean);
})();

for (const name of selected) {
  if (!ENGINES[name]) {
    console.error(`unknown engine: ${name}\nknown: ${Object.keys(ENGINES).join(', ')}`);
    process.exit(1);
  }
}

// ── bench ────────────────────────────────────────────────────────────────────

async function warmAll() {
  for (const name of selected) {
    for (let i = 0; i < WARMUP; i++) {
      await ENGINES[name].run();
    }
  }
}

async function measure() {
  const samples = Object.fromEntries(selected.map(n => [n, []]));
  if (INTERLEAVE) {
    // one sample per engine per iteration, fixed rotation — cancels drift
    for (let i = 0; i < N; i++) {
      for (const name of selected) {
        const t0 = performance.now();
        await ENGINES[name].run();
        samples[name].push(performance.now() - t0);
      }
    }
  } else {
    for (const name of selected) {
      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        await ENGINES[name].run();
        samples[name].push(performance.now() - t0);
      }
    }
  }
  return samples;
}

// ── semantic-equivalence check ───────────────────────────────────────────────
// Owner's rule: selector-group splitting (`a,b{x}` ≡ `a{x} b{x}`), whitespace,
// and non-cascade-affecting ordering are all FINE. What matters is WHICH
// selectors carry WHICH declarations, and in what cascade order.

function flattenCss(css) {
  const out = [];
  // strip comments
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const prelude = m[1].trim();
    const body = m[2].trim();
    if (!body) {
      continue;
    }
    const decls = body
      .split(';')
      .map(d => d.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    // split selector groups so `a,b{x}` == `a{x} b{x}`
    for (const sel of prelude.split(',')) {
      const s = sel.trim().replace(/\s+/g, ' ');
      if (s) {
        out.push(`${s} :: ${decls.join('; ')}`);
      }
    }
  }
  return out;
}

function semanticDiff(aCss, bCss) {
  const a = flattenCss(aCss);
  const b = flattenCss(bCss);
  const diffs = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && diffs.length < 12; i++) {
    if (a[i] !== b[i]) {
      diffs.push({ index: i, a: a[i] ?? '(missing)', b: b[i] ?? '(missing)' });
    }
  }
  return { aRules: a.length, bRules: b.length, diffs };
}

// ── jess parse/eval split (JESS_PROFILE=1) ───────────────────────────────────
// The profile writes one `[jess-profile] {json}` line per render to stderr. We
// capture it in-process by patching console.error for the duration.

async function jessPhaseSplit(engineName) {
  if (process.env.JESS_PROFILE !== '1') {
    return null;
  }
  const lines = [];
  const orig = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.startsWith('[jess-profile]')) {
      lines.push(s.slice('[jess-profile]'.length).trim());
    } else {
      orig(...a);
    }
  };
  const phases = { getTree: [], renderAstStylesheet: [], total: [] };
  try {
    for (let i = 0; i < WARMUP; i++) {
      await ENGINES[engineName].run();
    }
    lines.length = 0;
    for (let i = 0; i < N; i++) {
      await ENGINES[engineName].run();
    }
  } finally {
    console.error = orig;
  }
  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    for (const p of rec.phases ?? []) {
      if (phases[p.phase]) {
        phases[p.phase].push(p.durationMs);
      }
    }
    if (typeof rec.totalDurationMs === 'number') {
      phases.total.push(rec.totalDurationMs);
    }
  }
  return phases;
}

// ── run ──────────────────────────────────────────────────────────────────────

console.log(
  `workload: ${COMPONENTS} components x ${VARIANTS} variants  `
  + `(less ${lessSrc.length}B / scss ${scssSrc.length}B)`
);
console.log(
  `warmup=${WARMUP} n=${N}  order=${INTERLEAVE ? 'interleaved' : 'sequential'}  `
  + `node=${process.version} sass=${sassVersion}\n`
);

// capture one output per engine for the validity gate
const outputs = {};
for (const name of selected) {
  outputs[name] = await ENGINES[name].run();
}

await warmAll();
const samples = await measure();

const rows = selected.map(name => ({
  name,
  label: ENGINES[name].label,
  api: ENGINES[name].api,
  med: median(samples[name]),
  min: Math.min(...samples[name]),
  max: Math.max(...samples[name]),
  bytes: outputs[name].length
}));

const w = Math.max(...rows.map(r => r.label.length));
for (const r of rows) {
  console.log(
    `${r.label.padEnd(w)}  median ${r.med.toFixed(1).padStart(7)}ms  `
    + `min ${r.min.toFixed(1).padStart(7)}ms  max ${r.max.toFixed(1).padStart(7)}ms  `
    + `out ${String(r.bytes).padStart(7)}B`
  );
}

console.log('\nAPI entry points:');
for (const r of rows) {
  console.log(`  ${r.label.padEnd(w)}  ${r.api}`);
}

// ratios against dart-sass, when it is in the set
const base = rows.find(r => r.name === 'dart-sass') ?? rows.find(r => r.name.startsWith('dart-sass'));
if (base) {
  console.log(`\nvs ${base.label} (median / median, and min / min):`);
  for (const r of rows) {
    if (r === base) {
      continue;
    }
    const relMed = r.med >= base.med
      ? `${(r.med / base.med).toFixed(2)}x slower`
      : `${(base.med / r.med).toFixed(2)}x faster`;
    const relMin = r.min >= base.min
      ? `${(r.min / base.min).toFixed(2)}x slower`
      : `${(base.min / r.min).toFixed(2)}x faster`;
    console.log(`  ${r.label.padEnd(w)}  ${relMed.padEnd(14)} (median)   ${relMin.padEnd(14)} (min)`);
  }
}

// validity gate: semantic equivalence, not byte identity
if (base && selected.some(n => n.startsWith('jess'))) {
  console.log('\nsemantic-equivalence check (selector-group splitting / whitespace / '
    + 'non-cascade ordering are NOT divergences):');
  for (const name of selected.filter(n => n.startsWith('jess'))) {
    const tag = `${ENGINES[name].label} vs ${base.label}`;
    if (ENGINES[name].nested) {
      console.log(`  ${tag}: SKIPPED — nested output shape, not textually comparable to flat CSS`);
      continue;
    }
    const { aRules, bRules, diffs } = semanticDiff(outputs[name], outputs[base.name]);
    if (diffs.length === 0 && aRules === bRules) {
      console.log(`  ${tag}: EQUIVALENT (${aRules} flattened rules each)`);
    } else {
      console.log(`  ${tag}: ${aRules} vs ${bRules} flattened rules, first divergences:`);
      diffs.forEach((d) => {
        console.log(`    [${d.index}] jess: ${d.a}`);
        console.log(`    [${d.index}] sass: ${d.b}`);
      });
    }
  }
}

// jess internal split
if (process.env.JESS_PROFILE === '1') {
  console.log('\njess phase split (INTERNAL INSIGHT ONLY — dart-sass has no comparable split):');
  for (const name of selected.filter(n => n.startsWith('jess'))) {
    const p = await jessPhaseSplit(name);
    if (!p) {
      continue;
    }
    const fmt = a => a.length ? `${median(a).toFixed(1)}ms (min ${Math.min(...a).toFixed(1)})` : 'n/a';
    console.log(`  ${ENGINES[name].label}`);
    console.log(`    getTree            (parse) ${fmt(p.getTree)}`);
    console.log(`    renderAstStylesheet (eval) ${fmt(p.renderAstStylesheet)}`);
    console.log(`    profile total              ${fmt(p.total)}`);
  }
}

// keep a machine-readable artifact next to the harness
writeFileSync(join(here, 'compare-sass-latest.json'), `${JSON.stringify({
  generated: new Date().toISOString(),
  node: process.version,
  sass: sassVersion,
  workload: { components: COMPONENTS, variants: VARIANTS, lessBytes: lessSrc.length, scssBytes: scssSrc.length },
  method: { warmup: WARMUP, n: N, order: INTERLEAVE ? 'interleaved' : 'sequential' },
  rows
}, null, 2)}\n`, 'utf8');
