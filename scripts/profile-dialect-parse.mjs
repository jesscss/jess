/**
 * Per-dialect parse driver for `--cpu-prof` per-rule CPU attribution.
 *
 * ONE process = ONE dialect, both surfaces (AST and CST) driven from distinct
 * call-tree entry points so `scripts/analyze-surface-profile.mjs` can split the
 * sample tree by ancestor. Running both surfaces in one process removes the
 * cross-process bias that a separate AST run and CST run would carry.
 *
 * The default workload is PURE CSS (postcss/benchmark's bootstrap.css plus the
 * same 100 nested-rule repeats the `postcss-preprocessors.mjs` harness appends).
 * Valid CSS is valid in every dialect, so the four dialects parse byte-identical
 * input and any per-rule difference is a dialect delta, not a corpus delta.
 *
 *   node --cpu-prof --cpu-prof-dir=<dir> scripts/profile-dialect-parse.mjs \
 *     --dialect=css --upstream=/tmp/postcss-benchmark
 *
 * Env: WARMUP (default 10), N (default 60), SURFACES (default "ast,cst").
 * Read-only; not part of the build.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const prefix = `--${name}=`;
  const hit = argv.find(value => value.startsWith(prefix));
  return hit?.slice(prefix.length);
};

const dialect = arg('dialect') ?? 'css';
const workload = arg('workload') ?? 'css';
const upstreamRoot = resolve(
  arg('upstream') ?? process.env.POSTCSS_BENCHMARK_DIR ?? '/tmp/postcss-benchmark'
);

const PARSERS = {
  css: { dir: 'packages/syntax/css/css-parser', cst: 'parseCssCst' },
  less: { dir: 'packages/syntax/less/less-parser', cst: 'parseLessCst' },
  scss: { dir: 'packages/syntax/scss/scss-parser', cst: 'parseScssCst' },
  jess: { dir: 'packages/syntax/jess/jess-parser', cst: 'parseJessCst' }
};
const parser = PARSERS[dialect];
if (!parser) {
  throw new TypeError(`--dialect must be one of: ${Object.keys(PARSERS).join(', ')}`);
}

const bootstrapFile = join(upstreamRoot, 'cache', 'bootstrap.css');
if (!existsSync(bootstrapFile)) {
  throw new Error(`Missing ${bootstrapFile}; pass --upstream=/path/to/postcss-benchmark.`);
}

// Same normalisation the postcss-preprocessors harness applies.
const rawCss = readFileSync(bootstrapFile, 'utf8')
  .replace(/\s+filter:[^;}]+;?/g, '')
  .replace('/*# sourceMappingURL=bootstrap.css.map */', '');

/*
 * The `.jess` parser cannot parse `calc()` with a `+`, `-` or `*` operand
 * (`calc(1rem + 1vw)` -> `Expected: ")"`; `calc(100%/3)` and `min()` are fine).
 * Profiling a throwing parse would attribute samples to the failure path, so the
 * 134 `calc(...)` sites are folded away for EVERY dialect, keeping the workload
 * byte-identical across the four. Remove this once the Jess grammar accepts them.
 */
/** Replace every `calc(...)` — paren-balanced, so nested `var()` is folded too. */
const foldCalc = (text) => {
  let out = '';
  let index = 0;
  let folded = 0;
  for (;;) {
    const start = text.indexOf('calc(', index);
    if (start < 0) {
      out += text.slice(index);
      return { text: out, folded };
    }
    out += text.slice(index, start);
    let depth = 0;
    let cursor = start + 4;
    for (; cursor < text.length; cursor++) {
      const char = text[cursor];
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    out += '1rem';
    folded++;
    index = cursor + 1;
  }
};
const { text: css, folded: calcSitesFolded } = foldCalc(rawCss);

/** Pure-CSS workload: identical bytes for every dialect. */
const buildCssSource = () => {
  let source = `${css}\n`;
  for (let i = 0; i < 100; i++) {
    source += '\nbody { h1 { a { color: black; } } }\n';
    source += 'h2 { width: 100px; }\n';
    source += '.search { fill: black; }\n';
  }
  return source;
};

/** Dialect-native workload: the same base CSS plus that dialect's own overlay constructs. */
const buildNativeSource = () => {
  if (dialect === 'css') {
    return buildCssSource();
  }
  if (dialect === 'less') {
    let source = css.replace(/--[-\w]+:\s*;/g, '');
    source += '\n@size: 100px;\n.icon() { width: 16px; height: 16px; }\n';
    for (let i = 0; i < 100; i++) {
      source += '\nbody { h1 { a { color: black; } } }\n';
      source += 'h2 { width: @size; }\n';
      source += '.search { fill: black; .icon(); }\n';
    }
    return source;
  }
  if (dialect === 'scss') {
    let source = `${css}\n$size: 100px;\n@mixin icon { width: 16px; height: 16px; }\n`;
    for (let i = 0; i < 100; i++) {
      source += '\nbody { h1 { a { color: black; } } }\n';
      source += 'h2 { width: $size; }\n';
      source += '.search { fill: black; @include icon; }\n';
    }
    return source;
  }
  let source = `${css}\n$size: 100px;\n.icon() { width: 16px; height: 16px; }\n`;
  for (let i = 0; i < 100; i++) {
    source += '\nbody { h1 { a { color: black; } } }\n';
    source += 'h2 { width: $size; }\n';
    source += '.search { fill: black; .icon(); }\n';
  }
  return source;
};

const source = workload === 'native' ? buildNativeSource() : buildCssSource();

const indexUrl = new URL(`../${parser.dir}/lib/index.js`, import.meta.url);
const cstUrl = new URL(`../${parser.dir}/lib/cst.js`, import.meta.url);
const { parse } = await import(indexUrl.href);
const cstModule = await import(cstUrl.href);
const parseCstFn = cstModule[parser.cst];
if (typeof parse !== 'function' || typeof parseCstFn !== 'function') {
  throw new TypeError(`${dialect}: missing parse/${parser.cst} in built lib/.`);
}

/**
 * Distinct named entry points. The profile's call tree is split on these two
 * frames, so keep the names stable — the analysis script matches them.
 */
function astSurfaceEntry(text) {
  return parse(text);
}
function cstSurfaceEntry(text) {
  return parseCstFn(text);
}

const surfaces = (process.env.SURFACES ?? 'ast,cst')
  .split(',')
  .map(name => name.trim())
  .filter(Boolean);
const warmup = Number(process.env.WARMUP ?? 10);
const sampleCount = Number(process.env.N ?? 60);
if (!Number.isInteger(warmup) || warmup < 0 || !Number.isInteger(sampleCount) || sampleCount < 1) {
  throw new TypeError('WARMUP must be >= 0 and N must be >= 1.');
}

const runners = {
  ast: astSurfaceEntry,
  cst: cstSurfaceEntry
};
for (const name of surfaces) {
  if (!runners[name]) {
    throw new TypeError(`SURFACES entries must be ast or cst; got ${name}`);
  }
}

/*
 * Correctness gate: a dialect that silently fails to parse the workload would
 * profile its error path instead of its parse path.
 */
const health = {};
for (const name of surfaces) {
  if (name === 'ast') {
    const tree = astSurfaceEntry(source);
    health.ast = { ok: Boolean(tree), rootChildren: tree?.value?.length ?? tree?.rules?.length ?? null };
  } else {
    const result = cstSurfaceEntry(source);
    health.cst = {
      ok: result.ok,
      errors: result.errors?.length ?? null,
      unconsumedFrom: result.unconsumedFrom
    };
    if (!result.ok || result.unconsumedFrom !== null) {
      throw new Error(
        `${dialect}/cst did not fully consume the workload `
        + `(ok=${result.ok}, unconsumedFrom=${result.unconsumedFrom}).`
      );
    }
  }
}

for (const name of surfaces) {
  for (let i = 0; i < warmup; i++) {
    runners[name](source);
  }
}

const timings = Object.fromEntries(surfaces.map(name => [name, []]));
for (let round = 0; round < sampleCount; round++) {
  for (let offset = 0; offset < surfaces.length; offset++) {
    const name = surfaces[(round + offset) % surfaces.length];
    const start = performance.now();
    runners[name](source);
    timings[name].push(performance.now() - start);
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

console.log(JSON.stringify({
  dialect,
  workload,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  sourceBytes: Buffer.byteLength(source),
  calcSitesFolded,
  warmup,
  n: sampleCount,
  health,
  medianMs: Object.fromEntries(
    surfaces.map(name => [name, Number(median(timings[name]).toFixed(3))])
  )
}, null, 2));
