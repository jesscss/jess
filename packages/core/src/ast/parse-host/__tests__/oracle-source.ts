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

/**
 * DETERMINISTIC ORACLE READS.
 *
 * The oracle blobs are read from a READ-ONLY less.js repo shared across many git
 * worktrees and concurrent agent sessions. Reading them via a plain
 * `git show alpha:<path>` per call had two failure modes that eroded the gate:
 *
 *   1. RACE / TRANSIENT — while a test run (esp. the pre-push hook, which runs
 *      the whole core vitest suite across parallel workers) fires dozens of
 *      `git show` subprocesses, a concurrent op on the less.js repo (another
 *      session's `fetch`/`gc`/`worktree`, an auto-gc repack) can momentarily
 *      make the `alpha` ref or its objects unreadable — an intermittent
 *      `fatal: invalid object name 'alpha'` / `fatal: bad object`. Every such
 *      flake pushed agents to `--no-verify`, so the gate stopped meaning
 *      anything.
 *   2. MID-RUN DRIFT — if `alpha` is fast-forwarded mid-run, different reads in
 *      the same run could observe different trees.
 *
 * Both are removed WITHOUT snapshotting the owner-maintained goldens into jess
 * (they'd drift): resolve `alpha` to an IMMUTABLE commit sha ONCE per worker
 * process, then read every blob from that pinned sha. The sha (a) makes all
 * reads in a run consistent even if `alpha` moves, and (b) is a stable
 * per-process cache key that can only change when `alpha` itself moves — a fresh
 * process re-resolves `alpha`, so the oracle refreshes automatically when the
 * owner advances the branch (no forked/drifting copy lives in jess).
 *
 * Transient git failures are retried with a short synchronous backoff; a
 * genuinely-missing path in the tree is distinguished from a transient/ref
 * failure and returned as "not found" only when git actually reports the path
 * absent. A persistent failure (less.js repo or `alpha` ref unavailable) throws
 * a LOUD, actionable error — never a silent mis-resolution.
 */

/** Distinguish "git says this path is genuinely absent from the tree" from any
 * other (transient / environment / bad-ref) failure. Only the former is a
 * legitimate `null` for an optional read; everything else must be retried and,
 * if persistent, surfaced loudly. */
const PATH_ABSENT_RE = /does not exist in|exists on disk, but not in/;

function syncSleep(ms: number): void {
  // Synchronous backoff without a dependency; execFileSync is itself blocking,
  // so a blocking wait here is consistent with the surrounding code.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

interface GitFailure {
  stderr: string;
  status: number | null;
}

function isRecord(e: unknown): e is Record<string, unknown> {
  return typeof e === 'object' && e !== null;
}

function readProp(e: unknown, key: string): unknown {
  return isRecord(e) ? e[key] : undefined;
}

function gitFailure(e: unknown): GitFailure {
  const rawStderr = readProp(e, 'stderr');
  const stderr =
    typeof rawStderr === 'string'
      ? rawStderr
      : Buffer.isBuffer(rawStderr)
        ? rawStderr.toString('utf8')
        : '';
  const rawStatus = readProp(e, 'status');
  const status = typeof rawStatus === 'number' ? rawStatus : null;
  return { stderr, status };
}

/** Run `git <args>` in the oracle repo with retry-on-transient. Returns stdout on
 * success. On a genuine PATH-ABSENT failure returns `null` (callers decide if
 * that is legal). On any other persistent failure throws a loud, actionable
 * error. */
function gitRead(args: string[], what: string): string | null {
  const MAX_ATTEMPTS = 5;
  let last: GitFailure | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return execFileSync('git', ['-C', LESS_REPO, ...args], {
        encoding: 'utf8',
        maxBuffer: 1 << 24,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      const failure = gitFailure(e);
      // A genuinely-absent path is a stable answer — do not retry it.
      if (PATH_ABSENT_RE.test(failure.stderr)) {
        return null;
      }
      last = failure;
      if (attempt < MAX_ATTEMPTS) {
        syncSleep(25 * attempt);
      }
    }
  }
  throw new Error(
    `oracle-source: failed to ${what} from the less.js '${ORACLE_REF}' oracle after `
    + `${MAX_ATTEMPTS} attempts.\n`
    + `  repo: ${LESS_REPO}\n`
    + `  ref:  ${ORACLE_REF}\n`
    + `  git exit: ${last?.status ?? '(none)'}\n`
    + `  git stderr: ${last?.stderr.trim() || '(none)'}\n`
    + `This is an ORACLE-READ failure, NOT a byte-identity failure. Ensure the `
    + `read-only less.js repo exists at the path above and its '${ORACLE_REF}' `
    + `branch is present (do not modify or check it out).`
  );
}

/** Resolve `alpha` to an immutable commit sha ONCE per process. Pinning every
 * blob read to this sha makes a run internally consistent and gives blobs a
 * drift-proof cache key. */
let oracleShaCache: string | undefined;
function oracleSha(): string {
  if (oracleShaCache !== undefined) {
    return oracleShaCache;
  }
  const out = gitRead(['rev-parse', '--verify', `${ORACLE_REF}^{commit}`], `resolve ref '${ORACLE_REF}'`);
  if (out === null) {
    // rev-parse of a missing ref reports "unknown revision", not PATH_ABSENT, so
    // gitRead would already have thrown; a null here means the ref resolved to
    // nothing, which is equally unusable.
    throw new Error(
      `oracle-source: the less.js '${ORACLE_REF}' ref did not resolve to a commit (repo: ${LESS_REPO}).`
    );
  }
  oracleShaCache = out.trim();
  return oracleShaCache;
}

/** In-process blob cache, keyed on `<sha>:<relPath>`. The sha component makes the
 * key drift-proof: it changes only when `alpha` moves (picked up by the next
 * fresh process). `null` memoizes a genuine path-absent result. */
const blobCache = new Map<string, string | null>();

/** Read a blob from the pinned oracle sha. Retries transients, memoizes, and
 * returns `null` only when git reports the path genuinely absent from the tree. */
function readBlob(relPath: string): string | null {
  const sha = oracleSha();
  const key = `${sha}:${relPath}`;
  const cached = blobCache.get(key);
  if (cached !== undefined || blobCache.has(key)) {
    return cached ?? null;
  }
  const out = gitRead(['show', key], `read ${relPath}`);
  blobCache.set(key, out);
  return out;
}

function assertPlainFixture(fixture: string): void {
  if (fixture.includes('legacy/')) {
    throw new Error(
      `oracle-source: REFUSED a legacy/ path (${fixture}). legacy/*.css are Less-4.x `
      + `expanded outputs, NOT the v5 oracle.`
    );
  }
  if (fixture.includes('/') || fixture.includes('..') || fixture.trim() === '') {
    throw new Error(`oracle-source: fixture must be a bare fixture name, got ${JSON.stringify(fixture)}`);
  }
}

/** Read a REQUIRED oracle blob (must exist on `alpha`). Throws loud on a genuine
 * absence (fixture missing / less.js not synced) or a persistent read failure. */
function gitShow(relPath: string): string {
  const out = readBlob(relPath);
  if (out === null) {
    throw new Error(
      `oracle-source: expected oracle path '${relPath}' is absent on less.js `
      + `'${ORACLE_REF}' (@${oracleSha()}). The fixture is missing or the read-only `
      + `less.js repo (${LESS_REPO}) is not synced to the owner's '${ORACLE_REF}'.`
    );
  }
  return out;
}

/** Like `gitShow`, but returns `null` when the path is GENUINELY absent on the
 * oracle ref (e.g. a fixture with NO `styles.config.ts`). A transient/ref
 * failure is retried and, if persistent, thrown by `readBlob` — it is NEVER
 * silently coerced to `null` (which would mis-resolve the fixture's mode). */
function gitShowOptional(relPath: string): string | null {
  return readBlob(relPath);
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
    if (v !== null) {
      return v;
    }
  }
  const dir = gitShowOptional('packages/test-data/tests-unit/styles.config.ts');
  if (dir !== null) {
    const v = parseCollapseNesting(dir);
    if (v !== null) {
      return v;
    }
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
