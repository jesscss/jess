#!/usr/bin/env node
/**
 * Prove that the alpha release set works as a consumer sees it.
 *
 * This deliberately does not use the workspace package manager after packing:
 * every Jess package comes from an npm-style tarball in an empty temporary
 * project. That catches workspace links, missing `files` entries, invalid
 * workspace-protocol rewriting, and package-closure omissions which source
 * tests cannot see.
 *
 * It is intentionally version-agnostic. The alpha release scripts resolve the
 * final lockstep version later; `pnpm pack` rewrites workspace dependencies in
 * each tarball to the manifests' current common version, and npm installs the
 * complete local tarball set together.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAlphaReleasePlan } from './release-utils.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const allowlistPath = path.join(rootDir, 'scripts/release/alpha-allowlist.json');
const plan = getAlphaReleasePlan({ rootDir, allowlistPath });

const keep = process.argv.includes('--keep');

function fail(message) {
  throw new Error(message);
}

function run(command, args, cwd, options = {}) {
  const rendered = [command, ...args].join(' ');
  console.log(`\n$ ${rendered}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options
  });
  if (result.error) {
    fail(`${rendered} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    fail(`${rendered} failed with ${result.status ?? 'unknown exit'}${output ? `:\n${output}` : ''}`);
  }
  return result;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readPackedManifest(tarball, { quiet = false } = {}) {
  const result = spawnSync('tar', ['-xOf', tarball, 'package/package.json'], {
    cwd: rootDir,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  if (result.error || result.status !== 0) {
    if (!quiet) {
      fail(`Unable to read packed manifest ${tarball}: ${result.error?.message ?? result.stderr ?? 'tar failed'}`);
    }
    return null;
  }
  return JSON.parse(result.stdout);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function assertPackedManifest(pkg, tarball, expectedVersion) {
  const manifest = readPackedManifest(tarball);
  assert(manifest.name === pkg.name, `${tarball}: expected ${pkg.name}, got ${manifest.name ?? '(unnamed)'}`);
  assert(manifest.version === expectedVersion,
    `${pkg.name}: packed ${manifest.version ?? '(missing version)'}, expected ${expectedVersion}`);

  // npm does not install devDependencies for a normal consumer, but it does
  // publish their metadata. A local path here is still a broken release
  // artifact: it leaks a workstation path to every registry consumer and makes
  // `npm install --include=dev` impossible outside this checkout. Check every
  // dependency section, not just the runtime installation graph.
  for (const sectionName of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    const section = manifest[sectionName];
    if (!section || typeof section !== 'object') {
      continue;
    }
    for (const [name, specifier] of Object.entries(section)) {
      assert(!String(specifier).startsWith('workspace:'),
        `${pkg.name}: packed ${sectionName}.${name} still uses ${specifier}`);
      assert(!String(specifier).startsWith('link:'),
        `${pkg.name}: packed ${sectionName}.${name} still uses ${specifier}`);
    }
  }

  // This private workspace package supplies Parseman macro inputs while the
  // parser package is built. Macro expansion leaves no runtime import of it,
  // so it must never become a consumer dependency. It can remain a development
  // dependency: pnpm rewrites its workspace specifier in packed metadata, and
  // consumers do not install it.
  for (const sectionName of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const section = manifest[sectionName];
    assert(!section?.['@jesscss/internal-css-recognition'],
      `${pkg.name}: private macro input leaked into packed ${sectionName}`);
  }
}

function packageDirFor(pkgName) {
  if (pkgName.startsWith('@')) {
    const [scope, name] = pkgName.split('/');
    return path.join(scope, name);
  }
  return pkgName;
}

function assertConsumerPackagesAreReal(consumerDir, pkgNames) {
  const modulesDir = path.join(consumerDir, 'node_modules');
  const repoReal = realpathSync.native(rootDir);
  for (const name of pkgNames) {
    const installed = path.join(modulesDir, packageDirFor(name));
    assert(existsSync(installed), `consumer install omitted ${name}`);
    assert(!lstatSync(installed).isSymbolicLink(), `consumer install linked ${name} instead of unpacking it`);
    const resolved = realpathSync.native(installed);
    assert(!resolved.startsWith(`${repoReal}${path.sep}`) && resolved !== repoReal,
      `consumer resolves ${name} into the Jess workspace: ${resolved}`);
  }

  const pending = [modulesDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = realpathSync.native(candidate);
        assert(!resolved.startsWith(`${repoReal}${path.sep}`) && resolved !== repoReal,
          `consumer symlink resolves into the Jess workspace: ${candidate} -> ${resolved}`);
      } else if (entry.isDirectory()) {
        pending.push(candidate);
      }
    }
  }
}

function writeConsumerChecks(consumerDir, packageNames) {
  const imports = path.join(consumerDir, 'imports.mjs');
  const cli = path.join(consumerDir, 'cli.mjs');
  const optionalPlugin = path.join(consumerDir, 'plugin-js.mjs');

  writeFileSync(imports, `
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const names = ${JSON.stringify(packageNames, null, 2)};
for (const name of names) {
  const cjs = require(name);
  const esm = await import(name);
  assert.ok(cjs, \`CJS import returned nothing for \${name}\`);
  assert.ok(esm, \`ESM import returned nothing for \${name}\`);
}

const cjsJess = require('jess');
const esmJess = await import('jess');
assert.equal(typeof cjsJess.Compiler, 'function');
assert.equal(typeof esmJess.Compiler, 'function');

// CSS is deliberately explicit: it is a Context document/inlining plugin, not
// a default Jess compiler mode. Prove a packed consumer can opt in and receives
// the same direct Stylesheet document boundary without adding it to Jess's
// built-in plugin registration.
const { default: cssPluginFactory } = await import('@jesscss/plugin-css');
const cssPlugin = cssPluginFactory();
const cssResult = cssPlugin.safeParse('entry.css', '.entry { color: red; }');
assert.equal(cssResult.errors.length, 0);
assert.equal(cssResult.document.type, 'Stylesheet');
console.log(\`ESM/CJS roots ok for \${names.length} packed packages\`);
`.trimStart());

  writeFileSync(cli, `
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const consumer = process.cwd();
const bin = path.join(consumer, 'node_modules', '.bin');
const lessc = path.join(bin, process.platform === 'win32' ? 'lessc.cmd' : 'lessc');
const jess = path.join(bin, process.platform === 'win32' ? 'jess.cmd' : 'jess');
const fixture = path.join(consumer, 'fixtures');
mkdirSync(fixture, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: fixture,
    encoding: 'utf8',
    ...options
  });
  if (result.error) throw result.error;
  return result;
}

assert.ok(existsSync(lessc), 'packed install did not expose lessc');
assert.ok(existsSync(jess), 'packed install did not expose jess');

const version = run(lessc, ['--version']);
assert.equal(version.status, 0, version.stderr);
assert.match(version.stdout, /lessc \\d+\\.\\d+\\.\\d+-alpha\\.\\d+/u);

const stdin = run(lessc, ['-'], { input: '.stdin { color: red; }\\n' });
assert.equal(stdin.status, 0, stdin.stderr);
assert.match(stdin.stdout, /color: red/u);

writeFileSync(path.join(fixture, 'dep.less'), '.dep { color: blue; }\\n');
writeFileSync(path.join(fixture, 'entry.less'), '@import "./dep.less";\\n.entry { color: red; }\\n');
const lessOut = path.join(fixture, 'entry.css');
const lessFile = run(lessc, ['entry.less', lessOut]);
assert.equal(lessFile.status, 0, lessFile.stderr);
const css = readFileSync(lessOut, 'utf8');
assert.match(css, /\\.dep/u);
assert.match(css, /color: blue/u);
assert.match(css, /\\.entry/u);
assert.match(css, /color: red/u);

const jessOut = path.join(fixture, 'jess.css');
const jessFile = run(jess, ['entry.less', jessOut]);
assert.equal(jessFile.status, 0, jessFile.stderr);
assert.match(readFileSync(jessOut, 'utf8'), /color: blue/u);

writeFileSync(path.join(fixture, 'bad.less'), '.broken { color: }\\n.next {\\n');
const bad = run(lessc, ['bad.less']);
assert.notEqual(bad.status, 0, 'lessc accepted malformed input');
assert.ok(bad.stderr.trim().length > 0, 'lessc emitted no malformed-input diagnostic');

console.log('packed jess/lessc stdin, file, import, and error paths ok');
`.trimStart());

  // plugin-js is an optional runtime capability. Install it from its tarball
  // and prove the clean consumer reaches its deliberate missing-Deno gate,
  // rather than silently falling back to Node execution. This stays deterministic
  // even where a system Deno happens to be installed.
  writeFileSync(optionalPlugin, `
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import jsPlugin, { JsPlugin } from '@jesscss/plugin-js';

assert.equal(typeof jsPlugin, 'function');
assert.equal(typeof JsPlugin, 'function');
const fixture = path.join(process.cwd(), 'plugin-js-fixture');
mkdirSync(fixture, { recursive: true });
const pluginFile = path.join(fixture, 'plugin.js');
writeFileSync(pluginFile, 'registerPlugin({ install: function() {} });\\n');
const plugin = jsPlugin({
  denoCommand: path.join(fixture, 'missing-deno-binary'),
  jsReadRoot: fixture
});
await assert.rejects(
  () => plugin.importPlugin(pluginFile),
  /Deno runtime is required/u
);
plugin.dispose();
console.log('packed optional plugin-js has the expected sandbox-runtime gate');
`.trimStart());

  return { imports, cli, optionalPlugin };
}

function main() {
  if (plan.errors.length > 0) {
    fail(`Alpha publish-set validation failed:\n- ${plan.errors.join('\n- ')}`);
  }
  const versions = new Set(plan.packages.map(pkg => pkg.manifest.version));
  assert(versions.size === 1,
    `Packed-consumer proof requires the lockstep release set; found ${[...versions].join(', ')}`);
  const version = [...versions][0];
  assert(version, 'Alpha publish set has no version.');

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'jess-alpha-packed-consumer-'));
  const packDir = path.join(tempRoot, 'packs');
  const consumerDir = path.join(tempRoot, 'consumer');
  try {
    for (const dir of [packDir, consumerDir]) {
      // mkdirSync only creates inside this script's exact mkdtemp root.
      mkdirSync(dir, { recursive: true });
    }

    const tarballs = new Map();
    for (const name of plan.publishOrder) {
      const pkg = plan.packagesByName.get(name);
      assert(pkg, `No package metadata for allowlisted ${name}`);
      run('pnpm', ['pack', '--pack-destination', packDir], pkg.dir);
      const expected = path.join(packDir, `${name.replace('@', '').replace('/', '-')}-${version}.tgz`);
      // pnpm's filename escaping is documented for unscoped names, but scoped
      // names have changed format across pnpm versions. Find the new tarball by
      // inspecting its manifest rather than relying on a filename convention.
      const candidates = readdirSync(packDir)
        .map(file => path.join(packDir, file))
        .filter(file => file.endsWith('.tgz'));
      const tarball = candidates.find((file) => {
        try {
          return readPackedManifest(file, { quiet: true })?.name === name;
        } catch {
          return false;
        }
      });
      assert(tarball, `pnpm pack did not produce a tarball for ${name} (expected near ${expected})`);
      assertPackedManifest(pkg, tarball, version);
      tarballs.set(name, tarball);
    }

    const dependencies = Object.fromEntries(plan.publishOrder.map(name => [
      name,
      `file:${path.relative(consumerDir, tarballs.get(name))}`
    ]));
    writeJson(path.join(consumerDir, 'package.json'), {
      name: 'jess-alpha-packed-consumer-proof',
      private: true,
      version: '0.0.0',
      type: 'module',
      dependencies
    });

    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev'], consumerDir);
    assertConsumerPackagesAreReal(consumerDir, plan.publishOrder);
    const checks = writeConsumerChecks(consumerDir, plan.publishOrder);
    run(process.execPath, [checks.imports], consumerDir);
    run(process.execPath, [checks.cli], consumerDir);
    run(process.execPath, [checks.optionalPlugin], consumerDir);
    console.log(`\nPacked alpha consumer proof passed (${plan.publishOrder.length} package tarballs at ${version}).`);
  } finally {
    if (keep) {
      console.log(`Kept packed consumer fixture: ${tempRoot}`);
    } else {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`\nPacked alpha consumer proof failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
