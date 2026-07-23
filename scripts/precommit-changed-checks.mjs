#!/usr/bin/env node
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stagedTouchedLines, stagedLintableFiles, stagedLintMessages } from './staged-lint.mjs';

const ROOT = process.cwd();
const MODE = process.argv.includes('--mode=upstream') ? 'upstream' : 'staged';

const NON_SOURCE_PATH_PATTERNS = [
  /\/build\//,
  /\/\.docusaurus\//,
  /\/dist\//,
  /\/coverage\//
];

function requireCleanPushTarget() {
  if (MODE !== 'upstream') {
    return;
  }
  for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
    const result = spawnSync('git', args, { cwd: ROOT, stdio: 'ignore' });
    if (result.status !== 0) {
      console.error('Pre-push checks validate the committed push target. Commit or stash tracked working-tree changes before pushing.');
      process.exit(1);
    }
  }
}

function run(command, args) {
  const rendered = [command, ...args].join(' ');
  console.log(`\n$ ${rendered}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
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

function filterRelevantFiles(files) {
  return files.filter(file => !NON_SOURCE_PATH_PATTERNS.some(pattern => pattern.test(file)));
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
      // Try next fallback ref.
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

function hasCodeImpactingChanges(files, packageDir) {
  const prefix = `${packageDir}/`;
  return files.some((file) => {
    if (!file.startsWith(prefix)) {
      return false;
    }
    if (/\.(?:[cm]?js|[cm]?ts|tsx|json)$/.test(file)) {
      return true;
    }
    if (/\/(?:scripts|src|test)\//.test(file)) {
      return true;
    }
    if (/\/(?:tsconfig.*|eslint\.config\..*|package\.json)$/.test(file)) {
      return true;
    }
    return false;
  });
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

function runLintForFiles(packageDir, files) {
  if (files.length === 0) {
    console.log(`- skip lint for ${packageDir} (no changed JS/TS files)`);
    return;
  }
  run('pnpm', ['exec', 'eslint', ...files]);
}

function stagedHunkLines(file) {
  return stagedTouchedLines(execFileSync('git', ['diff', '--cached', '--unified=0', '--', file], {
    cwd: ROOT,
    encoding: 'utf8'
  }));
}

async function runStagedLintForFiles(files) {
  if (files.length === 0) {
    console.log('- skip staged lint (no staged files in the ESLint policy surface)');
    return;
  }
  console.log(`\n==> ESLint staged API (${files.length} files)`);
  let reports;
  try {
    const { lintStagedFiles } = await import('./staged-eslint.mjs');
    reports = await lintStagedFiles(files, { cwd: ROOT });
  } catch (error) {
    // A broken ESLint invocation/config means no complete diagnostic result was
    // available, so it must block rather than be treated as historical debt.
    const output = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error('ESLint staged API failed before diagnostics could be collected.');
    console.error(output);
    process.exit(1);
  }
  const actionable = reports.flatMap((report) => {
    const relative = path.relative(ROOT, report.filePath).split(path.sep).join('/');
    const messages = report.messages ?? [];
    const filtered = stagedLintMessages(messages, stagedHunkLines(relative));
    if (report.fatalErrorCount > 0 && !filtered.some(message => message.fatal === true)) {
      filtered.push({
        line: 0,
        column: 0,
        fatal: true,
        message: 'ESLint reported a fatal diagnostic without a corresponding message.'
      });
    }
    return filtered.map(message => ({
      filePath: relative,
      ...message
    }));
  });
  if (actionable.length === 0) {
    console.log('- no lint violations on staged added/modified lines');
    return;
  }
  for (const message of actionable) {
    console.error(`${message.filePath}:${message.line}:${message.column} ${message.message}${message.ruleId ? ` (${message.ruleId})` : ''}`);
  }
  process.exit(1);
}

function runTestsForPackage(packageDir, scripts, files) {
  if (!hasCodeImpactingChanges(files, packageDir)) {
    console.log(`- skip required tests for ${packageDir} (no code-impacting changes)`);
    return;
  }
  if (!scripts.test) {
    console.log(`- skip required tests for ${packageDir} (no test script)`);
    return;
  }
  run('pnpm', ['--filter', `./${packageDir}`, 'test', '--', '--run']);
}

const rawFiles = MODE === 'upstream' ? changedFilesAgainstUpstream() : stagedFiles();
const files = filterRelevantFiles(rawFiles);
if (files.length === 0) {
  console.log(MODE === 'upstream'
    ? 'No branch changes against upstream. Skipping checks.'
    : 'No staged files. Skipping pre-commit checks.'
  );
  process.exit(0);
}

requireCleanPushTarget();

console.log('\n==> Running configuration syntax validation');
run(
  'pnpm',
  MODE === 'staged'
    ? ['run', 'verify:config-syntax', '--', '--staged']
    : ['run', 'verify:config-syntax']
);

const changedPackages = packageDirs(files);
const hasParserSourceChanges = files.some(file =>
  /^packages\/(?:css|less|scss|jess)-parser\/src\//.test(file)
);

if (MODE === 'upstream' && hasParserSourceChanges) {
  console.log('\n==> Running parser runtime-boundary validation');
  run('pnpm', ['run', 'verify:parser-runtime-boundary']);
}

if (MODE === 'staged') {
  await runStagedLintForFiles(stagedLintableFiles(files));
}

if (changedPackages.length === 0) {
  console.log(MODE === 'upstream'
    ? 'No package changes against upstream. Skipping package checks.'
    : 'No staged package changes. Skipping package checks.'
  );
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
    const lintableFiles = stagedLintableFiles(files).filter(file => file.startsWith(`${packageDir}/`));
    if (!hasCodeImpactingChanges(files, packageDir)) {
      console.log(`- skip typecheck/build/lint for ${packageDir} (no code-impacting changes)`);
      continue;
    }
    runTestsForPackage(packageDir, scripts, files);
    runTypecheckForPackage(packageDir, scripts);
    runBuildForPackage(packageDir, scripts);
    runLintForFiles(packageDir, lintableFiles);
  }
}

if (MODE === 'upstream') {
  console.log('\nDev pre-push changed-package checks passed.');
} else {
  console.log('\nPre-commit staged checks passed.');
}
