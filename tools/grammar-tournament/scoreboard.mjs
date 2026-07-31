/**
 * THE SCOREBOARD — one command, one table, all candidates measured identically.
 *
 *   node tools/grammar-tournament/scoreboard.mjs \
 *     --entry A=/abs/path/to/packages/syntax/css/css-parser \
 *     --entry B=/abs/path/to/... \
 *     [--renames A=/abs/path/renames.json] \
 *     [--fuzz 2000] [--seed 24221] [--bench] [--min-real 800]
 *
 * Each `--entry` is a candidate's BUILT css-parser package directory. Its
 * `lib/` and its grammar source are SNAPSHOTTED into this repo's own tree
 * before anything is measured, so every number is taken in ONE directory and
 * no measurement ever crosses a worktree.
 *
 * RANKING, in order:
 *   0. tree identity          PASS/FAIL. A fail is DISQUALIFYING, full stop.
 *   1. artifact bytes         `lib/grammar/ast.js` RAW. The owner's goal-2 metric.
 *   2. parse speed            tie-break, and only outside the noise floor.
 *   3. source / combinators   final tie-break.
 *
 * Nothing under ~1.5% is a speed result: two BYTE-IDENTICAL artifacts
 * interleaved in one directory measured 5.144 vs 5.200 ms at a 6/15 win rate.
 *
 * PRECONDITIONS run before ranking and REFUSE an entry rather than scoring it:
 * interpreter fallback, implausible floor, non-injective rename map.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { loadSurfaces, compareBuilds, formatDivergence } from './lib/identity.mjs';
import { loadCssCorpus, isMalformed } from './lib/corpus.mjs';
import { checkEntry } from './lib/preconditions.mjs';
import { artifactBytes, sourceClosure, combinatorCounts, extractRegexLiterals, classifyRegexes, RANK_ARTIFACT, ARTIFACTS } from './lib/metrics.mjs';
import { auditReferenceShape } from './lib/refshape.mjs';
import { interleavedAB, classify, NOISE_FLOOR_PCT } from './lib/bench.mjs';
import { fuzzDifferential } from './lib/fuzz.mjs';
import { digest, firstDivergence, describe, assertInjective } from './lib/canonical.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const pkg = resolve(repo, 'packages/syntax/css/css-parser');
const ENTRIES = resolve(pkg, 'entries');

function args(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}`) {
      out.push(process.argv[i + 1]);
    }
  }
  return out;
}
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}

/** Snapshot a candidate package into OUR tree. All measurement happens here. */
function snapshot(label, srcPkg) {
  const dst = resolve(ENTRIES, label);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(resolve(srcPkg, 'lib'), resolve(dst, 'lib'), { recursive: true });
  const grammarSrc = resolve(srcPkg, 'src/grammar.ts');
  if (existsSync(grammarSrc)) {
    mkdirSync(resolve(dst, 'src'), { recursive: true });
    cpSync(resolve(srcPkg, 'src'), resolve(dst, 'src'), { recursive: true });
  }
  return dst;
}

function pad(s, n) {
  return String(s).padEnd(n);
}
function num(n) {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US');
}

async function main() {
  const parsemanVersion = JSON.parse(readFileSync(resolve(repo, 'node_modules/parseman/package.json'), 'utf8')).version;
  const head = readFileSync(resolve(repo, '.git/HEAD'), 'utf8').trim();

  console.log('='.repeat(96));
  console.log('CSS GRAMMAR TOURNAMENT — SCOREBOARD');
  console.log('='.repeat(96));
  console.log(`repo HEAD    ${head}`);
  console.log(`parseman     ${parsemanVersion}   (PINNED — NOT 0.46.0; do not cross-quote into goal-2 expansion tracking)`);
  console.log(`rank key     ${RANK_ARTIFACT}  raw bytes, unminified, as tsdown emits`);
  console.log(`noise floor  ${NOISE_FLOOR_PCT}% — nothing under this is a speed result`);

  const corpus = loadCssCorpus(repo);
  const malformed = corpus.ids.filter(isMalformed).length;
  console.log(`corpus       ${corpus.ids.length} css inputs (${corpus.ids.length - malformed} well-formed, ${malformed} malformed)`);

  const minReal = Number(arg('min-real', 800));

  // ---- baseline -------------------------------------------------------
  const baseDir = snapshot('base', pkg);
  const baseBytes = artifactBytes(baseDir);
  const baseSurfaces = await loadSurfaces(resolve(baseDir, 'lib'));
  const baseClosure = sourceClosure(resolve(pkg, 'src/grammar.ts'), repo);
  const baseComb = combinatorCounts(baseClosure);
  const baseRe = classifyRegexes(extractRegexLiterals(baseClosure));
  const baseRef = auditReferenceShape(resolve(pkg, 'src/grammar.ts'), 'cssFactory');

  const rows = [];
  rows.push({
    label: 'INCUMBENT',
    refused: null,
    identity: 'baseline',
    divergences: 0,
    bytes: baseBytes,
    comb: baseComb.total,
    src: baseClosure.totalBytes,
    re: baseRe,
    ref: baseRef,
    speed: null
  });

  // ---- entries --------------------------------------------------------
  const renameArgs = Object.fromEntries(args('renames').filter(Boolean).map(s => s.split('=')));

  for (const spec of args('entry').filter(Boolean)) {
    const [label, srcPkg] = spec.split('=');
    console.log(`\n--- grading ${label} (${srcPkg}) ---`);
    const dir = snapshot(label, srcPkg);
    const bytes = artifactBytes(dir);

    const pre = checkEntry(dir, bytes.rank.raw, baseBytes.rank.raw);
    if (!pre.ok) {
      const why = pre.fallback.ok ? pre.floor.reason : pre.fallback.reason;
      console.log(`  REFUSED: ${why}`);
      rows.push({ label, refused: why, bytes });
      continue;
    }

    let renames = {};
    if (renameArgs[label]) {
      renames = JSON.parse(readFileSync(renameArgs[label], 'utf8'));
      try {
        assertInjective(renames);
      } catch (e) {
        console.log(`  REFUSED: ${e.message}`);
        rows.push({ label, refused: e.message, bytes });
        continue;
      }
      console.log(`  rename map: ${Object.keys(renames).length} entries, injective`);
    }

    const surfaces = await loadSurfaces(resolve(dir, 'lib'));
    const id = compareBuilds({ base: baseSurfaces, candidate: surfaces, corpus, renames, repo });
    const realTrees = id.checked - id.bothThrew;
    console.log(`  identity: ${id.verdict.toUpperCase()}  ${id.checked} pairs / ${realTrees} real trees / ${id.bothThrew} identical-throw`);
    if (realTrees < minReal) {
      console.log(`  REFUSED: ${realTrees} real trees below --min-real ${minReal}; the gate shrank.`);
      rows.push({ label, refused: `real trees ${realTrees} < ${minReal}`, bytes });
      continue;
    }
    for (let i = 0; i < id.divergences.length; i++) {
      console.log(formatDivergence(id.divergences[i], i + 1));
    }

    // Fuzz, seeded from the corpus.
    const seed = Number(arg('seed', 0x5eed));
    const nCases = Number(arg('fuzz', 1000));
    const seedTexts = corpus.ids.slice(0, 120).map(i => {
      try {
        return corpus.read(i);
      } catch {
        return '';
      }
    }).filter(Boolean);
    const fz = fuzzDifferential({
      base: baseSurfaces, candidate: surfaces, seedTexts, seed, cases: nCases,
      renames, digest, firstDivergence, describe, repo
    });
    console.log(`  fuzz: seed=0x${seed.toString(16)} cases=${fz.cases} compared=${fz.compared} real=${fz.realTrees} divergences=${fz.divergenceCount}`);
    for (const d of fz.divergences.slice(0, 3)) {
      console.log(`    seed=0x${seed.toString(16)} idx=${d.index} [${d.mutations.join('+')}] ${d.surface} at ${d.path}: ${d.base} vs ${d.candidate}`);
      console.log(`      input: ${JSON.stringify(d.input.slice(0, 90))}`);
    }

    const closure = sourceClosure(resolve(dir, 'src/grammar.ts'), repo);
    const comb = combinatorCounts(closure);
    const re = classifyRegexes(extractRegexLiterals(closure));
    const ref = auditReferenceShape(resolve(dir, 'src/grammar.ts'), 'cssFactory');

    let speed = null;
    if (process.argv.includes('--bench')) {
      const benchSrc = corpus.ids.filter(i => !isMalformed(i)).map(i => corpus.read(i));
      const r = interleavedAB(
        [{ name: 'base', parse: baseSurfaces[0].parse }, { name: label, parse: surfaces[0].parse }],
        benchSrc
      );
      speed = { ...r, verdict: classify(r.deltaPct, r.winsB, r.rounds) };
      console.log(`  speed: ${speed.verdict.verdict} ${speed.verdict.text}`);
    }

    rows.push({
      label,
      refused: null,
      identity: id.verdict,
      divergences: id.divergenceCount ?? 0,
      realTrees,
      fuzz: fz,
      bytes, comb: comb.total, src: closure.totalBytes, re, ref, speed
    });
  }

  // ---- the table ------------------------------------------------------
  console.log(`\n${'='.repeat(96)}`);
  console.log('BOARD');
  console.log('='.repeat(96));
  console.log(`${pad('entry', 12)}${pad('identity', 11)}${pad('ast.js raw', 14)}${pad('gzip', 11)}${pad('4-file tot', 14)}${pad('comb', 7)}${pad('regex ch', 10)}${pad('span', 6)}refshape`);
  console.log('-'.repeat(96));
  for (const r of rows) {
    if (r.refused) {
      console.log(`${pad(r.label, 12)}${pad('REFUSED', 11)}${r.refused.slice(0, 70)}`);
      continue;
    }
    console.log(
      pad(r.label, 12)
      + pad(r.identity === 'pass' ? 'PASS' : r.identity === 'baseline' ? '—' : `FAIL(${r.divergences})`, 11)
      + pad(num(r.bytes.rank.raw), 14)
      + pad(num(r.bytes.rank.gzip), 11)
      + pad(num(r.bytes.totalRaw), 14)
      + pad(r.comb, 7)
      + pad(num(r.re.totalChars), 10)
      + pad(r.re.spanningCount, 6)
      + `${r.ref.ok ? `${r.ref.defective} defective / ${r.ref.emittedTwice} twice` : 'n/a'}`
    );
  }

  console.log('\nNOTES');
  console.log(`  * tree identity is a GATE, not a score. FAIL = disqualified for the round.`);
  console.log(`  * "span" = regexes matching across a structural boundary. Regexes may cover TERMINALS;`);
  console.log(`    STRUCTURE must remain combinators. A jump here is named, not silently ranked.`);
  console.log(`  * refshape = composites referenced by bare const 2+ times (inlined transitively at each`);
  console.log(`    site) / also in the rules map (emitted TWICE). Cost is set by closure depth, measured`);
  console.log(`    between 1.046x and 13.69x for the identical defect — so raw bytes taken without this`);
  console.log(`    column rank authoring accident, not grammar design.`);
  console.log(`  * gzip is reported, never ranked: raw and gzip have already moved in opposite directions.`);

  const disq = rows.filter(r => r.identity === 'fail' || r.refused);
  process.exit(disq.length > 0 ? 1 : 0);
}

await main();
