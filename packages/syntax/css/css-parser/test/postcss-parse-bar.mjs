#!/usr/bin/env node
/*
 * The standing stylesheet-parsing bar: `@jesscss/css-parser` versus PostCSS on
 * identical input, in one process, interleaved.
 *
 * WHY THIS EXISTS
 * ---------------
 * Grammar work has been gated per-commit against the immediately preceding
 * commit. Sub-noise results get labelled inconclusive, land, and become the new
 * reference, so gradual decay is invisible: +2% eight times is +17% nobody
 * gated. The fix is an ABSOLUTE committed baseline expressed as a RATIO against
 * an in-run comparator. A ratio cancels machine speed, so one committed number
 * is valid on a laptop and on CI; absolute milliseconds are not portable.
 * PostCSS is that comparator.
 *
 * NO HANDICAP
 * -----------
 * PostCSS's parser produces materially less structure than `parse()` does (see
 * `structuralDifference` in the emitted JSON). That is described so the number
 * is interpretable. It is NOT used to adjust, normalise, or discount the score.
 * The reported ratio is honest wall-clock on identical bytes. If Jess is
 * slower, the ratio is above 1 and that is the target to close.
 *
 * UPSTREAM
 * --------
 * The corpus and the comparator version come from postcss/benchmark, whose
 * `parsers.js` is the stylesheet-parsing benchmark this mirrors. Loading
 * `postcss` from that checkout ties the comparator to the upstream lockfile
 * instead of whatever Jess happens to develop against.
 *
 *   git clone https://github.com/postcss/benchmark.git /tmp/postcss-benchmark
 *   pnpm --dir /tmp/postcss-benchmark install --ignore-scripts
 *   pnpm --dir /tmp/postcss-benchmark exec gulp bootstrap
 *
 * RUN
 * ---
 *   pnpm --filter @jesscss/css-parser build      # measure the BUILT lib/
 *   node packages/syntax/css/css-parser/test/postcss-parse-bar.mjs \
 *     --upstream=/tmp/postcss-benchmark
 *
 *   ... --gate            compare against the committed baseline, exit 1 on breach
 *   ... --write-baseline  rewrite the baseline (requires an owner signoff, see below)
 *   ... --runs=N          fold the median across N independent processes
 *                         (default 5 when gating or baselining, 1 otherwise)
 *
 * Exit codes: 0 pass, 1 breach, 2 usage, 3 measurement too noisy to mean
 * anything (re-run; this is NOT a pass and NOT a failure of the change).
 *
 * WARMUP / ROUNDS / ITERATIONS / RUNS overridable via env.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../lib/index.js';
import { parseCssCst } from '../lib/cst.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../../..');
const baselinePath = join(here, 'postcss-parse-bar.baseline.json');

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const arg = (name) => {
  const prefix = `--${name}=`;
  const hit = argv.find(value => value.startsWith(prefix));
  return hit?.slice(prefix.length);
};

const runGate = flag('gate');
const writeBaseline = flag('write-baseline');

const upstreamRoot = resolve(
  arg('upstream')
  ?? process.env.POSTCSS_BENCHMARK_DIR
  ?? join(repoRoot, '..', 'postcss-benchmark')
);
const upstreamRequire = createRequire(join(upstreamRoot, 'package.json'));

let postcss;
try {
  postcss = upstreamRequire('postcss');
} catch (error) {
  console.error(
    `Could not load postcss from the postcss/benchmark checkout at ${upstreamRoot}.\n`
    + 'Clone https://github.com/postcss/benchmark, run pnpm install --ignore-scripts\n'
    + 'and `gulp bootstrap` there, then pass --upstream=/absolute/path.'
  );
  throw error;
}

/** Read metadata beside a resolved entry: modern packages block `pkg/package.json`. */
const packageMeta = (resolved, name) => {
  for (let directory = dirname(resolved); ; directory = dirname(directory)) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (!name || pkg.name === name) {
        return { name: pkg.name, version: pkg.version, resolved };
      }
    }
    if (directory === dirname(directory)) {
      throw new Error(`Could not locate package metadata for ${name ?? resolved}.`);
    }
  }
};

const postcssMeta = packageMeta(upstreamRequire.resolve('postcss'), 'postcss');

/**
 * parseman is the engine under the two Jess surfaces. Its resolved path and
 * version are evidence: a stale link measures a past version of the repo.
 */
const parsemanMeta = (() => {
  const link = join(here, '..', 'node_modules', 'parseman', 'package.json');
  const real = existsSync(link)
    ? execFileSync('readlink', ['-f', link], { encoding: 'utf8' }).trim()
    : null;
  if (!real) {
    throw new Error('Could not resolve parseman from @jesscss/css-parser.');
  }
  const pkg = JSON.parse(readFileSync(real, 'utf8'));
  return { name: pkg.name, version: pkg.version, resolved: dirname(real) };
})();

const gitSha = (cwd) => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
const gitDirty = (cwd) => {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim() !== '';
  } catch {
    return null;
  }
};

/* ---------------------------------------------------------------- fixtures */

const fixtures = [
  {
    /* The upstream benchmark's own corpus: twbs/bootstrap dist CSS, cached by
     * postcss/benchmark's `gulp bootstrap`. This is the input `parsers.js`
     * feeds every parser it ranks. */
    name: 'bootstrap',
    path: join(upstreamRoot, 'cache', 'bootstrap.css'),
    origin: 'postcss/benchmark cache/bootstrap.css (twbs/bootstrap dist/css/bootstrap.css)'
  },
  {
    /* In-repo control so the bar still has a case when the upstream checkout is
     * absent, and so a regression can be attributed to input shape rather than
     * to one vendor stylesheet's idiosyncrasies. */
    name: 'jess-benchmark-css',
    path: join(repoRoot, 'packages/jess/benchmark/benchmark.css'),
    origin: 'in-repo packages/jess/benchmark/benchmark.css'
  }
].filter((fixture) => {
  if (existsSync(fixture.path)) {
    return true;
  }
  console.error(`skipping fixture ${fixture.name}: ${fixture.path} not found`);
  return false;
});

if (fixtures.length === 0) {
  console.error('No fixtures available.');
  process.exit(2);
}

for (const fixture of fixtures) {
  fixture.source = readFileSync(fixture.path, 'utf8');
  fixture.bytes = Buffer.byteLength(fixture.source, 'utf8');
  fixture.sha256 = createHash('sha256').update(fixture.source).digest('hex');
}

/* ------------------------------------------------------------ measurement */

/*
 * Defaults are the configuration this bar was validated at. ITERATIONS=1 was
 * tried and rejected: a single major GC lands inside one sample and moves the
 * median by tens of percent. Amortising five parses per sample brought the
 * bootstrap AST ratio's run-to-run spread from ~30% to ~8%.
 */
const warmup = Number(process.env.WARMUP ?? 10);
const rounds = Number(process.env.ROUNDS ?? 21);
const iterations = Number(process.env.ITERATIONS ?? 5);

/*
 * A run whose identical-case disagreement exceeds this is not gate-quality: the
 * box was busy and every ratio in it is contaminated. Observed on this repo's
 * hardware: four clean runs reported 1.5-5.2%, while a fifth run on a loaded
 * machine reported 13.5% and inflated every median by ~1.8x. The guard exists
 * so a contaminated run cannot pass a gate OR be written as a baseline.
 */
const gateQualityNoiseFloorPct = Number(process.env.MAX_NOISE_FLOOR_PCT ?? 6);

/*
 * The identical-case floor measures sampling noise WITHIN one process and
 * understates variance BETWEEN processes, where JIT and GC state differ: clean
 * runs reported within-process floors of 1.5-5.2% while the same case's ratio
 * moved 12.9% across processes. Gating a single process needed a ~13% ceiling,
 * which is loose enough to swallow a real regression. Folding the median across
 * several processes (see `--runs`) is what buys this tighter floor back.
 */
const minimumTolerance = 0.08;
for (const [name, value] of [['WARMUP', warmup], ['ROUNDS', rounds], ['ITERATIONS', iterations]]) {
  if (!Number.isInteger(value) || value < (name === 'WARMUP' ? 0 : 1)) {
    console.error(`${name} must be a positive integer.`);
    process.exit(2);
  }
}

let sink = 0;
const consume = (value) => {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      sink += value.length;
    } else if ('nodes' in value && Array.isArray(value.nodes)) {
      sink += value.nodes.length;
    } else if ('tree' in value) {
      sink += value.ok === true ? 1 : 2;
    } else {
      sink += 1;
    }
  }
};

const maybeGc = () => {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
};

/**
 * Every fixture gets four surfaces. `postcss` and `postcss-control` are the
 * SAME work run as two independently sampled cases: the spread between two
 * identical cases in the same interleaved run is this machine's observed noise
 * floor, measured here rather than quoted from history.
 */
const cases = [];
for (const fixture of fixtures) {
  const from = fixture.path;
  cases.push(
    {
      key: `${fixture.name}/postcss`,
      fixture: fixture.name,
      surface: 'postcss',
      run: () => postcss.parse(fixture.source, { from }).toResult(),
      samples: []
    },
    {
      key: `${fixture.name}/postcss-control`,
      fixture: fixture.name,
      surface: 'postcss-control',
      run: () => postcss.parse(fixture.source, { from }).toResult(),
      samples: []
    },
    {
      key: `${fixture.name}/jess-ast`,
      fixture: fixture.name,
      surface: 'jess-ast',
      run: () => parse(fixture.source),
      samples: []
    },
    {
      key: `${fixture.name}/jess-cst`,
      fixture: fixture.name,
      surface: 'jess-cst',
      run: () => parseCssCst(fixture.source),
      samples: []
    }
  );
}

/* Both parsers must accept the input, or the comparison is not like-for-like. */
for (const testCase of cases) {
  try {
    consume(testCase.run());
  } catch (error) {
    console.error(`${testCase.key} could not parse the fixture: ${error.message}`);
    process.exit(1);
  }
}
for (const fixture of fixtures) {
  const cst = parseCssCst(fixture.source);
  if (cst.ok !== true) {
    console.error(`${fixture.name}: CST parse did not succeed; refusing to time a failure path.`);
    process.exit(1);
  }
}

for (const testCase of cases) {
  for (let i = 0; i < warmup; i++) {
    consume(testCase.run());
  }
}

for (let round = 0; round < rounds; round++) {
  for (let offset = 0; offset < cases.length; offset++) {
    const testCase = cases[(round + offset) % cases.length];
    maybeGc();
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      consume(testCase.run());
    }
    testCase.samples.push(Number(process.hrtime.bigint() - start) / 1e6 / iterations);
  }
}

const quantile = (sorted, q) => sorted[
  Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))
];
const round4 = value => Number(value.toFixed(4));

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  return {
    medianMs: round4(median),
    minMs: round4(sorted[0]),
    maxMs: round4(sorted[sorted.length - 1]),
    p05Ms: round4(quantile(sorted, 0.05)),
    p95Ms: round4(quantile(sorted, 0.95)),

    /* Relative half-spread p05..p95 around the median: the honest "how much of
     * a move is meaningless on this machine right now" number. */
    spreadPct: round4(((quantile(sorted, 0.95) - quantile(sorted, 0.05)) / median) * 100)
  };
};

const byKey = new Map(cases.map(testCase => [testCase.key, stats(testCase.samples)]));

const measured = [];
const noiseFloors = [];
for (const fixture of fixtures) {
  const comparator = byKey.get(`${fixture.name}/postcss`);
  const control = byKey.get(`${fixture.name}/postcss-control`);
  const controlRatio = control.medianMs / comparator.medianMs;
  const noiseFloorPct = round4(Math.abs(controlRatio - 1) * 100);
  noiseFloors.push({
    fixture: fixture.name,
    identicalCaseRatio: round4(controlRatio),
    noiseFloorPct,
    comparatorSpreadPct: comparator.spreadPct,
    controlSpreadPct: control.spreadPct
  });

  for (const surface of ['jess-ast', 'jess-cst']) {
    const surfaceStats = byKey.get(`${fixture.name}/${surface}`);
    measured.push({
      case: `${fixture.name}/${surface}`,
      fixture: fixture.name,
      surface,
      ratioVsPostcss: round4(surfaceStats.medianMs / comparator.medianMs),
      jess: surfaceStats,
      postcss: comparator,
      noiseFloorPct
    });
  }
}

/**
 * The measured noise floor for the whole run: the worst identical-case
 * disagreement observed. A change smaller than this is inconclusive, not a
 * result. Historical runs in this repo land at +/-1.4-3.6%, one investigation
 * measured +/-4.9%; a floor far outside that band means the box was busy.
 */
const observedNoiseFloorPct = round4(Math.max(...noiseFloors.map(n => n.noiseFloorPct)));

const report = {
  schema: 'jess/postcss-parse-bar@1',
  recordedAt: new Date().toISOString(),
  jess: {
    sha: gitSha(repoRoot),
    dirty: gitDirty(repoRoot),
    cssParserVersion: JSON.parse(
      readFileSync(join(here, '..', 'package.json'), 'utf8')
    ).version,
    astEntry: fileURLToPath(new URL('../lib/index.js', import.meta.url)),
    cstEntry: fileURLToPath(new URL('../lib/cst.js', import.meta.url))
  },
  engine: parsemanMeta,
  comparator: {
    ...postcssMeta,
    upstreamRoot,
    upstreamRepo: 'https://github.com/postcss/benchmark',
    upstreamCommit: gitSha(upstreamRoot),
    upstreamBenchmarkFile: 'parsers.js',
    call: 'postcss.parse(source, { from }).toResult()  // exactly upstream parsers.js\'s \'PostCSS\' case'
  },
  runtime: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    gcExposed: typeof globalThis.gc === 'function'
  },
  method: {
    warmupPerCase: warmup,
    rounds,
    iterationsPerRound: iterations,
    samplesPerCase: rounds,
    interleaved: 'A/B/A/B with a rotating start offset each round',
    inputsBuiltOnce: true,
    timed: 'parse only; file read, hashing and acceptance checks are outside the timed region'
  },
  structuralDifference: {
    statement:
      'PostCSS parses materially less structure than Jess does. This is recorded so the '
      + 'ratio is interpretable. It is NOT applied as a handicap, adjustment or asterisk.',
    postcssProduces:
      'A Root/AtRule/Rule/Declaration/Comment tree. Selectors, at-rule preludes and '
      + 'declaration values are retained as raw strings; postcss/benchmark ranks the deeper '
      + 'walk separately as "PostCSS Full" using postcss-selector-parser and postcss-value-parser.',
    jessAstProduces:
      'A canonical AST from parse(): selectors, at-rule preludes and declaration values are '
      + 'parsed into structured nodes, with source spans, in the same pass.',
    jessCstProduces:
      'A full concrete syntax tree from parseCssCst(): every token, plus trivia (whitespace '
      + 'and comments) retained in a trivia log, plus an error/expectation set.'
  },
  observedNoiseFloorPct,
  gateQualityNoiseFloorPct,
  gateQuality: observedNoiseFloorPct <= gateQualityNoiseFloorPct ? 'usable' : 'contaminated',
  noiseFloors,
  fixtures: fixtures.map(({ name, path, origin, bytes, sha256 }) => ({
    name, path, origin, bytes, sha256
  })),
  results: measured,
  sink
};

/* ------------------------------------------------------ across-process fold */

/*
 * One process is not a measurement. The identical-case floor inside a process
 * lands at 1-5%, but the SAME case's ratio moved 12.9% across eight clean
 * processes here — JIT tier-up and heap state differ per process, and a
 * single-process baseline is fragile enough that the gate went red with no
 * source change at all. Widening the ceiling to absorb that would be exactly
 * the drift-laundering this gate exists to prevent, so the fix is to make the
 * number stable instead: gate and baseline runs fold the median across several
 * independent processes.
 */
const isChild = process.env.JESS_BAR_CHILD === '1';
const defaultRuns = (runGate || writeBaseline) ? 5 : 1;
const runs = isChild ? 1 : Number(arg('runs') ?? process.env.RUNS ?? defaultRuns);
if (!Number.isInteger(runs) || runs < 1) {
  console.error('--runs must be a positive integer.');
  process.exit(2);
}

const reports = [report];
if (runs > 1) {
  const childArgv = argv.filter(
    value => value !== '--gate' && value !== '--write-baseline' && !value.startsWith('--runs=')
  );
  for (let i = 1; i < runs; i++) {
    const child = execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...childArgv], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
      env: { ...process.env, JESS_BAR_CHILD: '1' }
    });
    reports.push(JSON.parse(child));
  }
}

const medianOf = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

/* Fold: the gated number is the median ACROSS processes, per named case. */
const folded = measured.map((result) => {
  const ratios = reports.map(
    entry => entry.results.find(other => other.case === result.case).ratioVsPostcss
  );
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = medianOf(ratios);
  return {
    case: result.case,
    fixture: result.fixture,
    surface: result.surface,
    ratioVsPostcss: round4(median),
    perProcessRatios: ratios.map(round4),
    betweenProcessSpreadPct: round4(((sorted[sorted.length - 1] - sorted[0]) / median) * 100),
    jessMedianMs: result.jess.medianMs,
    postcssMedianMs: result.postcss.medianMs
  };
});
const foldedNoiseFloorPct = round4(medianOf(reports.map(entry => entry.observedNoiseFloorPct)));
const worstBetweenProcessSpreadPct = round4(
  Math.max(...folded.map(result => result.betweenProcessSpreadPct))
);

report.processes = runs;
report.fold = runs > 1
  ? {
      note: 'ratioVsPostcss in foldedResults is the median across `processes` independent runs.',
      foldedNoiseFloorPct,
      worstBetweenProcessSpreadPct
    }
  : { note: 'single process; foldedResults equals results. Not gate-quality on its own.' };
report.foldedResults = folded;

/* --------------------------------------------------------------- baseline */

const baselineShape = () => ({
  schema: 'jess/postcss-parse-bar-baseline@1',
  policy: {
    rule:
      'These ceilings are an ABSOLUTE bar, not a rolling reference. A run whose '
      + 'ratioVsPostcss exceeds maxRatioVsPostcss fails the gate. Raising a ceiling is a '
      + 'REBASELINE and requires the owner to say so: it is not something an agent decides '
      + 'because the gate is red. Lowering a ceiling after a real win is always welcome.',
    rebaselineRequires:
      'Owner sign-off, recorded verbatim in ownerSignoff below, in the same commit as the '
      + 'changed numbers, so the diff shows who authorised the loosening and why. A gate run '
      + 'ignores ownerSignoff entirely; it exists to make an unauthorised rebaseline visible '
      + 'in review.',
    toleranceRationale:
      'maxRatioVsPostcss = recorded ratio x (1 + toleranceFraction). Both the recorded ratio '
      + 'and a gate run\'s ratio are medians across `processes` independent processes, which is '
      + 'what makes a tolerance this tight survivable: a single process moved the same case '
      + `12.9% here with no source change. toleranceFraction is floored at ${minimumTolerance} `
      + 'and otherwise tracks the measured noise. Do not widen it to clear a red gate — that is '
      + 'the drift-laundering this gate exists to prevent.'
  },
  ownerSignoff: null,
  recordedOn: {
    sha: report.jess.sha,
    dirty: report.jess.dirty,
    recordedAt: report.recordedAt,
    node: report.runtime.node,
    platform: report.runtime.platform,
    parseman: `${parsemanMeta.name}@${parsemanMeta.version}`,
    postcss: `${postcssMeta.name}@${postcssMeta.version}`,
    upstreamCommit: report.comparator.upstreamCommit,
    processes: runs,
    foldedNoiseFloorPct,
    worstBetweenProcessSpreadPct
  },
  toleranceFraction: round4(Math.max(minimumTolerance, foldedNoiseFloorPct / 100)),
  fixtures: Object.fromEntries(fixtures.map(f => [f.name, { bytes: f.bytes, sha256: f.sha256 }])),
  cases: Object.fromEntries(folded.map(result => [
    result.case,
    {
      recordedRatioVsPostcss: result.ratioVsPostcss,
      perProcessRatios: result.perProcessRatios,
      maxRatioVsPostcss: round4(
        result.ratioVsPostcss * (1 + Math.max(minimumTolerance, foldedNoiseFloorPct / 100))
      )
    }
  ]))
});

/*
 * A contaminated run must be able to neither pass a gate nor become a baseline.
 * Exit 3 distinguishes "unusable measurement" from "real breach" (1) so a CI
 * wiring can retry rather than fail a change.
 */
const gateQualityFailure = foldedNoiseFloorPct > gateQualityNoiseFloorPct
  ? `Measured noise floor ${foldedNoiseFloorPct}% exceeds the gate-quality limit of `
  + `${gateQualityNoiseFloorPct}%. Two identical PostCSS cases disagreed by that much, `
  + 'so every ratio here is contaminated. This is not a result. Re-run on an idle machine.'
  : null;

if ((writeBaseline || runGate) && gateQualityFailure) {
  console.error(gateQualityFailure);
  console.log(JSON.stringify(report, null, 2));
  process.exit(3);
}

if (writeBaseline) {
  const signoff = process.env.JESS_BAR_OWNER_SIGNOFF?.trim();
  if (!signoff) {
    console.error(
      'Refusing to write the baseline without an owner sign-off.\n'
      + 'Set JESS_BAR_OWNER_SIGNOFF to the owner\'s verbatim authorisation, e.g.\n'
      + '  JESS_BAR_OWNER_SIGNOFF="matthew: accepting 1.9x on jess-ast while X lands" \\\n'
      + '    node .../postcss-parse-bar.mjs --write-baseline\n'
      + 'It is recorded in the file so the loosening is visible in review.'
    );
    process.exit(2);
  }
  const next = baselineShape();
  next.ownerSignoff = signoff;
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.error(`wrote ${baselinePath}`);
}

if (runGate) {
  if (!existsSync(baselinePath)) {
    console.error(`No baseline at ${baselinePath}. Record one with --write-baseline.`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const failures = [];
  const notes = [];

  for (const [name, pinned] of Object.entries(baseline.fixtures)) {
    const actual = fixtures.find(f => f.name === name);
    if (!actual) {
      failures.push(`fixture ${name} is in the baseline but was not measured (upstream checkout missing?)`);
    } else if (actual.sha256 !== pinned.sha256) {
      failures.push(
        `fixture ${name} changed: baseline sha256 ${pinned.sha256} (${pinned.bytes} bytes), `
        + `measured ${actual.sha256} (${actual.bytes} bytes). The corpus is part of the bar; `
        + 'a changed corpus invalidates the committed ratios.'
      );
    }
  }

  for (const [name, pinned] of Object.entries(baseline.cases)) {
    const actual = folded.find(result => result.case === name);
    if (!actual) {
      failures.push(`case ${name} is in the baseline but was not measured`);
      continue;
    }
    const delta = (actual.ratioVsPostcss / pinned.recordedRatioVsPostcss - 1) * 100;
    const line = `${name}: ratio ${actual.ratioVsPostcss} vs recorded `
      + `${pinned.recordedRatioVsPostcss} (ceiling ${pinned.maxRatioVsPostcss}), `
      + `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%, `
      + `between-process spread ${actual.betweenProcessSpreadPct}%`;
    if (actual.ratioVsPostcss > pinned.maxRatioVsPostcss) {
      failures.push(`${line} — BREACH`);
    } else if (Math.abs(delta) <= foldedNoiseFloorPct) {
      notes.push(`${line} — within the measured noise floor (${foldedNoiseFloorPct}%), inconclusive`);
    } else {
      notes.push(line);
    }
  }

  console.error(
    `processes: ${runs}, folded noise floor: ${foldedNoiseFloorPct}%, `
    + `worst between-process spread: ${worstBetweenProcessSpreadPct}%`
  );
  for (const note of notes) {
    console.error(`  ok   ${note}`);
  }
  for (const failure of failures) {
    console.error(`  FAIL ${failure}`);
  }
  if (failures.length > 0) {
    console.error(
      '\nThe bar is an absolute ceiling. Fix the regression, or obtain owner sign-off and '
      + 'rebaseline with --write-baseline.'
    );
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

console.log(JSON.stringify(report, null, 2));
