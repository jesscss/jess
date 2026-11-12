#!/usr/bin/env node
/*
 * CJS smoke test for the published compiler. `@jesscss/compiler` ships a CJS build
 * (`require('@jesscss/compiler')`) that `less` and other CommonJS consumers depend
 * on. ESM-only dependencies imported as a *default* (e.g. `chalk`) or via a
 * *subpath default* (e.g. `lodash-es/mergeWith.js`) get a broken `__toESM(..).default`
 * interop in the CJS output — `require(ESM)` returns a namespace with no
 * `__esModule` marker, so the value is double-wrapped and calls throw
 * "... is not a function". This shipped once in 2.0.0-alpha.18 and was only caught
 * downstream by less.js's CJS smoke; this guards it in the jess release preflight.
 *
 * Runs against the BUILT lib, so invoke after `build:release`.
 */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

/*
 * 0) Load order. A chunk that requires its own package's root `index.cjs` makes a
 *    cycle: requiring a subpath entry FIRST leaves the root's exports that come
 *    from that chunk `undefined` for good (it happened when rolldown's interop
 *    runtime landed in core's `index` chunk). So each package's subpath `require`
 *    entries load first in a fresh process, then the root, and no root export may
 *    be undefined.
 */
const packagesDir = path.join(__dirname, '../../packages');
const packageDirs = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (fs.existsSync(path.join(full, 'package.json'))) packageDirs.push(full);
    else walk(full);
  }
};
walk(packagesDir);

/* Program entries, not library entries: requiring one starts it (an LSP server opens its connection). */
const programEntries = new Set(['editor/language-service ./server']);
const cycles = [];
const unbuilt = [];
for (const dir of packageDirs) {
  const exportsField = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).exports;
  const root = exportsField?.['.']?.require;
  if (typeof root !== 'string') continue;
  if (!fs.existsSync(path.join(dir, root))) {
    unbuilt.push(path.relative(packagesDir, dir));
    continue;
  }
  for (const [sub, conditions] of Object.entries(exportsField)) {
    const file = sub === '.' ? undefined : conditions?.require;
    if (typeof file !== 'string' || !fs.existsSync(path.join(dir, file))) continue;
    if (programEntries.has(`${path.relative(packagesDir, dir)} ${sub}`)) continue;
    const undefinedKeys = execFileSync(process.execPath, ['-e',
      `require(${JSON.stringify(path.join(dir, file))});` +
      `const m = require(${JSON.stringify(path.join(dir, root))});` +
      'process.stdout.write(Object.keys(m).filter((k) => m[k] === undefined).join(","));'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 });
    if (undefinedKeys) cycles.push(`${path.relative(packagesDir, dir)}: ${sub} then . leaves ${undefinedKeys} undefined`);
  }
}
if (unbuilt.length > 0) {
  console.log(`CJS load order not checked, not built: ${unbuilt.join(', ')}`);
}
if (cycles.length > 0) {
  console.error(`CJS smoke FAILED: a subpath loaded before the root leaves root exports undefined (a chunk cycle):\n  ${cycles.join('\n  ')}`);
  process.exit(1);
}

const compilerCjs = path.join(__dirname, '../../packages/compiler/lib/index.cjs');
const mod = require(compilerCjs);
const Compiler = mod.Compiler ?? mod.default?.Compiler;
if (typeof Compiler !== 'function') {
  console.error(`CJS smoke FAILED: require('@jesscss/compiler') did not expose a Compiler constructor.`);
  process.exit(1);
}

async function main() {
  // 1) Construct — exercises the lodash-es `mergeWith` config merge.
  const compiler = new Compiler({});

  /*
   * 2) Drive the logger/diagnostic path — exercises `chalk`. With no plugin
   *    registered this resolves to a clean "no plugin" diagnostic; the only
   *    failure we care about is a broken-interop "... is not a function" throw.
   *    Any other error (e.g. "No plugin found") means the CJS lib loaded and ran.
   */
  try {
    await compiler.renderString('a { b: 1 }', { extension: '.less' });
  } catch (error) {
    if (/is not a function/.test(String(error && error.message))) {
      console.error(`CJS smoke FAILED: broken CommonJS interop — ${error.message}`);
      process.exit(1);
    }
  }
  console.log('CJS smoke passed: @jesscss/compiler constructs and runs under require().');
}

main().catch((error) => {
  console.error(`CJS smoke FAILED: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
