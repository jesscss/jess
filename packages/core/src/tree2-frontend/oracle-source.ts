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

/** Like `gitShow`, but returns `null` when the path does not exist on the oracle
 * ref (e.g. a fixture with NO `styles.config.ts`) instead of throwing. */
function gitShowOptional(relPath: string): string | null {
  try {
    return execFileSync('git', ['-C', LESS_REPO, 'show', `${ORACLE_REF}:${relPath}`], {
      encoding: 'utf8',
      maxBuffer: 1 << 24,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
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

/** Extract `output.collapseNesting` from raw `styles.config.ts` source, or `null`
 * if the file declares none. Handles both `alpha` shapes:
 *   - `output: { collapseNesting: false }`                        (object)
 *   - `output: [{ file: '{name}.css', collapseNesting: false }]`  (array)
 * Each extend fixture declares a SINGLE top-level `{name}.css` target, so the
 * first `collapseNesting` governs `expectedCss`. */
function parseCollapseNesting(configSrc: string): boolean | null {
  const m = /collapseNesting\s*:\s*(true|false)/.exec(configSrc);
  return m === null ? null : m[1] === 'true';
}

/**
 * Resolve a fixture's `output.collapseNesting` via the SAME config CASCADE the
 * product compiler uses (the `styles-config` / cosmiconfig loader walks UP from a
 * fixture dir): a fixture's OWN `styles.config.ts` wins; otherwise the value falls
 * through to the `tests-unit/` DIRECTORY config, which ships
 * `output: { collapseNesting: true }` and is therefore the effective FLAT default
 * for the un-configured fixtures (`extend-nest`, `extend-clearfix`,
 * `extend-chaining`). There is NO hardcoded default here — the flat default is
 * SOURCED from that directory config.
 *
 * The cascade is reproduced deterministically over the pinned oracle ref via
 * `git show alpha:…` (nearest-config-wins), rather than `loadConfigSync`ing the
 * live less.js worktree — this keeps `resolveCollapseNesting` on the SAME
 * read-only, branch-independent footing as `expectedCss`/`fixtureLess` (the whole
 * point of this locked helper), so mode and golden can never be drawn from a
 * worktree that has drifted off `alpha`.
 */
export function resolveCollapseNesting(fixture: string): boolean {
  assertPlainFixture(fixture);
  // nearest first: the fixture's own config, then the tests-unit directory config.
  const own = gitShowOptional(`packages/test-data/tests-unit/${fixture}/styles.config.ts`);
  if (own !== null) {
    const v = parseCollapseNesting(own);
    if (v !== null) return v;
  }
  const dir = gitShowOptional('packages/test-data/tests-unit/styles.config.ts');
  if (dir !== null) {
    const v = parseCollapseNesting(dir);
    if (v !== null) return v;
  }
  // The `tests-unit` directory config always ships `collapseNesting: true`; this
  // final fallback only guards a hypothetical future where it is removed.
  return true;
}

/**
 * The 4.x FLAT reference (`legacy/{name}.css`) for `fixture`, read from `alpha`.
 * This is the ONE off-path sibling this locked helper is allowed to read; it is
 * NOT a tree2 oracle (tree2's flat mode emits the v5 `:is()`-compacted form, e.g.
 * `:is(.clearfix, .foo, .bar):after`, whereas `legacy/*.css` is the 4.x EXPANDED
 * form `.clearfix:after, .foo:after, .bar:after`). It exists only for the
 * informational flat-vs-legacy matrix column. The bare-name guard still runs, so
 * no OTHER `legacy/` or subpath read is possible.
 */
export function legacyCss(fixture: string): string {
  assertPlainFixture(fixture);
  return gitShow(`packages/test-data/tests-unit/${fixture}/legacy/${fixture}.css`);
}
