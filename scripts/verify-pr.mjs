#!/usr/bin/env node
/**
 * `pnpm verify:pr` — the full local pre-push gate, opt-in.
 *
 * This mirrors, on the developer's machine, the exact gate the PR CI workflow
 * (.github/workflows/pr-quality-gate.yml) runs server-side. Run it before
 * pushing when you want the complete check. The git hooks intentionally do NOT
 * run this — commits and pushes stay fast; this is the deliberate, slow, full
 * verification.
 *
 * Steps:
 *   1. Clean: delete every packages/*​/lib.
 *   2. Clean build, SERIALLY in topological order (concurrency=1). Incremental
 *      builds mask errors — a stale lib recently hid a grammar compose failure.
 *      Build output is captured to a log for the compose-integrity gate.
 *   3. Compose-integrity: fail if any grammar silently fell back to the runtime
 *      interpreter (parseman compose() degrade).
 *   4. pnpm lint + pnpm ci (per-package build+test, incl. all parser & core suites).
 *   5. The six structural/perf gates + node-creation audit.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const started = Date.now();

function heading(text) {
  console.log(`\n\x1b[1m==> ${text}\x1b[0m`);
}

// Returns combined stdout+stderr when `capture` is set. The script is fully
// synchronous (spawnSync), so the log MUST be captured into memory and written
// with a sync fs call — an async write stream would never flush.
function run(command, args, { capture = false } = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 512 * 1024 * 1024
  });
  let combined = '';
  if (capture) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  }
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nverify:pr FAILED at: ${[command, ...args].join(' ')} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
  return combined;
}

// 1. Clean all package libs.
heading('Clean: removing packages/*/lib');
for (const entry of readdirSync(path.join(ROOT, 'packages'))) {
  rmSync(path.join(ROOT, 'packages', entry, 'lib'), { recursive: true, force: true });
}

// 2. Clean serial build in topological order. pnpm -r builds in dependency
//    order; --workspace-concurrency=1 forces it serial so no error is masked.
const logDir = mkdtempSync(path.join(tmpdir(), 'jess-verify-pr-'));
const buildLogPath = path.join(logDir, 'build.log');
heading('Clean build (serial, topological)');
const buildOutput = run('pnpm', [
  '-r',
  '--workspace-concurrency=1',
  '--filter=!jess-docs',
  '--filter=!@jesscss/docs-less',
  '--filter=!@jesscss/docs-content',
  'build'
], { capture: true });
writeFileSync(buildLogPath, buildOutput);

// 3. Compose-integrity against the captured build output.
heading('Compose-integrity');
run('node', ['scripts/verify-compose-integrity.mjs', '--log', buildLogPath]);

// 4. Lint + full CI (per-package build+test, includes all parser and core suites).
heading('Lint');
run('pnpm', ['run', 'lint']);
heading('CI (per-package build + test)');
run('pnpm', ['run', 'ci']);

// 5. Structural / perf gates + node-creation audit. verify:config-syntax is
//    included here because it used to run in the pre-commit/pre-push hooks that
//    are now lint-only — its coverage moves to this gate rather than being lost.
heading('Structural & perf gates');
for (const script of [
  'verify:config-syntax',
  // A truthiness test on a possibly-awaitable value silently takes one branch
  // instead of crashing, and neither tsc nor no-unnecessary-condition sees it.
  'verify:maybe-promise-truthiness',
  'verify:aggressive-cutting-review',
  'verify:node-copy-frontier',
  'verify:materialization-frontier',
  'verify:render-buffer-frontier',
  'verify:binding-lookup-hot-paths',
  'audit:node-creation'
]) {
  run('pnpm', ['run', script]);
}

rmSync(logDir, { recursive: true, force: true });
const secs = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n\x1b[32mverify:pr PASSED\x1b[0m (${secs}s)`);
