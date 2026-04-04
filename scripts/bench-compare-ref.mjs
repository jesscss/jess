#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();

function usage() {
  console.error('Usage: node scripts/bench-compare-ref.mjs --package <pkg> --ref <git-ref> [--iterations N] [--benchmark]');
  process.exit(1);
}

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) {
    return undefined;
  }
  return process.argv[idx + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const pkg = getArg('--package');
const gitRef = getArg('--ref');
const iterations = getArg('--iterations');
const benchmarkOnly = hasFlag('--benchmark');

if (!pkg || !gitRef) {
  usage();
}

const packageMap = {
  '@jesscss/css-parser': {
    relDir: 'packages/css-parser',
    benchFile: 'packages/css-parser/test/bench.ts',
    latestFile: 'packages/css-parser/test/bench-results/latest.json',
    baselineOut: `packages/css-parser/test/bench-results/baseline-${gitRef}.json`,
    extraArgs: []
  },
  '@jesscss/less-parser': {
    relDir: 'packages/less-parser',
    benchFile: 'packages/less-parser/test/bench.ts',
    latestFile: 'packages/less-parser/test/bench-results/latest.json',
    baselineOut: `packages/less-parser/test/bench-results/baseline-${gitRef}.json`,
    extraArgs: benchmarkOnly ? ['--benchmark'] : []
  }
};

const target = packageMap[pkg];
if (!target) {
  console.error(`Unsupported package: ${pkg}`);
  process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-bench-ref-'));

function run(cmd, args, cwd, env = {}) {
  return execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
}

try {
  run('git', ['worktree', 'add', '--detach', tempDir, gitRef], rootDir);

  const worktreeBenchFile = path.join(tempDir, target.benchFile);
  fs.copyFileSync(path.join(rootDir, target.benchFile), worktreeBenchFile);
  fs.mkdirSync(path.dirname(path.join(tempDir, target.latestFile)), { recursive: true });

  run('pnpm', ['install', '--ignore-scripts', '--frozen-lockfile'], tempDir);

  const benchArgs = [worktreeBenchFile, '--save', ...target.extraArgs];
  const env = iterations ? { BENCH_ITERATIONS: iterations } : {};
  run(path.join(rootDir, 'node_modules/.bin/tsx'), benchArgs, tempDir, env);

  const worktreeLatest = path.join(tempDir, target.latestFile);
  const copiedBaseline = path.join(rootDir, target.baselineOut);
  fs.copyFileSync(worktreeLatest, copiedBaseline);
  console.log(`Copied baseline snapshot to ${copiedBaseline}`);

  const currentBenchFile = path.join(rootDir, target.benchFile);
  const currentArgs = [currentBenchFile, '--baseline', copiedBaseline, ...target.extraArgs];
  run(path.join(rootDir, 'node_modules/.bin/tsx'), currentArgs, rootDir, env);
} finally {
  try {
    run('git', ['worktree', 'remove', '--force', tempDir], rootDir);
  } catch {
    // ignore cleanup failures
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}
