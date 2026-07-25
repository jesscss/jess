#!/usr/bin/env node
/**
 * Build guard: every functional grammar MUST stay fully macro-buildable.
 *
 * The parseman macro plugin compiles each `rules()`/`compose()` grammar to inline
 * JS at build time. If a rule can't be compiled it silently falls back to the
 * INTERPRETER — emitted as `_rp[N].parse(...)` in the built bundle. That is a real
 * regression (correct but slow, and it means a construct stopped lowering). This
 * script scans the built artifacts and FAILS if any interpreter fallback appears.
 *
 * It also reports how many regexes lowered to the fast `charCodeAt` path vs the
 * `RegExp.exec` fallback (informational — RegExp.exec is an accepted path, not a
 * failure), so drift is visible.
 *
 * Two modes:
 *   --no-build     Scan the artifacts already present in `packages/<pkg>/lib`.
 *                  Used by verify:pr / CI, which already ran the clean serial
 *                  topological build — this gate must never trigger a SECOND
 *                  full rebuild. In this mode the compose-warning half of the
 *                  concern is not checked here: build output no longer exists,
 *                  and `verify-compose-integrity.mjs --log` owns that half.
 *   (no --no-build) Clean each parser's lib, build in dependency order, then scan.
 *                  Also greps the captured build output for compose/rules-level
 *                  parseman warnings, free to check when we have the output.
 *
 * Run: `pnpm check:macro`  (or `pnpm check:macro -- --no-build`).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * parseman-macro grammar packages, in dependency (compose) order: each composes
 * over the previous one's compiled artifact. Kept in sync with the
 * PARSER_PACKAGES list in verify-compose-integrity.mjs.
 */
const PARSERS = [
  'internal-css-recognition',
  'css-parser',
  'less-parser',
  'scss-parser',
  'jess-parser'
];

const noBuild = process.argv.includes('--no-build');

/**
 * Every emitted ESM module under the package's `lib/`.
 *
 * Deliberately NOT a fixed list of entry names. The entry set moves — `lib/jess.js`
 * existed in every parser until the core-free CST entries landed, and the
 * hard-coded `['index.js', 'grammar.js', 'jess.js']` triple this script used to
 * read turned into an immediate ENOENT. Reading the directory is also a superset
 * of the `exports` map: `css-parser` ships `lib/cst-css.js`, which `./cst`
 * re-exports but the map never names directly, so an exports-driven walk would
 * leave it unscanned.
 *
 * `.cjs` is skipped: it is the same macro lowering emitted in the other module
 * format (marker counts are byte-for-byte identical), so scanning it would only
 * double every number.
 */
function builtEsmModules(libDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        files.push(full);
      }
    }
  };
  walk(libDir);
  return files.sort();
}

let failed = false;

for (const pkg of PARSERS) {
  const name = `@jesscss/${pkg}`;
  const libDir = resolve(root, 'packages', pkg, 'lib');
  let output = '';

  if (!noBuild) {
    /*
     * Clean first: an incremental build leaves stale modules behind, and a stale
     * lib both hides a fresh degrade and reports counts for code that is no
     * longer emitted. Same reason verify-compose-integrity.mjs clears lib.
     */
    rmSync(libDir, { recursive: true, force: true });
    const result = spawnSync('pnpm', ['--filter', name, 'build'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    output = String(result.stdout ?? '') + String(result.stderr ?? '');
    if (result.status !== 0) {
      console.error(`✗ ${name}: build FAILED\n${output}`);
      failed = true;
      continue;
    }
  }

  if (!existsSync(libDir)) {
    console.error(`✗ ${name}: no build output at ${relative(root, libDir)}`
      + (noBuild ? ' — --no-build expects an already-built workspace.' : ''));
    failed = true;
    continue;
  }

  const modules = builtEsmModules(libDir);
  if (modules.length === 0) {
    console.error(`✗ ${name}: ${relative(root, libDir)} contains no ESM modules to scan.`);
    failed = true;
    continue;
  }

  /*
   * A `[parseman] … falling back to runtime` warning means a whole grammar (or a
   * compose arg) didn't compile — a hard regression. Only checkable in build mode.
   */
  const composeWarn = noBuild
    ? null
    : /\[parseman\].*(falling back to runtime|isn't a build-resolvable)/i.exec(output);

  const bundle = modules.map(file => readFileSync(file, 'utf8')).join('\n');
  const interp = (bundle.match(/_rp\[\d+\]\.parse\(/g) ?? []).length;
  const regexExec = (bundle.match(/\.exec\(input\)/g) ?? []).length;
  const charCode = (bundle.match(/charCodeAt\(/g) ?? []).length;

  if (interp > 0 || composeWarn) {
    console.error(`✗ ${name}: NOT fully macro-buildable — `
      + `${interp} interpreter fallback(s)${composeWarn ? `, warning: ${composeWarn[0]}` : ''}`);
    failed = true;
  } else {
    /*
     * Marker totals are a drift signal, not a census: `index.js` re-bundles the
     * grammar, so a construct reachable from two entries is counted twice.
     */
    const total = charCode + regexExec;
    const pct = total === 0 ? '0' : ((charCode / total) * 100).toFixed(1);
    console.log(`✓ ${name}: fully compiled — 0 interpreter fallbacks `
      + `(${modules.length} ESM module(s); ${charCode} charCodeAt vs ${regexExec} RegExp.exec — ${pct}% charCodeAt)`);
  }
}

if (failed) {
  console.error('\nMacro-buildability guard FAILED. A grammar rule stopped compiling to inline JS.');
  process.exit(1);
}
console.log('\nAll parsers are fully macro-buildable.');
