#!/usr/bin/env node
/**
 * The same render in Node and in the script sandbox, across the `@less/test-data`
 * `tests-unit` corpus: every fixture is rendered as it is (in Node) and again
 * with a `@plugin` that does nothing prepended (which moves it whole into the
 * Deno engine), and the two results (CSS, error codes, warning codes, apart
 * from the deprecation warning the added `@plugin` raises) are compared.
 *
 *   node scripts/compare-sandbox-corpus.mjs [--node-modules]
 *
 * The corpus is `$LESS_TEST_DATA_ROOT/tests-unit` (the Less.js
 * `packages/test-data` folder), else the installed `@less/test-data`, else the
 * sibling `../less.js` checkout, the same lookup as `compare-less-builds.mjs`.
 * Set it to a checkout of the branch the expected outputs come from.
 *
 * The corpus is copied to a temporary folder first, so nothing is written into
 * the checkout it comes from. A copy has no `package.json` or `node_modules`,
 * so each fixture's read root is its own config folder; `--node-modules` puts a
 * `node_modules` at the copy's root, making the copy's root the read root, as
 * an installed project's is. Build first (`pnpm run build:release`).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Compiler } = await import(path.join(root, 'packages/jess/lib/index.js'));
const testDataRoot = () => {
  const candidates = [process.env.LESS_TEST_DATA_ROOT];
  try {
    candidates.push(path.dirname(require.resolve('@less/test-data/package.json')));
  } catch {
    // Fall through to the sibling checkout.
  }
  candidates.push(path.resolve(root, '../less.js/packages/test-data'));
  const found = candidates.find(dir => dir && fs.existsSync(dir));
  if (!found) {
    throw new Error('Unable to resolve @less/test-data. Set LESS_TEST_DATA_ROOT to the Less.js packages/test-data directory.');
  }
  return fs.realpathSync(found);
};
const corpus = path.join(testDataRoot(), 'tests-unit');
const copy = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-sandbox-corpus-')));
const fixtures = path.join(copy, 'tests-unit');
fs.cpSync(corpus, fixtures, { recursive: true });
if (process.argv.includes('--node-modules')) {
  fs.mkdirSync(path.join(copy, 'node_modules/marker'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'node_modules/marker/package.json'), '{"name":"marker"}');
}

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
    } else if (entry.name.endsWith('.less') && !entry.name.startsWith('_')) {
      files.push(file);
    }
  }
};
walk(fixtures);

const compiler = new Compiler();
const render = file => compiler.renderToResult(file, { suppressWarnings: true }).then(
  result => JSON.stringify({
    css: result.css,
    errors: result.errors.map(error => error.code),
    warnings: result.warnings.map(warning => warning.code).filter(code => code !== 'deprecation/less-plugin')
  }),
  error => `threw ${error?.code ?? ''} ${String(error?.message).split('\n')[0]}`.replaceAll('__sandboxed-', '')
);

let same = 0;
let skipped = 0;
const differ = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (/@plugin|@-use|@use\b/.test(source)) {
    skipped++;
    continue;
  }
  const dir = path.dirname(file);
  fs.writeFileSync(path.join(dir, '__noop.js'), 'module.exports = { install() {} };');
  const sandboxed = path.join(dir, `__sandboxed-${path.basename(file)}`);
  fs.writeFileSync(sandboxed, `@plugin "./__noop.js";\n${source}`);
  const inNode = await render(file);
  const inSandbox = (await render(sandboxed)).replaceAll(sandboxed, file);
  if (inNode === inSandbox) {
    same++;
  } else {
    differ.push({ fixture: path.relative(fixtures, file), inNode: inNode.slice(0, 240), inSandbox: inSandbox.slice(0, 240) });
  }
}
compiler.dispose();
fs.rmSync(copy, { recursive: true, force: true });

console.log(`${same} same, ${differ.length} different, ${skipped} skipped (they run a script already)`);
for (const { fixture, inNode, inSandbox } of differ) {
  console.log(`\n${fixture}\n  Node:    ${inNode}\n  sandbox: ${inSandbox}`);
}
process.exitCode = differ.length === 0 ? 0 : 1;
