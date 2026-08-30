#!/usr/bin/env node
/**
 * In-process jess-vs-comparator RATIO. This is the PRIMARY quantity of the A/B
 * harness; absolute milliseconds are context.
 *
 * WHY A RATIO IS THE ONLY WORKTREE-BIAS-IMMUNE NUMBER
 * ---------------------------------------------------
 * Cross-worktree bias (path, inode locality, page-cache state, `node_modules`
 * layout) is a constant multiplier/offset attached to a SIDE. Interleaving cannot
 * remove it, because it is present in every sample of that side equally. But when
 * jess and its comparator are measured in the SAME worktree, in the SAME process,
 * over the SAME in-memory sources, that per-side cost lands on numerator and
 * denominator alike and DIVIDES OUT. The ratio is therefore portable across
 * worktrees and across machines; the milliseconds are not.
 *
 * It is also the same axis as the standing project goal — Less alpha reaching
 * `lessc` 4.x parse performance — so the gate number and the goal number are one
 * number rather than two that have to be reconciled.
 *
 * COMPARATOR PER DIALECT
 * ----------------------
 *   less -> `lessc` 4.x (`less@4.6.3`), implemented here.
 *   css  -> PostCSS. NOT implemented here on purpose. `postcss-oracle.mjs --bench`
 *           already measures `@jesscss/css-parser` against PostCSS in one process
 *           on identical input, and the PostCSS comparator bar is being
 *           established separately. Duplicating it would produce a second,
 *           disagreeing CSS number. Use that script; this one delegates.
 *   scss -> dart-sass (`sass@1.101.0`). Seam left open, not wired.
 *
 * A NOTE THE NUMBER NEEDS TO BE READ CORRECTLY
 * --------------------------------------------
 * jess builds more structure than `lessc`'s parser does, and much more than
 * PostCSS does. That difference is described so the ratio is interpretable — it is
 * never used to adjust the ratio. There is no structure-adjusted score here.
 *
 * USAGE
 *   node scripts/perf-ab/ratio-probe.mjs --dialect less [--case benchmark.less] [--warmup 5] [--timed 15]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { median, quantile } from './stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/**
 * `--root` lets ONE copy of this script measure ANY worktree. That matters because
 * B is parked on an old commit that predates this harness and therefore does not
 * contain it — and because B must stay pristine, so copying the script in is not
 * an option. Everything (corpus, comparator, built `lib/`) is resolved from the
 * target root, so the measurement is entirely of that worktree even though the
 * code executing came from A.
 */
const ROOT = resolve(arg('--root', resolve(HERE, '../..')));

function findFiles(dir, pattern, maxdepth) {
  const args = ['-L', resolve(ROOT, dir)];
  if (maxdepth) {
    args.push('-maxdepth', String(maxdepth));
  }
  args.push('-type', 'f', '-name', pattern);
  try {
    return execFileSync('find', args, { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean).sort();
  } catch {
    return [];
  }
}

const LESS_CASES = {
  'benchmark.less': () => [resolve(ROOT, 'packages/jess/benchmark/benchmark.less')],
  'test-data-unit': () => findFiles('node_modules/@less/test-data/tests-unit', '*.less')
};

async function runLess() {
  const caseName = arg('--case', 'benchmark.less');
  const warmup = Number(arg('--warmup', '5'));
  const timed = Number(arg('--timed', '15'));

  const files = (LESS_CASES[caseName] ?? LESS_CASES['benchmark.less'])();
  if (files.length === 0) {
    console.error(`case '${caseName}' resolved to ZERO files — corpus missing. Refusing to emit a ratio.`);
    process.exit(1);
  }
  let inputs = files.map(f => ({ file: f, src: readFileSync(f, 'utf8') }));

  const require = createRequire(join(ROOT, 'package.json'));

  /*
   * `less` does not export './package.json', so resolve the install by PATH and read
   * it directly. The resolved real path is the evidence — a stale pointer here would
   * otherwise fail silently and cleanly.
   */
  const lessPkgPath = realpathSync(join(ROOT, 'node_modules/less/package.json'));
  const lessVersion = JSON.parse(readFileSync(lessPkgPath, 'utf8')).version;
  const less = require('less');

  const { parse: jessParse } = await import(join(ROOT, 'packages/syntax/less/less-parser/lib/index.js'));

  /** `filename` lets lessc resolve `@import` relative to the source, as it would on disk. */
  const lessOpts = input => ({
    syncImport: true,
    javascriptEnabled: false,
    filename: input.file,
    paths: [dirname(input.file)]
  });

  const parseWithLessc = input => new Promise((res) => {
    try {
      less.parse(input.src, lessOpts(input), () => res(true));
    } catch {
      res(true);
    }
  });

  /*
   * PREFLIGHT. `less.parse` NEVER invokes its callback for some corpus inputs (an
   * `@import` it cannot resolve leaves the continuation pending forever), which
   * hangs the process on an unsettled promise. Racing a timeout inside the TIMED
   * loop would silently fold that timeout into the measurement, so instead the
   * non-settling inputs are identified once, up front, dropped from BOTH sides, and
   * reported. Both parsers then run on exactly the same set, and the exclusion is
   * visible rather than baked into the number.
   */
  const settles = async (input) => {
    let timer;
    const timeout = new Promise((res) => {
      timer = setTimeout(() => res(false), 2000);
    });
    const ok = await Promise.race([parseWithLessc(input), timeout]);
    clearTimeout(timer);
    return ok;
  };
  const dropped = [];
  const kept = [];
  for (const input of inputs) {
    if (await settles(input)) {
      kept.push(input);
    } else {
      dropped.push(input.file);
    }
  }
  inputs = kept;
  if (inputs.length === 0) {
    console.error(`case '${caseName}': lessc could not process ANY input. Refusing to emit a ratio.`);
    process.exit(1);
  }
  const bytes = inputs.reduce((n, i) => n + Buffer.byteLength(i.src), 0);

  const jessOnce = () => {
    for (const i of inputs) {
      try {
        jessParse(i.src);
      } catch { /* the corpus deliberately contains inputs Less rejects; failing is part of the workload */ }
    }
  };
  const lessOnce = async () => {
    for (const i of inputs) {
      await parseWithLessc(i);
    }
  };

  for (let i = 0; i < warmup; i++) {
    jessOnce();
    await lessOnce();
  }

  // Interleaved WITHIN the process so the two sides share JIT and GC state.
  const jessSamples = [];
  const lessSamples = [];
  for (let i = 0; i < timed; i++) {
    let t = process.hrtime.bigint();
    jessOnce();
    jessSamples.push(Number(process.hrtime.bigint() - t) / 1e6);
    t = process.hrtime.bigint();
    await lessOnce();
    lessSamples.push(Number(process.hrtime.bigint() - t) / 1e6);
  }

  /*
   * Ratio computed PER PAIR, then summarised — not median/median, so the spread of
   * the ratio itself is visible.
   */
  const ratios = jessSamples.map((j, i) => j / lessSamples[i]);
  const jMed = median(jessSamples);
  const lMed = median(lessSamples);
  const rMed = median(ratios);

  console.log(`case            ${caseName}  (${inputs.length} files, ${(bytes / 1024).toFixed(1)}KB)`);
  if (dropped.length > 0) {
    console.log(`dropped         ${dropped.length} file(s) lessc could not settle (excluded from BOTH sides)`);
  }
  console.log(`worktree        ${ROOT}`);
  console.log(`comparator      lessc ${lessVersion}  ${lessPkgPath}`);
  console.log(`node            ${process.version}`);
  console.log(`jess parse      ${jMed.toFixed(2)}ms median`);
  console.log(`lessc parse     ${lMed.toFixed(2)}ms median`);
  console.log(`RATIO jess/lessc ${rMed.toFixed(3)}x   `
    + `[p05 ${quantile(ratios, 0.05).toFixed(3)}, p95 ${quantile(ratios, 0.95).toFixed(3)}]  n=${timed}`);
  console.log('');
  console.log('Structural note (describes, does NOT adjust the number): jess builds a full');
  console.log('typed AST with trivia/provenance; lessc 4.x builds its own tree without that');
  console.log('detail. The ratio is honest wall-clock on identical input.');
  console.log('');
  console.log('--- commit trailer (paste verbatim) ---');
  console.log(`Perf-Ratio: less-ast/${caseName}/lessc-${lessVersion} ${rMed.toFixed(2)}x n=${timed}`);
  console.log('--- end trailer ---');
}

const dialect = arg('--dialect', 'less');
if (dialect === 'less') {
  await runLess();
} else if (dialect === 'css') {
  console.error(
    'CSS ratio is deliberately NOT implemented here.\n'
    + 'Use the existing in-process CSS/PostCSS comparison, which already does exactly this:\n'
    + '  node packages/syntax/css/css-parser/test/postcss-oracle.mjs --bench --file <path>\n'
    + 'The PostCSS comparator bar is owned separately; a second implementation would just disagree with it.'
  );
  process.exit(2);
} else {
  console.error(`unknown dialect '${dialect}' (less | css)`);
  process.exit(1);
}
