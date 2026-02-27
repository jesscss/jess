#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MODE = process.argv.includes('--mode=upstream') ? 'upstream' : 'staged';

function run(command, args) {
  const rendered = [command, ...args].join(' ');
  console.log(`\n$ ${rendered}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readPackageScripts(packageDir) {
  const packageJsonPath = path.join(ROOT, packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  const json = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  return json.scripts ?? {};
}

function stagedFiles() {
  const output = execSync('git diff --cached --name-only --diff-filter=ACMR', {
    cwd: ROOT,
    encoding: 'utf8'
  });
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
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
      const output = execSync(`git diff --name-only --diff-filter=ACMR ${base}..HEAD`, {
        cwd: ROOT,
        encoding: 'utf8'
      });
      return output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    } catch {
      // Try next fallback ref.
    }
  }
  return [];
}

function packageDirs(files) {
  const unique = new Set();
  for (const file of files) {
    const match = file.match(/^packages\/[^/]+/);
    if (match) {
      unique.add(match[0]);
    }
  }
  return [...unique].sort();
}

function stagedLintableFiles(files, packageDir) {
  const prefix = `${packageDir}/`;
  return files.filter(file =>
    file.startsWith(prefix) && /\.(?:[cm]?js|[cm]?ts|tsx)$/.test(file)
  );
}

function runTypecheckForPackage(packageDir, scripts) {
  if (scripts.typecheck) {
    run('pnpm', ['--filter', `./${packageDir}`, 'typecheck']);
    return;
  }
  const tsBuild = path.join(ROOT, packageDir, 'tsconfig.build.json');
  if (existsSync(tsBuild)) {
    run('pnpm', ['-w', 'exec', 'tsc', '-p', `${packageDir}/tsconfig.build.json`, '--noEmit']);
    return;
  }
  const tsConfig = path.join(ROOT, packageDir, 'tsconfig.json');
  if (existsSync(tsConfig)) {
    run('pnpm', ['-w', 'exec', 'tsc', '-p', `${packageDir}/tsconfig.json`, '--noEmit']);
    return;
  }
  console.log(`- skip typecheck for ${packageDir} (no tsconfig or typecheck script)`);
}

function runBuildForPackage(packageDir, scripts) {
  if (scripts.build) {
    run('pnpm', ['--filter', `./${packageDir}`, 'build']);
    return;
  }
  console.log(`- skip build for ${packageDir} (no build script)`);
}

function runLintForPackage(packageDir, scripts) {
  void scripts;
  run('pnpm', [
    'exec',
    'eslint',
    `${packageDir}/**/*.{mjs,cjs,js,ts,tsx}`
  ]);
}

const files = MODE === 'upstream' ? changedFilesAgainstUpstream() : stagedFiles();
if (files.length === 0) {
  console.log(MODE === 'upstream'
    ? 'No branch changes against upstream. Skipping checks.'
    : 'No staged files. Skipping pre-commit checks.'
  );
  process.exit(0);
}

const changedPackages = packageDirs(files);
if (changedPackages.length === 0) {
  console.log('No staged package changes. Skipping package checks.');
  process.exit(0);
}

console.log(`Checking ${changedPackages.length} changed package(s) [mode=${MODE}]...`);
for (const packageDir of changedPackages) {
  const scripts = readPackageScripts(packageDir);
  if (!scripts) {
    console.log(`- skip ${packageDir} (missing package.json)`);
    continue;
  }
  console.log(`\n==> ${packageDir}`);
  if (MODE === 'upstream') {
    runTypecheckForPackage(packageDir, scripts);
    runBuildForPackage(packageDir, scripts);
    runLintForPackage(packageDir, scripts);
  } else {
    const filesForPackage = stagedLintableFiles(files, packageDir);
    if (filesForPackage.length === 0) {
      console.log(`- skip lint for ${packageDir} (no staged JS/TS files)`);
      continue;
    }
    run('pnpm', ['exec', 'eslint', ...filesForPackage]);
  }
}

console.log(MODE === 'upstream'
  ? '\nPre-push package checks passed.'
  : '\nPre-commit staged checks passed.'
);
