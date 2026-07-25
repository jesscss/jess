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

/*
 * Pushing must stay FAST. The heavy dependent-retest that used to run here has
 * moved to the PR CI workflow (.github/workflows/pr-quality-gate.yml) and to the
 * opt-in `pnpm verify:pr`. Normal-branch pushes now do NO build/test work.
 *
 * The `alpha` release branch is also intentionally cheap here: the release gate
 * is `pnpm run release:alpha:check`, run explicitly before publishing. A push
 * only re-checks that the branch is still an alpha source projection with a
 * valid publish set, avoiding an accidental second build/test/pack dry-run.
 */
if (currentBranch() !== 'alpha') {
  console.log('pre-push: fast path (no build/test). Run `pnpm verify:pr` for the full gate; PR CI runs it server-side.');
  process.exit(0);
}

const result = spawnSync('pnpm', ['run', 'release:alpha:push-check'], { stdio: 'inherit' });
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
