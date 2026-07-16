/**
 * THE ORACLE — single fixed-path source of truth for tree2 byte-identity.
 *
 * The expected `.css` for a fixture is the less.js `alpha` branch's TOP-LEVEL
 * golden, read READ-ONLY via `git show`. This file is the ONLY place allowed to
 * resolve an expected `.css`; every tree2 byte-identity test MUST route through
 * `expectedCss(fixture)` so no test can hand-pick a stray golden.
 *
 * Why this is locked down (pitfalls that repeatedly misled agents):
 *   - `legacy/*.css` are the Less-4.x EXPANDED outputs, NOT the v5 oracle. They
 *     are REFUSED here (any path containing `legacy/` throws).
 *   - `graduate-v5` / `alpha-release-port` / any OTHER less.js worktree or branch
 *     is NOT the oracle. Only `alpha` in `~/git/oss/less.js`, via `git show`.
 *   - `upstream/alpha` ships less.js's own EXPANDED (non-`:is()`) extend output —
 *     also not the oracle.
 *   - `renderRealOracle` (the legacy Jess-v5 engine) has KNOWN extend bugs and is
 *     NOT a source of expected `.css` here.
 *
 * The less.js worktree is treated as READ-ONLY: this helper never checks out,
 * switches, or modifies it — `git show <ref>:<path>` reads without touching HEAD.
 *
 * See `docs/future/core-architecture/ORACLE.md` for the full rationale.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

/** The read-only less.js repo whose `alpha` branch is the oracle. */
const LESS_REPO = path.join(process.env.HOME ?? '', 'git/oss/less.js');

/** The fixed oracle branch. Never `upstream/alpha`, never a worktree branch. */
const ORACLE_REF = 'alpha';

function assertPlainFixture(fixture: string): void {
  if (fixture.includes('legacy/')) {
    throw new Error(
      `oracle-source: REFUSED a legacy/ path (${fixture}). legacy/*.css are Less-4.x ` +
        `expanded outputs, NOT the v5 oracle.`,
    );
  }
  if (fixture.includes('/') || fixture.includes('..') || fixture.trim() === '') {
    throw new Error(`oracle-source: fixture must be a bare fixture name, got ${JSON.stringify(fixture)}`);
  }
}

function gitShow(relPath: string): string {
  return execFileSync('git', ['-C', LESS_REPO, 'show', `${ORACLE_REF}:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
}

/**
 * The expected TOP-LEVEL `.css` golden for `fixture`, read from `alpha`. Throws
 * if `fixture` is anything but a bare fixture name (no `legacy/`, no subpaths).
 */
export function expectedCss(fixture: string): string {
  assertPlainFixture(fixture);
  return gitShow(`packages/test-data/tests-unit/${fixture}/${fixture}.css`);
}

/**
 * The `.less` INPUT for `fixture`, read from the SAME `alpha` tree as the oracle
 * (so input and expected output are never drawn from divergent sources).
 */
export function fixtureLess(fixture: string): string {
  assertPlainFixture(fixture);
  return gitShow(`packages/test-data/tests-unit/${fixture}/${fixture}.less`);
}
