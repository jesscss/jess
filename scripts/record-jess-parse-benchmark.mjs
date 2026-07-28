#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultHistory = 'docs/architecture/parser/parseman-jess-parse-benchmarks.jsonl';

function parseArgs(argv) {
  const options = {
    history: defaultHistory,
    label: '',
    note: '',
    skipBuild: false,
    skipGates: false,
    timed: 25,
    warmup: 8
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case '--history':
        options.history = readValue(argv, ++i, arg);
        break;
      case '--label':
        options.label = readValue(argv, ++i, arg);
        break;
      case '--note':
        options.note = readValue(argv, ++i, arg);
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--skip-gates':
        options.skipGates = true;
        break;
      case '--timed':
        options.timed = readCount(readValue(argv, ++i, arg), arg);
        break;
      case '--warmup':
        options.warmup = readCount(readValue(argv, ++i, arg), arg);
        break;
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }

  return options;
}

function readValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readCount(value, name) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 1) {
    throw new TypeError(`${name} must be a positive number`);
  }
  return Math.floor(count);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(repo, relativePath), 'utf8'));
}

function parsemanPackagePath() {
  try {
    return require.resolve('parseman/package.json');
  } catch {
    return path.resolve(repo, 'node_modules/parseman/package.json');
  }
}

function parsemanInfo() {
  const rootPackage = readJson('package.json');
  const packagePath = parsemanPackagePath();
  const resolved = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return {
    pinned: rootPackage.devDependencies?.parseman ?? null,
    resolved: resolved.version,
    packagePath: path.relative(repo, packagePath)
  };
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function gitInfo() {
  return {
    branch: git(['branch', '--show-current']),
    commit: git(['rev-parse', 'HEAD']),
    dirty: (git(['status', '--porcelain']) ?? '').length > 0
  };
}

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: repo,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 80
  });
  const status = result.status ?? null;
  return {
    command: [command, ...args],
    status,
    signal: result.signal ?? null,
    ms: Date.now() - started,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    error: result.error ? String(result.error.message) : null
  };
}

function skipped(command) {
  return {
    command,
    status: null,
    signal: null,
    ms: 0,
    stdoutTail: '',
    stderrTail: '',
    error: 'skipped'
  };
}

function tail(text) {
  const lines = text.trimEnd().split('\n');
  return lines.slice(-30).join('\n');
}

function parseBenchmark(stdoutTail) {
  const line = stdoutTail.split('\n').filter(Boolean).at(-1);
  if (!line) {
    return null;
  }
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function loadErrorsEmpty(benchmark) {
  if (!benchmark?.loadErrors || typeof benchmark.loadErrors !== 'object') {
    return false;
  }
  return Object.keys(benchmark.loadErrors).length === 0;
}

const options = parseArgs(process.argv.slice(2));
const parseman = parsemanInfo();
const gitState = gitInfo();
const label = options.label
  || `parseman-${parseman.resolved}-${gitState.commit?.slice(0, 12) ?? 'unknown'}`;

const build = options.skipBuild
  ? skipped(['pnpm', '--filter', '@jesscss/jess-parser', 'build'])
  : run('pnpm', ['--filter', '@jesscss/jess-parser', 'build']);

const macro = options.skipGates
  ? skipped(['pnpm', 'run', 'check:macro'])
  : run('pnpm', ['run', 'check:macro']);

const compose = options.skipGates
  ? skipped(['pnpm', 'run', 'verify:compose-integrity'])
  : run('pnpm', ['run', 'verify:compose-integrity']);

const bench = run('node', [
  'packages/syntax/jess/jess-parser/test/parse-bench.mjs',
  label,
  String(options.warmup),
  String(options.timed)
]);
const benchmark = parseBenchmark(bench.stdoutTail);

const usableEvidence =
  build.status === 0
  && macro.status === 0
  && compose.status === 0
  && bench.status === 0
  && loadErrorsEmpty(benchmark);

const record = {
  date: new Date().toISOString(),
  label,
  note: options.note,
  parseman,
  jess: gitState,
  env: {
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? null,
    cpuCount: os.cpus().length
  },
  config: {
    warmup: options.warmup,
    timed: options.timed,
    benchCases: process.env.BENCH_CASES ?? null
  },
  build,
  gates: {
    macro,
    compose
  },
  bench,
  benchmark,
  usableEvidence
};

const historyPath = path.resolve(repo, options.history);
fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.appendFileSync(historyPath, `${JSON.stringify(record)}\n`);
console.log(JSON.stringify(record));
