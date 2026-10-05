#!/usr/bin/env node
/*
 * Build-then-LOAD gate for the compose flip (W0) — CSS, Less, SCSS AND Jess.
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
 * This gate closes both, for every dialect that composes on cssBaseRules and
 * for the CSS base itself. It also asserts the recognition leaves were fused
 * (jesscss/jess#176), in the ESM and the CommonJS build of every variant: the
 * table reads `@jesscss/parser-shared` only for its compose metadata, never as
 * grammar (`recognitionReads` in parseman-fallback-detector.mjs says why the
 * import itself stays), and that each public entry loads only its own variant,
 * so the compiler-facing AST entry never pulls in the CST grammar. These are the
 * build-gated replacements for the Vite build-in-a-test fusion checks. It runs
 * against already-built `lib/` (CI builds every package before the check
 * step), so it must never trigger its own build.
 *
 * Run:  node scripts/probe/compose-fused-check.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { callCount, recognitionReads } from '../parseman-fallback-detector.mjs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/*
 * The four fused variants per dialect and the public entry that loads each one.
 * Parsing a tiny sample through the entry materializes that variant's compiled
 * table — the exact moment a load/rebind throw surfaces.
 */
const DIALECTS = [
  {
    name: 'CSS',
    lib: join(repo, 'packages/syntax/css/css-parser/lib'),
    cstFn: 'parseCssCst',

    /* The rule map every superset composes on, loaded by each of their tables. */
    tables: ['grammar/base.js']
  },
  {
    name: 'Less',
    lib: join(repo, 'packages/syntax/less/less-parser/lib'),
    cstFn: 'parseLessCst'
  },
  {
    name: 'SCSS',
    lib: join(repo, 'packages/syntax/scss/scss-parser/lib'),
    cstFn: 'parseScssCst'
  },
  {
    name: 'Jess',
    lib: join(repo, 'packages/syntax/jess/jess-parser/lib'),
    cstFn: 'parseJessCst'
  }
];

const variantsFor = cstFn => [
  { variant: 'grammar/ast.js',           entry: 'index.js',          fn: 'parse', arg: null },
  { variant: 'grammar/ast/positions.js', entry: 'positions.js',      fn: 'parse', arg: null },
  { variant: 'grammar/cst.js',           entry: 'cst.js',            fn: cstFn,   arg: 'Stylesheet' },
  { variant: 'grammar/cst/positions.js', entry: 'cst/positions.js',  fn: cstFn,   arg: 'Stylesheet' }
];

const SAMPLE = 'a{color:red}';

/* A variant's CommonJS build, which the package's `require` condition serves. */
const withCjs = variant => [variant, variant.replace(/\.js$/, '.cjs')];

let failed = false;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failed = true;
};

/*
 * (a) fused: the emitted table must be `tableRules(`, with NO runtime
 * `compose(`, and its recognition leaves must be in it: parser-shared is read
 * only for its compose metadata. False when the file was not emitted.
 */
const checkTable = (lib, variant) => {
  const variantPath = join(lib, variant);
  if (!existsSync(variantPath)) {
    fail(`${variant}: MISSING — variant was not emitted.`);
    return false;
  }
  const code = readFileSync(variantPath, 'utf8');
  const composeCalls = callCount(code, 'compose', 'composeLeaf');
  const tableRules = callCount(code, 'tableRules');
  if (composeCalls > 0) {
    fail(`${variant}: did NOT fuse — ${composeCalls} runtime compose(/composeLeaf( call(s) survived (expected 0; fused tables use tableRules().`);
  } else if (tableRules === 0) {
    fail(`${variant}: no tableRules( in emitted output — not a compiled table.`);
  } else {
    console.log(`  ✓ ${variant}: fused (${tableRules} tableRules(, 0 compose()`);
  }

  const recognition = recognitionReads(code);
  if (recognition.length > 0) {
    fail(`${variant}: recognition NOT fused — ${recognition.map(({ line, detail }) => `line ${line}: ${detail}`).join('; ')}`);
  } else {
    console.log(`  ✓ ${variant}: recognition fused (parser-shared read only as compose metadata)`);
  }
  return true;
};

for (const { name, lib, cstFn, tables = [] } of DIALECTS) {
  console.log(`${name}:`);
  if (!existsSync(lib)) {
    fail(`no built ${name} parser lib at ${lib} — build the workspace first.`);
    continue;
  }

  for (const variant of tables.flatMap(withCjs)) {
    checkTable(lib, variant);
  }

  for (const { variant: esm, entry, fn, arg } of variantsFor(cstFn)) {
    if (!withCjs(esm).map(variant => checkTable(lib, variant)).every(Boolean)) {
      continue;
    }

    /*
     * (b) loads: importing the public entry + parsing a sample materializes the
     * table, catching a materializeDirectBuilders/rebind throw at gate time.
     */
    const entryPath = join(lib, entry);
    try {
      const mod = await import(pathToFileURL(entryPath));
      const parse = mod[fn];
      if (typeof parse !== 'function') {
        fail(`${esm}: public entry ${entry} has no ${fn}() export.`);
        continue;
      }
      const result = arg === null ? parse(SAMPLE) : parse(SAMPLE, arg);
      if (!result || typeof result !== 'object') {
        fail(`${esm}: ${fn}('${SAMPLE}') produced no result object.`);
      } else {
        console.log(`  ✓ ${esm}: loads + parses a sample via ${entry}`);
      }
    } catch (e) {
      fail(`${esm}: threw on load/parse via ${entry} — ${e.message.split('\n')[0]}`);
    }

    /*
     * (c) isolated: everything the entry loads from its own package reaches its
     * variant's table and no other, so the compiler-facing AST entry never loads
     * the CST grammar.
     */
    const grammarDir = join(lib, 'grammar');
    const loaded = new Set([entryPath]);
    for (const file of loaded) {
      for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/(?:from|import) "(\.\.?\/[^"]+)"/g)) {
        loaded.add(resolve(dirname(file), specifier));
      }
    }
    const tablesLoaded = [...loaded].filter(path => path.startsWith(grammarDir));
    if (tablesLoaded.length === 1 && tablesLoaded[0] === join(lib, esm)) {
      console.log(`  ✓ ${entry}: loads only ${esm}`);
    } else {
      fail(`${entry}: loads ${tablesLoaded.map(path => path.slice(lib.length + 1)).join(', ')} — expected only ${esm}.`);
    }
  }
}

if (failed) {
  console.error('\n✗ Compose build-then-load gate FAILED — a variant did not fuse or would not load.');
  process.exit(1);
}
console.log('\n✓ Compose build-then-load gate PASSED — all CSS + Less + SCSS + Jess variants (ESM and CommonJS) fuse to tableRules(, recognition included, and each loads + parses through an entry that loads no other variant.');
