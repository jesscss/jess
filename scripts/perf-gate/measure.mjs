/**
 * Paired in-process measurement for the perf drift gate, plus the build
 * verification that has to happen before any number is believed.
 *
 * THE ROUND STRUCTURE IS THE WHOLE DESIGN
 * ---------------------------------------
 * One round measures jess and the comparator ADJACENTLY over the identical
 * source array, and the pair is reduced to one observation before anything is
 * aggregated. Rounds alternate A-B / B-A (counterbalanced), so the residual
 * first-order drift that survives pairing cancels across rounds instead of
 * accumulating into the estimate.
 *
 * This is not the same thing as "interleaving the samples". Interleaved samples
 * still get summarised as median(A) vs median(B), which under a monotone drift
 * compares two different regions of the drift curve. Here the ratio is formed
 * INSIDE the round, where the machine state is shared.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { createRequire } from 'node:module';

/**
 * Gated cases: dialect x surface x corpus. Named cases only — never one
 * aggregate number, which cannot distinguish "nothing moved" from "one case got
 * faster and another got slower".
 */
export const CASES = {
  'css/ast/css-corpus': {
    dialect: 'css',
    comparator: 'postcss',
    corpus: { dir: 'packages/syntax/css/css-parser/test/css', ext: '.css', recursive: false },
    jess: { pkg: 'packages/syntax/css/css-parser', module: 'lib/index.js', fn: 'parse' }
  },
  'css/ast/test-data': {
    dialect: 'css',
    comparator: 'postcss',
    corpus: { dir: 'node_modules/@less/test-data/tests-unit', ext: '.css', recursive: true },
    jess: { pkg: 'packages/syntax/css/css-parser', module: 'lib/index.js', fn: 'parse' }
  },
  'less/ast/benchmark': {
    dialect: 'less',
    comparator: 'lessc',
    corpus: { files: ['packages/jess/benchmark/benchmark.less'] },
    jess: { pkg: 'packages/syntax/less/less-parser', module: 'lib/index.js', fn: 'parse' }
  },
  'less/ast/test-data': {
    dialect: 'less',
    comparator: 'lessc',
    corpus: { dir: 'node_modules/@less/test-data/tests-unit', ext: '.less', recursive: true },
    jess: { pkg: 'packages/syntax/less/less-parser', module: 'lib/index.js', fn: 'parse' }
  },

  /*
   * scss and jess were absent from this table entirely until 2026-07-31, which
   * meant every scss and jess grammar commit in the project's history was graded
   * by a gate that had no case for its dialect. The tiering in `index.mjs`
   * selects cases by `spec.dialect`, so a touched `scss/.../grammar.ts` selected
   * the empty set and the run reported a pass over nothing.
   *
   * Both cases run the SHARED CSS CORPUS rather than dialect-native fixtures.
   * That is deliberate and it is the only corpus available: valid CSS is valid
   * in every dialect (project invariant), the corpus is committed, and the
   * dialect parsers must all accept it. There are ZERO committed `.scss` files
   * in this repo -- the scss suite downloads sass-spec into a gitignored
   * `.cache/`, which cannot back a gate that has to run on a fresh clone.
   */
  'scss/ast/css-corpus': {
    dialect: 'scss',
    comparator: 'dartSass',
    corpus: { dir: 'packages/syntax/css/css-parser/test/css', ext: '.css', recursive: false },
    jess: { pkg: 'packages/syntax/scss/scss-parser', module: 'lib/index.js', fn: 'parse' }
  },
  'jess/ast/css-corpus': {
    dialect: 'jess',
    comparator: 'postcss',
    corpus: { dir: 'packages/syntax/css/css-parser/test/css', ext: '.css', recursive: false },
    jess: { pkg: 'packages/syntax/jess/jess-parser', module: 'lib/index.js', fn: 'parse' }
  },
  'jess/ast/jess-fixtures': {
    dialect: 'jess',
    comparator: 'postcss',
    corpus: { dir: 'packages/syntax/jess/jess-parser/test/data', ext: '.jess', recursive: false },
    jess: { pkg: 'packages/syntax/jess/jess-parser', module: 'lib/index.js', fn: 'parse' }
  }
};

/**
 * A case table that cannot lose a dialect silently.
 *
 * `index.mjs` selects cases by `spec.dialect`. If a dialect has no case, a
 * commit touching that dialect's grammar selects the empty set and the run is
 * graded over nothing. That is exactly how scss and jess went ungated. Asserting
 * the covered set here makes deleting or renaming a case a loud failure instead
 * of a silent coverage hole.
 */
export const GATED_DIALECTS = ['css', 'less', 'scss', 'jess'];

export function assertDialectCoverage(cases = CASES) {
  const covered = new Set(Object.values(cases).map(c => c.dialect));
  const missing = GATED_DIALECTS.filter(d => !covered.has(d));
  if (missing.length > 0) {
    throw new Error(
      `perf-gate case table has no case for dialect(s): ${missing.join(', ')}. `
      + 'A dialect with no case is graded over the empty set and reports a pass over nothing.'
    );
  }
  return { covered: [...covered].sort() };
}

function walk(dir, ext, recursive, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((x, y) => (x.name < y.name ? -1 : 1))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive) {
        walk(p, ext, recursive, out);
      }
    } else if (extname(e.name) === ext) {
      out.push(p);
    }
  }
  return out;
}

export function loadCorpus(repoRoot, corpus) {
  const files = corpus.files
    ? corpus.files.map(f => resolve(repoRoot, f)).filter(f => existsSync(f))
    : walk(resolve(repoRoot, corpus.dir), corpus.ext, corpus.recursive);
  const sources = [];
  for (const f of files) {
    try {
      sources.push(readFileSync(f, 'utf8'));
    } catch { /* absent */ }
  }
  return { files: files.length, sources, bytes: sources.reduce((n, s) => n + Buffer.byteLength(s), 0) };
}

/**
 * Prove the build actually happened.
 *
 * A worktree without `node_modules` has been observed to make
 * `pnpm run build:release` EXIT 0 WHILE EVERY PACKAGE FAILS. A gate that
 * measures a phantom build is worse than useless: it reports confident numbers
 * for a stale artifact, which is precisely the failure mode this whole effort
 * exists to prevent. So the artifact is checked directly, and its freshness
 * relative to source is checked too — a zero exit code is not accepted as
 * evidence of anything.
 */
export function verifyBuild(repoRoot, pkgDir) {
  const problems = [];
  const root = resolve(repoRoot, pkgDir);

  if (!existsSync(resolve(repoRoot, 'node_modules'))) {
    problems.push('repo root has no node_modules; a build here can exit 0 with every package failing');
  }

  const lib = resolve(root, 'lib');
  if (!existsSync(lib)) {
    problems.push(`${pkgDir}/lib does not exist: the package was never built`);
    return { ok: false, problems };
  }

  const built = walk(lib, '.js', true);
  if (built.length === 0) {
    problems.push(`${pkgDir}/lib contains no .js artifacts`);
    return { ok: false, problems };
  }

  const src = resolve(root, 'src');
  const newestSrc = walk(src, '.ts', true).reduce((n, f) => Math.max(n, statSync(f).mtimeMs), 0);
  const newestLib = built.reduce((n, f) => Math.max(n, statSync(f).mtimeMs), 0);
  if (newestSrc > newestLib) {
    problems.push(
      `${pkgDir}/lib is STALE: newest src is ${new Date(newestSrc).toISOString()} but newest lib is `
      + `${new Date(newestLib).toISOString()}. Rebuild before measuring.`
    );
  }

  return { ok: problems.length === 0, problems, artifacts: built.length, newestLib, newestSrc };
}

/** Resolved parseman path + version, reported as evidence alongside every number. */
export function parsemanEvidence(repoRoot) {
  try {
    const require = createRequire(join(repoRoot, 'noop.js'));
    const resolved = require.resolve('parseman');

    /*
     * `parseman/package.json` is not an exported subpath, so walk up from the
     * resolved artifact instead. Reporting the RESOLVED PATH matters as much as
     * the version: a stale `link:` or a parent-directory node_modules fails
     * silently and cleanly, and the number would be measured against the wrong
     * library with nothing in the output to show it.
     */
    let dir = resolve(resolved, '..');
    for (let i = 0; i < 6; i++) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        return { resolved, version: JSON.parse(readFileSync(candidate, 'utf8')).version };
      }
      dir = resolve(dir, '..');
    }
    return { resolved, version: 'unknown' };
  } catch (error) {
    return { resolved: null, version: null, error: error.message };
  }
}

async function loadJessParser(repoRoot, spec) {
  const file = resolve(repoRoot, spec.pkg, spec.module);
  const mod = await import(`file://${file}`);
  const fn = mod[spec.fn];
  if (typeof fn !== 'function') {
    throw new Error(`${spec.pkg}/${spec.module} does not export ${spec.fn}()`);
  }
  return fn;
}

function timeOnce(fn, sources) {
  const t = process.hrtime.bigint();
  for (const s of sources) {
    try {
      fn(s);
    } catch { /* deliberate corpus errors are part of the workload */ }
  }
  return Number(process.hrtime.bigint() - t) / 1e6;
}

/**
 * Prove both sides actually do the work before timing either of them.
 *
 * The timed loop swallows per-source errors on purpose, because the corpora
 * deliberately contain invalid stylesheets and rejecting them IS part of the
 * workload. That tolerance is also a trapdoor: a comparator that throws on
 * EVERY input still produces a plausible-looking number, and the gate would
 * then report a confident ratio measuring nothing but exception cost.
 *
 * This is not hypothetical. It happened while building this gate: a wrong
 * lessc entry point threw on all 25 rounds and the harness cheerfully reported
 * `ratio 2.936x CI95 [2.435, 3.540]`. A confident number the workload cannot
 * support is precisely the failure this gate exists to prevent, so the success
 * rate of both sides is now measured, reported, and enforced.
 */
export function validateWorkload(jessFn, comparatorFn, sources) {
  const tally = (fn) => {
    let ok = 0;
    let firstError = null;
    for (const s of sources) {
      try {
        fn(s);
        ok++;
      } catch (error) {
        firstError ??= error;
      }
    }
    return { ok, total: sources.length, rate: ok / sources.length, firstError };
  };

  const jess = tally(jessFn);
  const comparator = tally(comparatorFn);
  const problems = [];

  /*
   * A corpus is allowed to contain invalid input, but if a side parses almost
   * nothing it is not doing the work the ratio claims to compare.
   */
  if (comparator.rate < 0.5) {
    problems.push(
      `comparator parsed only ${comparator.ok}/${comparator.total} sources `
      + `(${(comparator.rate * 100).toFixed(0)}%). The ratio would measure error handling, not parsing. `
      + `First error: ${comparator.firstError?.message ?? 'unknown'}`
    );
  }
  if (jess.rate < 0.5) {
    problems.push(
      `jess parsed only ${jess.ok}/${jess.total} sources (${(jess.rate * 100).toFixed(0)}%). `
      + `First error: ${jess.firstError?.message ?? 'unknown'}`
    );
  }

  return { ok: problems.length === 0, problems, jess, comparator };
}

/**
 * Run one case. Returns paired round timings for `stats.pairedRatio`.
 *
 * Both sides are warmed to steady state before any timed round, because the
 * warmup region is where the worst drift lives (an observed sweep ran
 * 1.067 -> 1.012 -> 1.105 -> 1.114 -> 1.516 ms). Warmup does not remove drift,
 * it only removes the steepest part; pairing handles the rest.
 */
export async function runCase({ repoRoot, caseName, warmup = 8, rounds = 25, comparatorLoader }) {
  const spec = CASES[caseName];
  if (!spec) {
    throw new Error(`unknown case '${caseName}'`);
  }

  const build = verifyBuild(repoRoot, spec.jess.pkg);
  if (!build.ok) {
    return { caseName, spec, build, skipped: 'BUILD_UNVERIFIED' };
  }

  const { files, sources, bytes } = loadCorpus(repoRoot, spec.corpus);
  if (sources.length === 0) {
    return { caseName, spec, build, skipped: 'CORPUS_EMPTY' };
  }

  const jessFn = await loadJessParser(repoRoot, spec.jess);
  const comparatorFn = await comparatorLoader();

  const validation = validateWorkload(jessFn, comparatorFn, sources);
  if (!validation.ok) {
    return { caseName, spec, build, validation, skipped: 'WORKLOAD_INVALID' };
  }

  for (let i = 0; i < warmup; i++) {
    timeOnce(jessFn, sources);
    timeOnce(comparatorFn, sources);
  }

  const pairs = [];
  for (let r = 0; r < rounds; r++) {
    /*
     * Counterbalanced: half the rounds measure the comparator first, so any
     * within-round ordering advantage cancels instead of biasing the ratio.
     */
    if (r % 2 === 0) {
      const a = timeOnce(jessFn, sources);
      const b = timeOnce(comparatorFn, sources);
      pairs.push({ a, b });
    } else {
      const b = timeOnce(comparatorFn, sources);
      const a = timeOnce(jessFn, sources);
      pairs.push({ a, b });
    }
  }

  return {
    caseName, spec, build, validation, files, bytes,
    kb: +(bytes / 1024).toFixed(1), rounds, warmup, pairs
  };
}
