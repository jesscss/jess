#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  ALPHA_BRANCH,
  ALPHA_SOURCE_REF,
  currentBranch,
  fetchAlphaSource
} from './alpha-source-sync.mjs';
import { isReleaseArtifactPath } from './release-utils.mjs';

const scriptDir = new URL('.', import.meta.url);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = {
    message: 'chore(release): refresh alpha from dev',
    push: false,
    recoveryRef: null,
    releaseDryRun: false,
    skipInstall: false,
    skipPushCheck: false
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { ...options, help: true };
    }
    if (arg === '--message') {
      options.message = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--push') {
      options.push = true;
      continue;
    }
    if (arg === '--recovery-ref') {
      options.recoveryRef = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--release-dry-run' || arg === '--dry-run-release') {
      options.releaseDryRun = true;
      continue;
    }
    if (arg === '--skip-install') {
      options.skipInstall = true;
      continue;
    }
    if (arg === '--skip-push-check') {
      options.skipPushCheck = true;
      continue;
    }
    throw new Error(`Unknown argument '${arg}'.`);
  }
  if (options.message.length === 0) {
    throw new Error('Commit message cannot be empty.');
  }
  return { ...options, help: false };
}

function usage() {
  console.log(`Usage: node scripts/release/update-alpha-from-dev.mjs [options]

Create one controlled alpha release-snapshot commit from ${ALPHA_SOURCE_REF}.

Options:
  --message <text>       Commit message. Default: "chore(release): refresh alpha from dev"
  --recovery-ref <name>  Recovery branch name. Default: alpha-pre-refresh-<timestamp>
  --release-dry-run      Run pnpm run release:alpha:dry-run after committing
  --push                 Push alpha after checks pass
  --skip-install         Skip pnpm install after version bump
  --skip-push-check      Skip pnpm run release:alpha:push-check after committing
  -h, --help             Show this help
`);
}

function run(command, args, rootDir, { input } = {}) {
  const rendered = [command, ...args].join(' ');
  console.log(`\n$ ${rendered}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    input,
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 1}): ${rendered}`);
  }
}

function capture(command, args, rootDir, { input, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: input === undefined ? 'utf8' : undefined,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0 && !allowFailure) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : result.stderr;
    throw new Error(stderr.trim() || `Command failed (${result.status ?? 1}): ${command} ${args.join(' ')}`);
  }
  return result;
}

function captureBuffer(command, args, rootDir) {
  const result = spawnSync(command, args, {
    maxBuffer: 128 * 1024 * 1024,
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr ?? '');
    throw new Error(stderr.trim()
      || result.error?.message
      || `Command failed (${result.status ?? 1}): ${command} ${args.join(' ')}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
}

function getCleanBlockingChanges(rootDir) {
  const result = capture('git', ['status', '--porcelain', '--untracked-files=all'], rootDir);
  const output = String(result.stdout ?? '').trim();
  if (!output) {
    return [];
  }
  return output
    .split('\n')
    .map(line => ({ line, path: line.slice(3) }))
    .filter(entry => !isReleaseArtifactPath(entry.path))
    .map(entry => entry.line);
}

function assertClean(rootDir) {
  const dirty = getCleanBlockingChanges(rootDir);
  if (dirty.length > 0) {
    throw new Error(`Alpha refresh requires a clean source tree:\n${dirty.map(line => `  ${line}`).join('\n')}`);
  }
}

function refExists(rootDir, ref) {
  return capture('git', ['rev-parse', '--verify', '--quiet', ref], rootDir, { allowFailure: true }).status === 0;
}

function timestamp() {
  return new Date()
    .toISOString()
    .replaceAll(/[-:]/gu, '')
    .replace(/\..+$/u, 'Z');
}

function defaultRecoveryRef() {
  return `alpha-pre-refresh-${timestamp()}`;
}

function helperPath(name) {
  return new URL(name, scriptDir).pathname;
}

function runNodeHelper(rootDir, name, args) {
  run(process.execPath, [helperPath(name), ...args], rootDir);
}

function patchFromRecoveryToSource(rootDir, recoveryRef) {
  const patch = captureBuffer('git', ['diff', '--binary', `${recoveryRef}..${ALPHA_SOURCE_REF}`], rootDir);
  if (patch.length === 0) {
    throw new Error(`${ALPHA_SOURCE_REF} has no tree difference from ${recoveryRef}; alpha is already current.`);
  }
  capture('git', ['apply', '--check', '--index', '--binary'], rootDir, { input: patch });
  run('git', ['apply', '--index', '--binary'], rootDir, { input: patch });
}

function hasStagedChanges(rootDir) {
  return capture('git', ['diff', '--cached', '--quiet'], rootDir, { allowFailure: true }).status !== 0;
}

function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    usage();
    return;
  }

  const rootDir = process.cwd();
  const branch = currentBranch(rootDir);
  if (branch !== ALPHA_BRANCH) {
    throw new Error(`Alpha refresh must run on branch '${ALPHA_BRANCH}'. Current branch: '${branch}'.`);
  }
  assertClean(rootDir);

  const sourceCommit = fetchAlphaSource(rootDir);
  const recoveryRef = options.recoveryRef ?? defaultRecoveryRef();
  if (refExists(rootDir, recoveryRef)) {
    throw new Error(`Recovery ref already exists: ${recoveryRef}`);
  }

  console.log(`Creating recovery branch ${recoveryRef} from ${ALPHA_BRANCH}.`);
  run('git', ['branch', recoveryRef, 'HEAD'], rootDir);

  console.log(`Importing ${ALPHA_SOURCE_REF} at ${sourceCommit}.`);
  patchFromRecoveryToSource(rootDir, recoveryRef);
  runNodeHelper(rootDir, 'restore-alpha-package-versions.mjs', ['--from', recoveryRef, '--stage']);
  runNodeHelper(rootDir, 'record-alpha-source-provenance.mjs', ['--stage']);
  runNodeHelper(rootDir, 'increment-alpha.mjs', []);
  if (!options.skipInstall) {
    run('pnpm', ['install'], rootDir);
  }
  run('git', ['add', '--all'], rootDir);
  if (!hasStagedChanges(rootDir)) {
    throw new Error('Alpha refresh produced no staged changes.');
  }

  /* The snapshot stages the whole dev-to-alpha projection, so a per-commit
   * staged-file hook would re-lint historical files. The release push-check
   * and requested dry-run below own validation of the complete snapshot. */
  run('git', ['commit', '--no-verify', '-m', options.message], rootDir);
  assertClean(rootDir);

  if (!options.skipPushCheck) {
    run('pnpm', ['run', 'release:alpha:push-check'], rootDir);
  }
  if (options.releaseDryRun) {
    run('pnpm', ['run', 'release:alpha:dry-run'], rootDir);
  }
  if (options.push) {
    run('git', ['push', 'origin', ALPHA_BRANCH], rootDir);
  }
  console.log(`\nAlpha refresh committed from ${ALPHA_SOURCE_REF} ${sourceCommit}.`);
  console.log(`Recovery branch: ${recoveryRef}`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
