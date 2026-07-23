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

// Pushing must stay FAST. The heavy dependent-retest that used to run here has
// moved to the PR CI workflow (.github/workflows/pr-quality-gate.yml) and to the
// opt-in `pnpm verify:pr`. Normal-branch pushes now do NO build/test work.
//
// The one exception is the `alpha` release branch: pushing there IS a release,
// so it still runs the full release gate deliberately.
if (currentBranch() !== 'alpha') {
  console.log('pre-push: fast path (no build/test). Run `pnpm verify:pr` for the full gate; PR CI runs it server-side.');
  process.exit(0);
}

const result = spawnSync('pnpm', ['run', 'release:alpha:check'], { stdio: 'inherit' });
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
