/**
 * AST/CST byte-identity oracle for `@jesscss/scss-parser`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `GRAMMAR-REVIEW-STANDARD.md` §4 makes byte identity the acceptance test for a
 * grammar edit, and item 15 makes "the tree moved" a failed change rather than
 * a judgement call. Until now that gate existed for Less only
 * (`pnpm run oracle:less:byte-identity`), and the standard says so explicitly:
 * "There is no equivalent script for the other three dialects." A Less oracle
 * says NOTHING about an SCSS grammar edit — SCSS composes its own value and
 * selector slots — so shrinking `scss-parser/src/grammar.ts` against a green
 * Less oracle would be measuring the control and calling it the experiment.
 *
 * This is that missing script for SCSS. It is deliberately a thin shell over
 * the Less oracle's machinery: `identity-oracle/corpus.mjs` and
 * `identity-oracle/report.mjs` are corpus/report plumbing with no Less in them,
 * and `collapseChildrenAlias` handles the same `{ rules, children: rules }`
 * aliasing that `@jesscss/css-parser/cst-host` gives every dialect's CST. Only
 * the corpus roots and the two surfaces are dialect-specific. Copying those
 * three modules to get a fourth private copy is the exact duplication this
 * repo's grammar work is trying to burn down.
 *
 * THE CORPUS IS THE POINT
 * -----------------------
 * `.cache/sass-spec/inputs` is 2404 real sass-spec cases, materialised by the
 * package's own `postinstall`. That is the widest SCSS surface available in
 * this repo by a wide margin, and it is what makes a differential here worth
 * running: a corpus that never exercises the production under review reports
 * "identical" for a correct change and a broken one alike.
 *
 * A NEGATIVE CONTROL IS MANDATORY, NOT OPTIONAL
 * ---------------------------------------------
 * `--self-check` mutates nothing; it re-runs the digest twice and proves the
 * surfaces are deterministic. That is not the control. The control the standard
 * asks for is: break the production you are editing on purpose, rebuild, and
 * watch this exit 1. If it does not, this oracle is not looking at your change
 * and its green is worthless. Do that once per production family, not once per
 * lane.
 *
 * HOW TO RUN
 * ----------
 *   pnpm --filter @jesscss/scss-parser build       # lib/ is what is measured
 *   pnpm run check:macro                           # a red macro gate INVALIDATES the run
 *   node <this file>                               # write a fresh baseline to stdout
 *   node <this file> <baseline.json>               # compare; exit code is the verdict
 *
 * Exit codes match the Less oracle: 0 identical, 1 moved, 2 incomparable, 3 no
 * verdict. Only 0 and 1 say anything about the grammar.
 *
 * WHY IT PARSES `lib/`, NOT `src/`
 * --------------------------------
 * `lib/` is the macro-COMPILED artifact that ships, and a macro-fallback build
 * emits a DIFFERENT tree than the compiled one for the same input
 * (`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §1). Rebuild between edits, and keep
 * `pnpm run check:macro` green or throw the report away.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collapseChildrenAlias } from '../../../less/less-parser/test/identity-oracle/collapse-children-alias.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../..');

/**
 * Corpus roots, widest first.
 *
 * `.cache/sass-spec/inputs` is materialised by this package's `postinstall`
 * (`scripts/materialize-sass-spec-cache.cjs`) and is not checked in, so it is
 * allowed to be missing — but a missing root SHRINKS the corpus and therefore
 * moves the aggregate, which is reported rather than silently absorbed. The
 * two `test/` roots are checked in and always resolve, so the gate still has
 * teeth on a checkout that never ran `postinstall`.
 */
const ROOTS = [
  'packages/syntax/scss/scss-parser/.cache/sass-spec/inputs',
  'packages/syntax/scss/scss-parser/test',
  'packages/syntax/css/css-parser/test'
];

function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip absolute paths from error messages so a digest is reproducible across
 * machines and worktrees. Without this the gate would only ever pass for the
 * checkout that wrote the baseline.
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

  return { name: thrown?.name ?? 'unknown', message: String(thrown?.message ?? thrown) };
}

/**
 * `digestInto` is the one piece only parseman can supply — its node shapes
 * decide which distinctions are semantically meaningful. Fail loudly on a floor
 * violation rather than twelve frames deep on `undefined is not a function`.
 */
async function requireDigestInto() {
  const oracle = await import('parseman/oracle');
  if (typeof oracle.digestInto === 'function') {
    return;
  }
  throw new Error(
    'oracle: the installed parseman does not export `digestInto` from `parseman/oracle`. This gate streams the '
    + 'canonical projection into its own hash rather than materialising it, which needs parseman >= 0.45.0.'
  );
}

async function main() {
  await requireDigestInto();
  const { loadCorpus } = await import('../../../less/less-parser/test/identity-oracle/corpus.mjs');
  const { digestCorpus, compareReports, formatComparison, formatUndigested } =
    await import('../../../less/less-parser/test/identity-oracle/report.mjs');
  const { parse } = await import('../lib/index.js');
  const { parseScssCst } = await import('../lib/cst.js');

  /*
   * Both shipping surfaces. `ast` is the compile path; `cst` is what the
   * language service consumes. A grammar edit that moves either one is a failed
   * change, and an edit aimed at one is expected to leave the other alone —
   * that is what makes the pair informative rather than a single number twice.
   */
  const surfaces = [
    { name: 'ast', parse: source => parse(source) },
    { name: 'cst', parse: source => parseScssCst(source) }
  ];

  const corpus = loadCorpus({
    base: repo,
    roots: ROOTS,
    extensions: ['.scss', '.css'],
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

  const { report, undigested } = digestCorpus(surfaces, corpus, {
    projectError,

    /*
     * `projectValue`, not a wrapper around `surface.parse`: wrapping the parse
     * would put this inside the try that classifies a throw as a GRAMMAR
     * rejection, so a failure here would be counted in `threw` and hashed.
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
    process.exit(2);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  console.error('oracle: wrote fresh baseline to stdout. Pipe to a file and commit.');
  process.exit(0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  try {
    await main();
  } catch (failed) {
    /*
     * Exit 3, NOT 1: 1 means "the grammar moved", and a tool that reports its
     * own breakage in the vocabulary of a grammar regression does not degrade,
     * it lies.
     */
    console.error(`\n${failed instanceof Error ? failed.stack : String(failed)}`);
    console.error('\noracle: NO VERDICT — the harness failed. This says nothing about the grammar.');
    process.exit(3);
  }
}
