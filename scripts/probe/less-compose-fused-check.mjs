#!/usr/bin/env node
/*
 * Build-then-LOAD gate for the Less compose flip (W0).
 *
 * The reducer-purity census (parseman-compose-reducer-census.mjs --check) is a
 * STATIC per-reducer analysis: it proves reducers reference only imported
 * helpers, a NECESSARY but not SUFFICIENT condition for cross-package
 * `compose([cssBaseRules, delta])` fusion. It cannot see the two failures that
 * actually broke the earlier W0 attempt, because both live in BUILT output:
 *
 *   (a) a variant that did NOT fuse — the macro left a runtime `compose(` in the
 *       emitted table instead of lowering it to `tableRules(`. Correct-but-slow,
 *       and invisible to a source scan.
 *   (b) a variant that fused but THROWS on load — e.g. `materializeDirectBuilders`
 *       cannot rebind a builder import — which only fires when the compiled table
 *       is first materialized by a real parse.
 *
 * This gate closes both. It runs against already-built `lib/` (CI builds every
 * package before the check step), so it must never trigger its own build.
 *
 * Run:  node scripts/probe/less-compose-fused-check.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lessLib = join(repo, 'packages/syntax/less/less-parser/lib');

/*
 * The four fused variants and the public entry that loads each one. Parsing a
 * tiny sample through the entry materializes that variant's compiled table —
 * the exact moment a load/rebind throw surfaces.
 */
const VARIANTS = [
  { variant: 'grammar/ast.js',           entry: 'index.js',          fn: 'parse',        arg: null },
  { variant: 'grammar/ast/positions.js', entry: 'positions.js',      fn: 'parse',        arg: null },
  { variant: 'grammar/cst.js',           entry: 'cst.js',            fn: 'parseLessCst', arg: 'Stylesheet' },
  { variant: 'grammar/cst/positions.js', entry: 'cst/positions.js',  fn: 'parseLessCst', arg: 'Stylesheet' }
];

const SAMPLE = 'a{color:red}';

let failed = false;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failed = true;
};

if (!existsSync(lessLib)) {
  console.error(`✗ no built less-parser lib at ${lessLib} — build the workspace first.`);
  process.exit(1);
}

for (const { variant, entry, fn, arg } of VARIANTS) {
  const variantPath = join(lessLib, variant);
  if (!existsSync(variantPath)) {
    fail(`${variant}: MISSING — variant was not emitted.`);
    continue;
  }

  // (a) fused: the emitted table must be `tableRules(`, with NO runtime `compose(`.
  const code = readFileSync(variantPath, 'utf8');
  const composeCalls = (code.match(/\bcompose\(/g) ?? []).length;
  const tableRules = (code.match(/\btableRules\(/g) ?? []).length;
  if (composeCalls > 0) {
    fail(`${variant}: did NOT fuse — ${composeCalls} runtime compose( call(s) survived (expected 0; fused tables use tableRules().`);
  } else if (tableRules === 0) {
    fail(`${variant}: no tableRules( in emitted output — not a compiled table.`);
  } else {
    console.log(`  ✓ ${variant}: fused (${tableRules} tableRules(, 0 compose()`);
  }

  /*
   * (b) loads: importing the public entry + parsing a sample materializes the
   * table, catching a materializeDirectBuilders/rebind throw at gate time.
   */
  const entryPath = join(lessLib, entry);
  try {
    const mod = await import(pathToFileURL(entryPath));
    const parse = mod[fn];
    if (typeof parse !== 'function') {
      fail(`${variant}: public entry ${entry} has no ${fn}() export.`);
      continue;
    }
    const result = arg === null ? parse(SAMPLE) : parse(SAMPLE, arg);
    if (!result || typeof result !== 'object') {
      fail(`${variant}: ${fn}('${SAMPLE}') produced no result object.`);
    } else {
      console.log(`  ✓ ${variant}: loads + parses a sample via ${entry}`);
    }
  } catch (e) {
    fail(`${variant}: threw on load/parse via ${entry} — ${e.message.split('\n')[0]}`);
  }
}

if (failed) {
  console.error('\n✗ Less compose build-then-load gate FAILED — a variant did not fuse or would not load.');
  process.exit(1);
}
console.log('\n✓ Less compose build-then-load gate PASSED — all 4 variants fuse to tableRules( and load + parse.');
