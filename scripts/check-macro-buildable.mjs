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
 * It ALSO fails if a built module reads an identifier nothing binds. A macro
 * import (`makeWord`, `sequence`, `node`, ...) has no runtime existence, so a
 * macro-authored value that survives un-lowered — an exported `rules()` factory
 * is how this happens — emits code that throws `ReferenceError` on first call
 * while producing no interpreter marker at all. See `undefinedReferences`.
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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const require = createRequire(import.meta.url);

/*
 * espree + eslint-scope come from the workspace's eslint install rather than a
 * direct dependency: they are already present, already the versions eslint
 * itself parses this repo with, and adding a second copy of a JS parser to the
 * root just for this gate is not worth it.
 */
const eslintEntry = require.resolve('eslint');
const espree = require(require.resolve('espree', { paths: [eslintEntry] }));
const eslintScope = require(require.resolve('eslint-scope', { paths: [eslintEntry] }));
const globals = require('globals');

/*
 * Anything a built module may legitimately reference without declaring it.
 * `es2025` covers the language builtins, `node`/`browser` the host globals a
 * bundled artifact can reach for.
 */
const AMBIENT_GLOBALS = new Set([
  ...Object.keys(globals.node ?? {}),
  ...Object.keys(globals.browser ?? {}),
  ...Object.keys(globals.es2025 ?? globals.es2024 ?? {})
]);

/**
 * Identifiers a module reads but never binds, minus the ambient globals.
 *
 * This is the second half of macro-buildability, and the half the interpreter
 * marker misses. Grammar sources are written in parseman's macro vocabulary
 * (`makeWord`, `sequence`, `node`, ...), which exists ONLY at build time: the
 * macro plugin lowers every call site and the packages emit no runtime
 * `parseman` combinator import. If any macro-authored value survives into the
 * artifact un-lowered — an exported `rules()` factory is the way this happens,
 * because the plugin then has to emit a live binding for it — the emitted code
 * still names the macro-only identifiers and throws `ReferenceError` on first
 * call. No interpreter marker appears, so the fallback scan reports a clean
 * bill of health for a module that cannot run.
 *
 * Scope analysis rather than a text scan: `rule`, `node`, `not`, `field` and
 * friends are also ordinary local names in the hand-written host modules, and a
 * grep-level check reports them as failures.
 */
function undefinedReferences(file, code) {
  const script = file.endsWith('.cjs');
  const sourceType = script ? 'script' : 'module';
  const ast = espree.parse(code, { ecmaVersion: 'latest', sourceType, loc: true, range: true });
  const scopes = eslintScope.analyze(ast, { ecmaVersion: 2025, sourceType });
  const found = new Map();
  for (const ref of scopes.globalScope.through) {
    const { name, loc } = ref.identifier;
    if (AMBIENT_GLOBALS.has(name) || found.has(name)) {
      continue;
    }
    found.set(name, loc.start.line);
  }
  return found;
}

/*
 * parseman-macro grammar packages, in dependency (compose) order: each composes
 * over the previous one's compiled artifact. Kept in sync with the
 * PARSER_PACKAGES list in verify-compose-integrity.mjs.
 */
const PARSERS = [
  /*
   * Each entry: { dir, npm } — the directory under packages/ (post-regroup
   * uses the nested syntax/ shape) and the npm package name for `--filter`.
   * Keep in dependency (compose) order, matching verify-compose-integrity.mjs.
   */
  { dir: 'parser-shared', npm: '@jesscss/parser-shared' },
  { dir: 'syntax/css/css-parser', npm: '@jesscss/css-parser' },
  { dir: 'syntax/less/less-parser', npm: '@jesscss/less-parser' },
  { dir: 'syntax/scss/scss-parser', npm: '@jesscss/scss-parser' },
  { dir: 'syntax/jess/jess-parser', npm: '@jesscss/jess-parser' }
];

const noBuild = process.argv.includes('--no-build');

/**
 * Every emitted ESM module under the package's `lib/`.
 *
 * Deliberately NOT a fixed list of entry names. The entry set moves — `lib/jess.js`
 * existed in every parser until the core-free CST entries landed, and the
 * hard-coded `['index.js', 'grammar.js', 'jess.js']` triple this script used to
 * read turned into an immediate ENOENT. Reading the directory is also a superset
 * of the `exports` map: `css-parser` ships `lib/chunks/*.js`, which its entries
 * import but the map never names directly, so an exports-driven walk would
 * leave them unscanned.
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
  const name = pkg.npm;
  const libDir = resolve(root, 'packages', pkg.dir, 'lib');
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
      stdio: ['ignore', 'pipe', 'pipe'],

      /*
       * A parser package compiles its grammar once per build config, and each
       * compile dumps the full parseman gating report. Past spawnSync's 1 MiB
       * default the child is killed with ENOBUFS, which surfaces here as a
       * build that "failed" with a truncated log and a half-written lib/ —
       * indistinguishable from a real degrade. Give it room.
       */
      maxBuffer: 256 * 1024 * 1024
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

  const sources = modules.map(file => [file, readFileSync(file, 'utf8')]);
  const bundle = sources.map(([, code]) => code).join('\n');
  const interp = (bundle.match(/_rp\[\d+\]\.parse\(/g) ?? []).length;
  const regexExec = (bundle.match(/\.exec\(input\)/g) ?? []).length;
  const charCode = (bundle.match(/charCodeAt\(/g) ?? []).length;

  const undefined_ = [];
  for (const [file, code] of sources) {
    for (const [ident, line] of undefinedReferences(file, code)) {
      undefined_.push(`${relative(root, file)}:${line} ${ident}`);
    }
  }

  if (undefined_.length > 0) {
    console.error(`✗ ${name}: ${undefined_.length} undefined identifier reference(s) in built output — `
      + 'a macro-authored value survived un-lowered and will throw ReferenceError when reached:');
    for (const entry of undefined_.slice(0, 20)) {
      console.error(`    ${entry}`);
    }
    if (undefined_.length > 20) {
      console.error(`    … and ${undefined_.length - 20} more`);
    }
    failed = true;
  }

  if (interp > 0 || composeWarn) {
    console.error(`✗ ${name}: NOT fully macro-buildable — `
      + `${interp} interpreter fallback(s)${composeWarn ? `, warning: ${composeWarn[0]}` : ''}`);
    failed = true;
  } else if (undefined_.length === 0) {
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
  console.error('\nMacro-buildability guard FAILED. A grammar rule stopped compiling to inline JS, '
    + 'or a macro-authored value reached the artifact un-lowered.');
  process.exit(1);
}
console.log('\nAll parsers are fully macro-buildable.');
