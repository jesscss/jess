#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
/*
 * The perf drift gate tiers itself off the changed-file set: docs-only and
 * non-hot-path pushes take a fast path with no build and no benchmark, so the
 * cost here stays at one process spawn. It ships DISABLED (`PERF_GATE=off` by
 * default) and cannot fail a push until an owner enables it — see
 * `docs/perf/PERF-DRIFT-GATE.md` for the enablement checklist.
 *
 * Resolved relative to THIS script, not to cwd, and skipped outright when
 * absent. A push must never be blocked because the gate itself is missing: an
 * infrastructure gap is not evidence of a performance regression, and a gate
 * that fails for reasons unrelated to what it measures is the fastest route to
 * habitual `--no-verify`.
 */
/*
 * The guardrails gate runs on EVERY push, including the docs-only fast path,
 * because the thing it catches IS a docs change: an agent redefining or closing
 * an owner requirement in `docs/`, `.cursor/rules/`, or `CLAUDE.md`. It reads
 * markdown and hashes one file — no build, no test, single spawn.
 */
const guardrails = resolve(dirname(fileURLToPath(import.meta.url)), 'check-guardrails.mjs');
if (existsSync(guardrails)) {
  const g = spawnSync(process.execPath, [guardrails], { stdio: 'inherit' });
  if (g.status !== 0) {
    process.exit(g.status ?? 1);
  }
}

const perfGate = resolve(dirname(fileURLToPath(import.meta.url)), 'perf-gate/index.mjs');
if (existsSync(perfGate)) {
  const perf = spawnSync(process.execPath, [perfGate], { stdio: 'inherit' });
  if (perf.status !== 0) {
    process.exit(perf.status ?? 1);
  }
}

if (currentBranch() !== 'alpha') {
  console.log('pre-push: fast path (no build/test). Run `pnpm verify:pr` for the full gate; PR CI runs it server-side.');
  process.exit(0);
}

const result = spawnSync('pnpm', ['run', 'release:alpha:push-check'], { stdio: 'inherit' });
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
