#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MODE = process.argv.includes('--mode=upstream') ? 'upstream' : 'staged';
const SHOULD_BLOCK = MODE === 'staged';
const TODO_REPORT_PATH = path.join(ROOT, '.cursor', 'PREPUSH_CHECK_TODOS.md');
const failures = [];
const NON_SOURCE_PATH_PATTERNS = [
  /\/build\//,
  /\/\.docusaurus\//,
  /\/dist\//,
  /\/coverage\//
];

function run(command, args, packageDir) {
  const rendered = [command, ...args].join(' ');
  console.log(`\n$ ${rendered}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.status !== 0) {
    failures.push({
      packageDir,
      command: rendered,
      status: result.status ?? 1,
      output: [stdout, stderr].filter(Boolean).join('\n').trim()
    });
    if (SHOULD_BLOCK) {
      process.exit(result.status ?? 1);
    }
  }
}

function writeTodoReport() {
  if (failures.length === 0 || MODE !== 'upstream') return;
  const now = new Date().toISOString();
  const lines = [
    '# Pre-push Check TODOs',
    '',
    `Generated: ${now}`,
    '',
    'These checks failed during `--mode=upstream` and were treated as non-blocking.',
    '',
    '## TODO Items',
    ...failures.map((f, i) => `${i + 1}. [ ] \`${f.packageDir}\` - \`${f.command}\` (exit ${f.status})`),
    '',
    '## Failure Details',
    ...failures.flatMap((f, i) => [
      `### ${i + 1}) ${f.packageDir}`,
      '',
      `- Command: \`${f.command}\``,
      `- Exit: \`${f.status}\``,
      '',
      '```',
      f.output || '(no output captured)',
      '```',
      ''
    ])
  ];
  mkdirSync(path.dirname(TODO_REPORT_PATH), { recursive: true });
  writeFileSync(TODO_REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(`\nWrote TODO report: ${path.relative(ROOT, TODO_REPORT_PATH)}`);
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

function hasCodeImpactingChanges(files, packageDir) {
  const prefix = `${packageDir}/`;
  return files.some(file => {
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
    run('pnpm', ['--filter', `./${packageDir}`, 'typecheck'], packageDir);
    return;
  }
  const tsBuild = path.join(ROOT, packageDir, 'tsconfig.build.json');
  if (existsSync(tsBuild)) {
    run('pnpm', ['-w', 'exec', 'tsc', '-p', `${packageDir}/tsconfig.build.json`, '--noEmit'], packageDir);
    return;
  }
  const tsConfig = path.join(ROOT, packageDir, 'tsconfig.json');
  if (existsSync(tsConfig)) {
    run('pnpm', ['-w', 'exec', 'tsc', '-p', `${packageDir}/tsconfig.json`, '--noEmit'], packageDir);
    return;
  }
  console.log(`- skip typecheck for ${packageDir} (no tsconfig or typecheck script)`);
}

function runBuildForPackage(packageDir, scripts) {
  if (scripts.build) {
    run('pnpm', ['--filter', `./${packageDir}`, 'build'], packageDir);
    return;
  }
  console.log(`- skip build for ${packageDir} (no build script)`);
}

function runLintForFiles(packageDir, files) {
  if (files.length === 0) {
    console.log(`- skip lint for ${packageDir} (no changed JS/TS files)`);
    return;
  }
  run('pnpm', ['exec', 'eslint', ...files], packageDir);
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
    const lintableFiles = stagedLintableFiles(files, packageDir);
    if (!hasCodeImpactingChanges(files, packageDir)) {
      console.log(`- skip typecheck/build/lint for ${packageDir} (no code-impacting changes)`);
      continue;
    }
    runTypecheckForPackage(packageDir, scripts);
    runBuildForPackage(packageDir, scripts);
    runLintForFiles(packageDir, lintableFiles);
  } else {
    const filesForPackage = stagedLintableFiles(files, packageDir);
    if (filesForPackage.length === 0) {
      console.log(`- skip lint for ${packageDir} (no staged JS/TS files)`);
      continue;
    }
    run('pnpm', ['exec', 'eslint', ...filesForPackage], packageDir);
  }
}

if (MODE === 'upstream') {
  writeTodoReport();
  if (failures.length > 0) {
    console.log(`\nPre-push package checks completed with ${failures.length} failing command(s) recorded as TODOs.`);
    process.exit(0);
  }
  console.log('\nPre-push package checks passed.');
} else {
  console.log('\nPre-commit staged checks passed.');
}
