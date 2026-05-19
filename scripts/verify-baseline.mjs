#!/usr/bin/env node
/**
 * Commit gate: core tests + CSS parsers + Less fixture and compatibility
 * baselines must all pass.
 * Run before claiming completion or pushing. Fails fast on first failure.
 * Policy: always move the bar up — fix failures and add new critical suites here;
 * never relax expectations or remove tests to get green.
 *
 * With --changed: only run checks for changed baseline packages and their dependants
 * (based on git diff against upstream). Use for faster pre-push.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CHANGED_ONLY = process.argv.includes('--changed');

const BASELINE_PACKAGE_DIRS = new Set([
  'packages/core',
  'packages/less-parser',
  'packages/css-parser',
  'packages/jess',
  'packages/jess-plugin-less-compat'
]);

const NON_SOURCE_PATH_PATTERNS = [
  /\/build\//,
  /\/\.docusaurus\//,
  /\/dist\//,
  /\/coverage\//
];

const FULL_BASELINE_PATH_PATTERNS = [
  /^scripts\/verify-baseline\.mjs$/,
  /^scripts\/precommit-changed-checks\.mjs$/,
  /^scripts\/verify-node-copy-frontier\.mjs$/,
  /^scripts\/verify-render-buffer-frontier\.mjs$/,
  /^scripts\/verify-materialization-frontier\.mjs$/,
  /^scripts\/verify-package-exports\.mjs$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/
];

function run(name, args, opts = {}) {
  const { cwd = ROOT } = opts;
  const cmd = [name, ...args].join(' ');
  console.log(`\n>>> ${cmd}`);
  const r = spawnSync(name, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (r.status !== 0) {
    console.error(`\nVerify baseline failed: ${cmd} (exit ${r.status ?? 1})`);
    process.exit(r.status ?? 1);
  }
}

function runFrontierChecks() {
  run('pnpm', ['run', 'verify:node-copy-frontier']);
  run('pnpm', ['run', 'verify:render-buffer-frontier']);
  run('pnpm', ['run', 'verify:materialization-frontier']);
}

function getWorkspaceDeps(manifest) {
  const deps = new Set();
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const section = manifest[field];
    if (!section || typeof section !== 'object') {
      continue;
    }
    for (const [name, version] of Object.entries(section)) {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        deps.add(name);
      }
    }
  }
  return [...deps];
}

/** Build revDeps (dir -> dependants) and nameToDir for all workspace packages */
function buildBaselineGraph() {
  const nameToDir = new Map();
  const revDeps = new Map();

  const packagesDir = path.join(ROOT, 'packages');
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = `packages/${entry.name}`;
    const pkgPath = path.join(ROOT, dir, 'package.json');
    if (!existsSync(pkgPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (manifest.name) {
      nameToDir.set(manifest.name, dir);
    }
  }

  for (const dir of BASELINE_PACKAGE_DIRS) {
    revDeps.set(dir, []);
  }
  for (const dir of BASELINE_PACKAGE_DIRS) {
    const pkgPath = path.join(ROOT, dir, 'package.json');
    if (!existsSync(pkgPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const deps = getWorkspaceDeps(manifest);
    for (const depName of deps) {
      const depDir = nameToDir.get(depName);
      if (depDir && BASELINE_PACKAGE_DIRS.has(depDir)) {
        revDeps.get(depDir).push(dir);
      }
    }
  }

  return { revDeps, nameToDir };
}

function changedFilesAgainstUpstream() {
  const baseCandidates = ['@{upstream}', 'origin/main', 'origin/master'];
  for (const ref of baseCandidates) {
    try {
      const base = execSync(`git merge-base HEAD ${ref}`, {
        cwd: ROOT,
        encoding: 'utf8'
      }).trim();
      if (!base) {
        continue;
      }
      return uniqueLines([
        execSync(`git diff --name-only --diff-filter=ACMR ${base}..HEAD`, {
          cwd: ROOT,
          encoding: 'utf8'
        }),
        execSync('git diff --name-only --diff-filter=ACMR', {
          cwd: ROOT,
          encoding: 'utf8'
        }),
        execSync('git diff --cached --name-only --diff-filter=ACMR', {
          cwd: ROOT,
          encoding: 'utf8'
        })
      ]);
    } catch {
      // Try next fallback ref
    }
  }
  return [];
}

function uniqueLines(outputs) {
  return [...new Set(
    outputs
      .flatMap(output => output.split('\n'))
      .map(line => line.trim())
      .filter(Boolean)
  )];
}

function packageDirsFromFiles(files) {
  const filtered = files.filter(
    file => !NON_SOURCE_PATH_PATTERNS.some(pattern => pattern.test(file))
  );
  const dirs = new Set();
  for (const file of filtered) {
    const match = file.match(/^packages\/[^/]+/);
    if (match) {
      dirs.add(match[0]);
    }
  }
  return [...dirs];
}

function shouldRunFullBaselineForFiles(files) {
  return files.some(file =>
    FULL_BASELINE_PATH_PATTERNS.some(pattern => pattern.test(file))
  );
}

/**
 * Packages to run baseline checks for:
 * - Changed baseline packages
 * - Their dependants (baseline packages that depend on changed)
 * - Baseline packages whose workspace deps changed (affected by upstream changes)
 */
function getPackagesToCheck(changedDirs, revDeps, nameToDir) {
  const changedSet = new Set(changedDirs);
  const toCheck = new Set();

  // Changed baseline packages + their dependants
  const changedBaseline = changedDirs.filter(d => BASELINE_PACKAGE_DIRS.has(d));
  for (const dir of changedBaseline) {
    toCheck.add(dir);
    for (const dep of revDeps.get(dir) ?? []) {
      toCheck.add(dep);
    }
  }

  // Baseline packages whose workspace deps changed
  for (const dir of BASELINE_PACKAGE_DIRS) {
    const pkgPath = path.join(ROOT, dir, 'package.json');
    if (!existsSync(pkgPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const deps = getWorkspaceDeps(manifest);
    for (const depName of deps) {
      const depDir = nameToDir.get(depName);
      if (depDir && changedSet.has(depDir)) {
        toCheck.add(dir);
        break;
      }
    }
  }

  return [...toCheck].sort();
}

// --- Main ---

const { revDeps, nameToDir } = buildBaselineGraph();

let packagesToCheck = [...BASELINE_PACKAGE_DIRS].sort();
if (CHANGED_ONLY) {
  const changedFiles = changedFilesAgainstUpstream();
  if (shouldRunFullBaselineForFiles(changedFiles)) {
    console.log('Verify baseline (--changed): baseline gate or root dependency changed; running full baseline.');
  } else {
    const changedDirs = packageDirsFromFiles(changedFiles);
    packagesToCheck = getPackagesToCheck(changedDirs, revDeps, nameToDir);
  }
  if (packagesToCheck.length === 0) {
    console.log('Verify baseline (--changed): no baseline packages changed or affected. Running frontier checks only.');
    runFrontierChecks();
    console.log('\n>>> Verify baseline passed (frontier checks only).');
    process.exit(0);
  }
  console.log(
    `Verify baseline (--changed): ${packagesToCheck.length} package(s) to check: ${packagesToCheck.join(', ')}`
  );
} else {
  console.log('Verify baseline: core + parsers + Less fixture and compatibility suites');
}

const runCore = packagesToCheck.includes('packages/core');
const runLessParser = packagesToCheck.includes('packages/less-parser');
const runCssParser = packagesToCheck.includes('packages/css-parser');
const runJess = packagesToCheck.includes('packages/jess');
const runLessCompat = packagesToCheck.includes('packages/jess-plugin-less-compat');

// Build core if any downstream needs it
const needsCoreBuild = runCore || runLessParser || runCssParser || runJess || runLessCompat;
if (needsCoreBuild) {
  run('pnpm', ['--filter', '@jesscss/core', 'build']);
}

if (runCore) {
  run('pnpm', ['--filter', '@jesscss/core', 'test', '--', '--run']);
}
if (runLessParser) {
  run('pnpm', ['--filter', '@jesscss/less-parser', 'test']);
}
if (runCssParser) {
  run('pnpm', ['--filter', '@jesscss/css-parser', 'test']);
}
if (runJess) {
  run('pnpm', ['run', 'test:less:test-data']);
}
if (runLessCompat) {
  run('pnpm', ['--filter', './packages/jess-plugin-less-compat', 'test']);
}

runFrontierChecks();
run('pnpm', ['run', 'verify:package-exports']);

console.log('\n>>> Verify baseline passed (core + parsers + Less fixture and compatibility suites + frontier checks).');
