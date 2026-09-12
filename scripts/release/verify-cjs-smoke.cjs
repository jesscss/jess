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
