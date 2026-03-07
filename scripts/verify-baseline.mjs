#!/usr/bin/env node
/**
 * Commit gate: core tests + CSS parsers + Less fixture baseline must all pass.
 * Run before claiming completion or pushing. Fails fast on first failure.
 * Policy: always move the bar up — fix failures and add new critical suites here;
 * never relax expectations or remove tests to get green.
 */
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

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

console.log('Verify baseline: core + parsers + packages/jess/test/less/all-less.test.ts');

// 1) Build core so parsers and jess see updated lib/
run('pnpm', ['--filter', '@jesscss/core', 'build']);

// 2) Core tests (full suite, --run)
run('pnpm', ['--filter', '@jesscss/core', 'test', '--', '--run']);

// 3) Less parser tests
run('pnpm', ['--filter', '@jesscss/less-parser', 'test']);

// 4) CSS parser tests
run('pnpm', ['--filter', '@jesscss/css-parser', 'test']);

// 5) Jess Less fixture baseline (all-less.test.ts)
run('pnpm', ['run', 'test:less:test-data']);

console.log('\n>>> Verify baseline passed (core + parsers + all-less.test.ts).');
