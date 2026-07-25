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
 * service). The Stage 1 parseman 0.32 → 0.37 bump moved the CST aggregate
 * from scanSkip's sentinels-in-comments change (parseman 0.33); that baseline
 * is captured here as the floor for every later Stage 3–6 grammar diff.
 *
 * It uses the real `parseman/oracle` API (`loadCorpus`, `digestCorpus`,
 * `compareReports`, `formatComparison`) rather than the per-file short-hash
 * projection in `ast-identity-oracle.mjs`. It supersedes that file for the
 * Stage 2+ rewrite: `compareReports` returns a three-way verdict
 * (`identical` | `moved` | `incomparable`), so the gate is machine-checked
 * (exit non-zero on `moved` or `incomparable`) instead of "you diff before
 * against after".
 *
 * HOW TO RUN
 * ----------
 *   pnpm --filter @jesscss/less-parser build        # REQUIRED — parses lib/
 *   node packages/syntax/less/less-parser/test/oracle-byte-identity.mjs                # write baseline
 *   node packages/syntax/less/less-parser/test/oracle-byte-identity.mjs <baseline.json> # compare
 *
 * Typical loop for a grammar refactor on a Stage-3+ branch off dev:
 *   1. build + run, save as `before.json`, commit it (or use the committed one)
 *   2. edit the grammar
 *   3. build + run with the baseline arg; exit code tells you the verdict
 *
 * WHY IT PARSES THE BUILT `lib/`, NOT `src/`
 * ------------------------------------------
 * `lib/` is the macro-COMPILED artifact, which is what ships — and a macro
 * fallback build emits a DIFFERENT tree than the compiled one. So you must
 * rebuild between edits, and you must keep `pnpm run check:macro` green: a red
 * macro-buildability check INVALIDATES any report taken on that build. `src/`
 * is also not loadable standalone — see the existing short-hash oracle's
 * docstring for the same constraint.
 *
 * WHAT IS HASHED
 * --------------
 * Each corpus entry is parsed through every declared surface and the result
 * is canonicalised + sha256-hashed by `parseman/oracle`. The corpus root set
 * and the `.less`/`.css` extension match the short-hash oracle so results can
 * be compared with it during the transition. Errors are projected through
 * `DigestOptions.projectError` to strip absolute paths (jess error messages
 * can cite `repo`-rooted paths; those make a digest machine-specific).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus, digestCorpus, compareReports, formatComparison } from 'parseman/oracle';
import { parse } from '../lib/index.js';
import { parseLessCst } from '../lib/cst.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * Corpus roots — same set the short-hash oracle uses, so per-entry hashes
 * stay comparable to `ast-identity-oracle.mjs` during the transition. A
 * missing root is skipped (reflected in `missingRoots`); the aggregate
 * covers the ids, so a corpus that quietly shrank moves the aggregate
 * instead of producing a smaller, greener gate.
 */
const ROOTS = [
  'node_modules/@less/test-data/tests-unit',
  'node_modules/@less/test-data/tests-config',
  'node_modules/@less/test-data/tests-error',
  'node_modules/@less/test-data/data',
  'node_modules/.pnpm/bootstrap-less-port@2.5.1_less@3.13.1/node_modules/bootstrap-less-port/less',
  'packages/jess/test',
  'packages/syntax/less/less-parser/test',
  'packages/syntax/css/css-parser/test'
];

/**
 * Surface list. The grammar under edit plus an untouched control — for
 * `@jesscss/less-parser` BOTH surfaces are shipping and a refactor touching
 * one grammar should move neither. Passing both here makes the gate strict
 * on both; `digestCorpus` will surface each independently in
 * `IdentityReport.surfaces`.
 *
 * The surface name is part of the aggregate, so renaming a surface
 * deliberately moves it.
 */
const SURFACES = [
  { name: 'ast', parse: source => parse(source) },
  { name: 'cst', parse: source => parseLessCst(source) }
];

/**
 * Strip absolute paths from jess error messages so a digest is reproducible
 * across machines / worktrees. jess errors cite `repo`-rooted paths or
 * `<worktree>`-rooted paths; both get normalised to `<repo>/` here. Without
 * this, the gate would only pass for its author.
 */
function projectError(thrown, id, surface) {
  if (thrown && typeof thrown === 'object' && 'message' in thrown) {
    const msg = String(thrown.message);
    const normalised = isAbsolute(msg.split(':')[0] || '')
      ? msg.replace(new RegExp(replaceRegexSafe(repo), 'g'), '<repo>')
          .replace(new RegExp(replaceRegexSafe(process.cwd()), 'g'), '<repo>')
      : msg;
    return { name: thrown.name, message: normalised };
  }

  /*
   * The default projectError keeps Error.name + Error.message; mirror that for
   * non-Error throws so the corpus error messages remain part of the gate.
   */
  return { name: thrown?.name ?? 'unknown', message: String(thrown?.message ?? thrown) };
}

function replaceRegexSafe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the corpus via `parseman/oracle.loadCorpus`. The corpus ids are
 * RELATIVE to `base` (per `CorpusEntry.id`) so the digest is stable across
 * machines and doesn't depend on the checkout directory.
 */
function loadEntries() {
  return loadCorpus({
    base: repo,
    roots: ROOTS,
    extensions: ['.less', '.css'],
    allowMissingRoots: true
  });
}

function buildReport() {
  const { entries, missingRoots, skippedLarge } = loadEntries();
  if (missingRoots.length > 0) {
    console.error(`oracle: ${missingRoots.length} missing corpus root(s):`);
    for (const r of missingRoots) {
      console.error(`  - ${r}`);
    }
    console.error('oracle: missing roots reduce the corpus; the aggregate still gates over what resolved.');
  }
  if (skippedLarge && skippedLarge.length > 0) {
    console.error(`oracle: skipped ${skippedLarge.length} large entries (raise maxBytes to include):`);
    for (const s of skippedLarge.slice(0, 5)) {
      console.error(`  - ${s.id}`);
    }
  }
  const report = digestCorpus(SURFACES, entries, {
    projectError

    /*
     * determinismSample defaults to 32; do not lower it to get a green run
     * (see §9.7). If a parse is non-deterministic the tool throws, naming
     * the surface and the entry id — that is the signal, not noise.
     */
  });
  return { report, entryCount: entries.length };
}

function main() {
  const baselineArg = process.argv[2];
  const { report, entryCount } = buildReport();

  console.error(`oracle: digest complete`);
  console.error(`  corpus entries: ${entryCount}`);
  console.error(`  format: ${report.format}`);
  console.error(`  harness: ${report.harness.slice(0, 16)}…`);
  for (const s of report.surfaces) {
    console.error(`  surface ${s.name}: aggregate=${s.aggregate} threw=${s.threw}`);
  }

  if (baselineArg) {
    const baseline = JSON.parse(readFileSync(baselineArg, 'utf8'));
    const comparison = compareReports(baseline, report);
    console.error('\n' + formatComparison(comparison));
    if (comparison.verdict === 'identical') {
      console.error('oracle: PASS — byte-identical to baseline');
      process.exit(0);
    }
    if (comparison.verdict === 'moved') {
      console.error('oracle: FAIL — surface(s) moved against baseline');
      process.exit(1);
    }

    // incomparable
    console.error(`oracle: FAIL — reports are incomparable. Reason: ${comparison.reason ?? '(none given)'}`);
    console.error('oracle: incomparable is never "close enough". The tool is refusing to answer —');
    console.error('       find out why the harness differs (a parseman/oracle version mismatch, a');
    console.error('       DigestOptions change, or a corpus-merge issue).');
    process.exit(2);
  }

  // No baseline argument → write a fresh baseline to stdout as JSON, exit 0.
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  console.error('oracle: wrote fresh baseline to stdout. Pipe to a file and commit.');
  process.exit(0);
}

main();
