/**
 * AST/CST byte-identity oracle for `@jesscss/less-parser`.
 *
 * WHAT IT IS FOR
 * --------------
 * The byte-identity gate for the four-grammar rewrite (Stage 2 of the
 * GRAMMAR-REBUILD-SPEC). A grammar refactor is accepted if BOTH shipping
 * surfaces of `@jesscss/less-parser` are byte-identical before and after —
 * `parse()` (the AST v2 route used by `src/index.ts`, the shipping Less
 * evaluator) and `parseLessCst()` (the CST route consumed by the language
 * service).
 *
 * WHERE THE CODE LIVES, AND WHY
 * -----------------------------
 * `parseman/oracle` supplies exactly one thing: `digestInto`, the deterministic
 * serialization of ONE parse result. That is the part only parseman can write —
 * it is parseman's node shapes that decide which distinctions are semantically
 * meaningful — and it is the part every grammar author wants, whatever they are
 * building.
 *
 * Corpus walking, aggregate digests, the three-way verdict and the report
 * formatting used to come from there too. They live in `./identity-oracle/`
 * now: they only make sense with jess's corpus roots and jess's committed
 * baseline in hand, which makes them this repo's regression plumbing rather
 * than anything that helps someone build or diagnose a grammar.
 *
 * HOW TO RUN
 * ----------
 *   pnpm run oracle:less:byte-identity     # build + compare against the baseline
 *   node <this file>                       # write a fresh baseline to stdout
 *   node <this file> <baseline.json>       # compare; the exit code is the verdict
 *
 * Exit codes: 0 identical, 1 moved, 2 incomparable, 3 no verdict — either the
 * digest could not be computed or the harness itself failed. Only 0 and 1 are
 * statements about the grammar; see TWO FAILURE CHANNELS below.
 *
 * BASELINE POLICY
 * ---------------
 * Regenerate `oracle-byte-identity.baseline.json` only in a reviewed change
 * that names every corpus change and proves the candidate against its exact
 * parent on the same set of entries. A fresh aggregate by itself can absorb a
 * real parser regression.
 *
 * WHY IT PARSES THE BUILT `lib/`, NOT `src/`
 * ------------------------------------------
 * `lib/` is the macro-COMPILED artifact, which is what ships — and a macro
 * fallback build emits a DIFFERENT tree than the compiled one. So you must
 * rebuild between edits, and you must keep `pnpm run check:macro` green: a red
 * macro-buildability check INVALIDATES any report taken on that build.
 *
 * TWO FAILURE CHANNELS
 * --------------------
 * "The grammar rejected this file" and "the digest could not be computed" are
 * different facts and are reported separately. The first is hashed (error
 * behaviour IS behaviour) and counted in `threw`. The second means the TOOL
 * gave up; it produces no report and no verdict, exits 3, and names every
 * (entry, surface) pair it happened on. See `./identity-oracle/report.mjs`.
 *
 * WHAT IS HASHED
 * --------------
 * Each corpus entry is parsed through every declared surface and the result is
 * streamed into a sha256 by `digestInto` — no canonical string is ever built.
 * Errors are projected through `projectError` to strip absolute paths (jess
 * error messages can cite `repo`-rooted paths; those make a digest
 * machine-specific).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collapseChildrenAlias } from './identity-oracle/collapse-children-alias.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * Corpus roots — the same set the short-hash oracle (`ast-identity-oracle.mjs`)
 * uses, so per-entry hashes stay comparable to it during the transition. A
 * missing root is skipped and reported; the aggregate covers the ids, so a
 * corpus that quietly shrank moves the aggregate instead of producing a
 * smaller, greener gate.
 */
const ROOTS = [
  'node_modules/@less/test-data/tests-unit',
  'node_modules/@less/test-data/tests-config',
  'node_modules/@less/test-data/tests-error',
  'node_modules/@less/test-data/data',
  'packages/jess/node_modules/bootstrap-less-port/less',
  'packages/jess/test',
  'packages/syntax/less/less-parser/test',
  'packages/syntax/css/css-parser/test'
];

function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip absolute paths from jess error messages so a digest is reproducible
 * across machines and worktrees. jess errors cite `repo`-rooted or
 * `<worktree>`-rooted paths; both are normalised to `<repo>/` here. Without
 * this, the gate would only pass for its author.
 */
function projectError(thrown) {
  if (thrown && typeof thrown === 'object' && 'message' in thrown) {
    const msg = String(thrown.message);
    const normalised = isAbsolute(msg.split(':')[0] || '')
      ? msg
          .replace(new RegExp(escapeForRegex(repo), 'g'), '<repo>')
          .replace(new RegExp(escapeForRegex(process.cwd()), 'g'), '<repo>')
      : msg;
    return { name: thrown.name, message: normalised };
  }

  /*
   * Mirror the default projection for non-Error throws, so the corpus error
   * messages remain part of the gate.
   */
  return { name: thrown?.name ?? 'unknown', message: String(thrown?.message ?? thrown) };
}

/**
 * `digestInto` landed in parseman 0.45.0, and jess resolves `^0.43.0`. Until
 * that publishes, this is the one thing standing between the gate and a
 * verdict — and `undefined is not a function` twelve frames deep is not how a
 * version floor should announce itself.
 */
async function requireDigestInto() {
  const oracle = await import('parseman/oracle');
  if (typeof oracle.digestInto === 'function') {
    return;
  }
  throw new Error(
    'oracle: the installed parseman does not export `digestInto` from `parseman/oracle`. This gate streams the '
    + 'canonical projection into its own hash rather than materialising it, which needs parseman >= 0.45.0. Bump '
    + 'the dependency once 0.45.0 publishes.'
  );
}

async function main() {
  await requireDigestInto();
  const { loadCorpus } = await import('./identity-oracle/corpus.mjs');
  const { digestCorpus, compareReports, formatComparison, formatUndigested } =
    await import('./identity-oracle/report.mjs');
  const { parse } = await import('../lib/index.js');
  const { parseLessCst } = await import('../lib/cst.js');

  /*
   * Surface list. The grammar under edit plus an untouched control — for
   * `@jesscss/less-parser` BOTH surfaces ship, and a refactor touching one
   * grammar should move neither. The surface name is part of the aggregate, so
   * renaming a surface deliberately moves it.
   */
  const surfaces = [
    { name: 'ast', parse: source => parse(source) },
    { name: 'cst', parse: source => parseLessCst(source) }
  ];

  const corpus = loadCorpus({
    base: repo,
    roots: ROOTS,
    extensions: ['.less', '.css'],
    allowMissingRoots: true
  });

  if (corpus.missingRoots.length > 0) {
    console.error(`oracle: ${corpus.missingRoots.length} missing corpus root(s):`);
    for (const r of corpus.missingRoots) {
      console.error(`  - ${r}`);
    }
    console.error('oracle: missing roots reduce the corpus; the aggregate still gates over what resolved.');
  }
  if (corpus.skippedLarge.length > 0) {
    console.error(`oracle: skipped ${corpus.skippedLarge.length} large entries (raise maxBytes to include):`);
    for (const s of corpus.skippedLarge.slice(0, 5)) {
      console.error(`  - ${s}`);
    }
  }

  /*
   * determinismSample defaults to 32; do not lower it to get a green run. If a
   * parse is non-deterministic this throws, naming the surface and the entry —
   * that is the signal, not noise.
   */
  const { report, undigested } = digestCorpus(surfaces, corpus, {
    projectError,

    /*
     * `projectValue`, not a wrapper around `surface.parse`. Wrapping the parse
     * would put this transform inside the try that classifies a throw as a
     * GRAMMAR rejection, so a failure in it would be counted in `threw` and
     * hashed — re-opening the exact conflation the two channels exist to close.
     * Here it sits with the digest, and a failure lands on `undigested`.
     */
    projectValue: collapseChildrenAlias
  });

  if (report === null) {
    console.error(`\n${formatUndigested(undigested)}`);
    console.error('oracle: NO VERDICT — fix the projection failure, then re-run. Do not re-baseline around it.');
    process.exit(3);
  }

  console.error('oracle: digest complete');
  console.error(`  corpus entries: ${report.entries}`);
  console.error(`  format: ${report.format}`);
  console.error(`  harness: ${report.harness.slice(0, 16)}…`);
  for (const s of report.surfaces) {
    console.error(`  surface ${s.name}: aggregate=${s.aggregate} threw=${s.threw}`);
  }

  const baselineArg = process.argv[2];
  if (baselineArg) {
    const baseline = JSON.parse(readFileSync(baselineArg, 'utf8'));
    const comparison = compareReports(baseline, report);
    console.error(`\n${formatComparison(comparison)}`);
    if (comparison.verdict === 'identical') {
      console.error('oracle: PASS — byte-identical to baseline');
      process.exit(0);
    }
    if (comparison.verdict === 'moved') {
      console.error('oracle: FAIL — surface(s) moved against baseline');
      process.exit(1);
    }

    console.error(`oracle: FAIL — reports are incomparable. Reason: ${comparison.reason ?? '(none given)'}`);
    console.error('oracle: incomparable is never "close enough". The tool is refusing to answer —');
    console.error('       find out why the harness differs (a parseman version mismatch, a projection');
    console.error('       change, or a corpus-merge issue).');
    process.exit(2);
  }

  // No baseline argument → write a fresh baseline to stdout as JSON, exit 0.
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  console.error('oracle: wrote fresh baseline to stdout. Pipe to a file and commit.');
  process.exit(0);
}

/*
 * Only run when invoked as the entry point. `collapseChildrenAlias` is exported
 * so it can be checked in isolation — importing this file must not start a
 * three-second corpus digest and then call `process.exit`.
 */
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  try {
    await main();
  } catch (failed) {
    /*
     * The harness itself failed — a missing `digestInto`, a corpus that moved
     * under the run, a nondeterministic surface. Exit 3, NOT 1: 1 means "the
     * grammar moved", and a tool that reports its own breakage in the
     * vocabulary of a grammar regression does not degrade, it lies.
     */
    console.error(`\n${failed instanceof Error ? failed.stack : String(failed)}`);
    console.error('\noracle: NO VERDICT — the harness failed. This says nothing about the grammar.');
    process.exit(3);
  }
}
