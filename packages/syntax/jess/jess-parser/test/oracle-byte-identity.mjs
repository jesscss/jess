/**
 * AST/CST byte-identity oracle for `@jesscss/jess-parser`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `GRAMMAR-REVIEW-STANDARD.md` §4 makes byte identity the acceptance test for a
 * grammar edit, and item 15 makes "the tree moved" a failed change rather than a
 * judgement call. The Less oracle (`pnpm run oracle:less:byte-identity`) gates
 * Less only, and SCSS grew its own thin shell (`scss-parser/test/
 * oracle-byte-identity.mjs`). This is the same missing script for Jess: Jess
 * composes its own value and selector slots, so a Less/SCSS oracle says nothing
 * about a Jess grammar edit.
 *
 * It is deliberately a thin shell over the Less oracle's machinery:
 * `identity-oracle/corpus.mjs` and `identity-oracle/report.mjs` are corpus/report
 * plumbing with no Less in them, and `collapseChildrenAlias` handles the same
 * `{ rules, children: rules }` aliasing that `@jesscss/css-parser/cst-host` gives
 * every dialect's CST. Only the corpus roots and the two surfaces are
 * dialect-specific.
 *
 * TWO SURFACES, ON PURPOSE
 * ------------------------
 * `ast` is the compile path (`parse`); `cst` is what the language service
 * consumes (`parseJessCst`). A selector-tower RENAME is expected to leave `ast`
 * byte-identical while `cst` converges to CSS's canonical public-CST names — the
 * pair is what makes that claim checkable rather than a single number twice.
 *
 * HOW TO RUN
 * ----------
 *   pnpm --filter @jesscss/jess-parser build   # lib/ is what is measured
 *   pnpm run check:macro                        # a red macro gate INVALIDATES the run
 *   node <this file>                            # write a fresh report to stdout
 *   node <this file> <baseline.json>            # compare; exit code is the verdict
 *
 * Exit codes match the Less oracle: 0 identical, 1 moved, 2 incomparable, 3 no
 * verdict. Only 0 and 1 say anything about the grammar.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collapseChildrenAlias } from '../../../less/less-parser/test/identity-oracle/collapse-children-alias.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../..');

/**
 * Corpus roots, selector-bearing first. The two `test/` roots are checked in and
 * always resolve, so the gate has teeth on a bare checkout. `.css` is valid Jess
 * (Jess is a CSS superset), so the css-parser corpus exercises the shared
 * selector tower directly.
 */
const ROOTS = [
  'packages/syntax/jess/jess-parser/test',
  'packages/syntax/css/css-parser/test',
  'packages/jess/test/files',
  'packages/fns/test/files'
];

function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip absolute paths from error messages so a digest is reproducible across
 * machines and worktrees.
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

async function requireDigestInto() {
  const oracle = await import('parseman/oracle');
  if (typeof oracle.digestInto === 'function') {
    return;
  }
  throw new Error(
    'oracle: the installed parseman does not export `digestInto` from `parseman/oracle` (needs parseman >= 0.45.0).'
  );
}

async function main() {
  await requireDigestInto();
  const { loadCorpus } = await import('../../../less/less-parser/test/identity-oracle/corpus.mjs');
  const { digestCorpus, compareReports, formatComparison, formatUndigested } =
    await import('../../../less/less-parser/test/identity-oracle/report.mjs');
  const { parse } = await import('../lib/index.js');
  const { parseJessCst } = await import('../lib/cst.js');

  const surfaces = [
    { name: 'ast', parse: source => parse(source) },
    { name: 'cst', parse: source => parseJessCst(source) }
  ];

  const corpus = loadCorpus({
    base: repo,
    roots: ROOTS,
    extensions: ['.jess', '.css'],
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
  console.error('oracle: wrote fresh report to stdout. Pipe to a file to diff.');
  process.exit(0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  try {
    await main();
  } catch (failed) {
    console.error(`\n${failed instanceof Error ? failed.stack : String(failed)}`);
    console.error('\noracle: NO VERDICT — the harness failed. This says nothing about the grammar.');
    process.exit(3);
  }
}
