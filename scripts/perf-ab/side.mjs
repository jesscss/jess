/**
 * Per-side evidence: resolved paths, versions, corpus provenance, and PROOF that
 * the build actually produced the artifact being measured.
 *
 * Every function here exists because of an observed silent failure. None of them
 * are defensive padding:
 *
 * - `pnpm run build:release` has been observed to EXIT 0 while every package
 *   failed, in a worktree with no `node_modules`. "The build reported success" is
 *   therefore not evidence that the build happened; the artifact on disk is.
 * - The parse-bench harnesses `continue` past any case whose corpus resolves to
 *   zero files. A missing corpus does not error — the case simply vanishes from
 *   the output and the run still prints a confident-looking number for whatever
 *   remains.
 * - `@less/test-data` is a `link:../less.js/packages/test-data` dependency that
 *   resolves RELATIVE TO EACH WORKTREE ROOT. Two worktrees at different paths can
 *   silently get different corpora, or one can get none at all.
 * - A stale `lib/` measures a past version of the repo and says nothing about it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gitRead } from './git-guard.mjs';

/**
 * Built in dependency order. Two things this order encodes, both learned the hard
 * way:
 *
 * 1. The CSS recognition tables live INSIDE `@jesscss/parser-shared` (they were
 *    once a separate `internal-css-recognition` package), so parser-shared is the
 *    root of the parser build. Building a parser against a stale recognition lib
 *    is the classic masking trap.
 * 2. `@jesscss/css-parser`'s BUILT `lib/index.js` imports `@jesscss/core/lib/ast.js`
 *    at RUNTIME, and core in turn needs `@jesscss/awaitable-pipe`. Building only
 *    the three parser packages — which is all `ab-compare.mjs` needs, because it
 *    only ever runs the LESS bench — leaves the CSS parse-bench unable to load at
 *    all. `@jesscss/shared` is source-only and has no build step.
 */
export const BUILD_ORDER = [
  '@jesscss/parser-shared',
  '@jesscss/css-parser',
  '@jesscss/less-parser',
  '@jesscss/awaitable-pipe',
  '@jesscss/core'
];

/** Artifacts that must exist and be newer than the build start for the build to count. */
const ARTIFACTS = {
  '@jesscss/parser-shared': 'packages/parser-shared/lib',
  '@jesscss/css-parser': 'packages/syntax/css/css-parser/lib',
  '@jesscss/less-parser': 'packages/syntax/less/less-parser/lib',
  '@jesscss/awaitable-pipe': 'packages/awaitable-pipe/lib',
  '@jesscss/core': 'packages/core/lib'
};

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
}

function findFiles(dir, ext) {
  if (!existsSync(dir)) {
    return [];
  }
  return sh('find', ['-L', dir, '-type', 'f', '-name', `*.${ext}`])
    .split('\n').filter(Boolean).sort();
}

/**
 * Content hash of the corpus, not just a file count. Two worktrees can resolve to
 * paths with the same number of files and different content; only the content
 * decides whether the correctness half of a comparison means anything.
 */
function hashCorpus(files) {
  const h = createHash('sha256');
  let bytes = 0;
  for (const f of files) {
    const buf = readFileSync(f);
    bytes += buf.length;
    h.update(f.split('/').slice(-2).join('/'));
    h.update(buf);
  }
  return { sha256: h.digest('hex').slice(0, 16), files: files.length, bytes };
}

/** Newest mtime under a directory tree — used to prove an artifact was rebuilt. */
function newestMtime(dir) {
  if (!existsSync(dir)) {
    return 0;
  }
  let newest = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else {
        const m = statSync(p).mtimeMs;
        if (m > newest) {
          newest = m;
        }
      }
    }
  };
  walk(dir);
  return newest;
}

/**
 * HARD-FAILS when a worktree has no dependency tree. This is the exact condition
 * under which `build:release` exits 0 having built nothing.
 */
export function assertInstalled(root, label) {
  const nm = join(root, 'node_modules');
  if (!existsSync(nm)) {
    throw new Error(
      `${label}: ${root} has no node_modules. A build here would exit 0 without building `
      + 'anything and every number taken from it would be void. Run `pnpm install` first.'
    );
  }
  const pnpmDir = join(nm, '.pnpm');
  const count = existsSync(pnpmDir) ? readdirSync(pnpmDir).length : 0;
  if (count < 100) {
    throw new Error(`${label}: ${root}/node_modules/.pnpm has only ${count} entries — install is incomplete.`);
  }
  return { nodeModules: nm, pnpmPackages: count };
}

/** Resolved parseman path + version. A stale pointer here fails silently and cleanly. */
export function parsemanEvidence(root) {
  const link = join(root, 'packages/syntax/less/less-parser/node_modules/parseman');
  if (!existsSync(link)) {
    return { path: null, version: null, error: 'parseman not linked into less-parser' };
  }
  const real = realpathSync(link);
  const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
  return { path: real, version: pkg.version };
}

/**
 * Corpus provenance. Reports the REAL resolved path (through every symlink) plus a
 * content hash, so A and B can be compared for equality rather than assumed equal.
 */
export function corpusEvidence(root) {
  const link = join(root, 'node_modules/@less/test-data');
  if (!existsSync(link)) {
    return { resolved: null, present: false, error: '@less/test-data is not installed — corpus-backed cases will silently vanish' };
  }
  const resolved = realpathSync(link);
  const unitLess = findFiles(join(resolved, 'tests-unit'), 'less');
  const unitCss = findFiles(join(resolved, 'tests-unit'), 'css');
  return {
    resolved,
    present: true,
    less: hashCorpus(unitLess),
    css: hashCorpus(unitCss)
  };
}

/** The small in-repo CSS corpus, which is NOT corpus-linked and so is always present. */
export function localCssCorpusEvidence(root) {
  const dir = join(root, 'packages/syntax/css/css-parser/test/css');
  const files = existsSync(dir)
    ? sh('find', ['-L', dir, '-maxdepth', '1', '-type', 'f', '-name', '*.css']).split('\n').filter(Boolean).sort()
    : [];
  return hashCorpus(files);
}

export function sideEvidence(root, label) {
  const install = assertInstalled(root, label);
  return {
    label,
    root,
    head: gitRead(root, ['rev-parse', 'HEAD']),
    headShort: gitRead(root, ['rev-parse', '--short', 'HEAD']),
    dirty: gitRead(root, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).length,
    node: process.version,
    install,
    parseman: parsemanEvidence(root),
    corpus: corpusEvidence(root),
    localCssCorpus: localCssCorpusEvidence(root)
  };
}

/**
 * Build in dependency order and PROVE it. Returns the artifact evidence; throws if
 * any expected artifact is missing or was not touched by this build.
 */
export function buildAndProve(root, label, { filters = BUILD_ORDER } = {}) {
  const started = Date.now();
  for (const f of filters) {
    execFileSync('pnpm', ['--filter', f, 'build'], { cwd: root, stdio: 'pipe', maxBuffer: 1 << 28 });
  }
  const proof = {};
  const stale = [];
  for (const f of filters) {
    const rel = ARTIFACTS[f];
    if (!rel) {
      continue;
    }
    const dir = resolve(root, rel);
    if (!existsSync(dir)) {
      throw new Error(`${label}: build reported success but ${rel} does not exist. The build did not happen.`);
    }
    const mtime = newestMtime(dir);
    proof[f] = { dir, newestMtimeMs: mtime, rebuilt: mtime >= started - 1000 };
    if (!proof[f].rebuilt) {
      stale.push(rel);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `${label}: build reported success but these artifacts were not touched: ${stale.join(', ')}. `
      + 'Measuring them would measure a past version of the repo.'
    );
  }
  return proof;
}

/**
 * Fails when A and B disagree on corpus. A timing comparison can look perfectly
 * healthy while the two sides parsed different bytes, and then the correctness
 * half of the result is meaningless.
 */
export function assertCorpusMatch(a, b) {
  const problems = [];
  if (!a.corpus.present || !b.corpus.present) {
    problems.push(`corpus missing on ${!a.corpus.present ? a.label : b.label} (${(!a.corpus.present ? a : b).corpus.error})`);
  } else {
    for (const kind of ['less', 'css']) {
      if (a.corpus[kind].sha256 !== b.corpus[kind].sha256) {
        problems.push(
          `${kind} corpus MISMATCH: ${a.label} ${a.corpus[kind].sha256} `
          + `(${a.corpus[kind].files} files, ${a.corpus[kind].bytes}B) @ ${a.corpus.resolved} vs `
          + `${b.label} ${b.corpus[kind].sha256} (${b.corpus[kind].files} files, ${b.corpus[kind].bytes}B) @ ${b.corpus.resolved}`
        );
      }
    }
  }
  if (a.localCssCorpus.sha256 !== b.localCssCorpus.sha256) {
    problems.push(
      `in-repo css corpus differs: ${a.label} ${a.localCssCorpus.sha256} (${a.localCssCorpus.files} files) vs `
      + `${b.label} ${b.localCssCorpus.sha256} (${b.localCssCorpus.files} files). `
      + 'This is EXPECTED when A and B are at different commits and that corpus changed — '
      + 'but it means the two sides are not parsing identical input.'
    );
  }
  return problems;
}
