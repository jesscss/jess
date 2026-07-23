#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';

function currentBranch() {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf8'
    }).trim();
  } catch {
    return '';
  }
}

const script = currentBranch() === 'alpha'
  ? 'release:alpha:check'
  : 'prepush:dev:check';
const result = spawnSync('pnpm', ['run', script], { stdio: 'inherit' });

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
