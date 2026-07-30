/**
 * Corpus loading for jess's byte-identity gate.
 *
 * This used to be `parseman/oracle.loadCorpus`. It came back here because
 * walking a directory tree and turning it into stable ids is not something that
 * helps anyone BUILD or DIAGNOSE a grammar — it is regression-suite plumbing,
 * and it is jess's corpus, jess's roots and jess's baseline that it exists to
 * serve. What stayed in parseman is the one thing only parseman can do:
 * deterministic serialization of a parse result, `digestInto`.
 *
 * Two properties are load-bearing and both are easy to lose:
 *
 *  - **Ids are relative to `base`.** An absolute id bakes the checkout
 *    directory into every digest, so two worktrees can never agree and the
 *    first cross-machine comparison reads as a total regression.
 *  - **A root that is not there is reported, never silently dropped.** A
 *    missing root yields a SMALLER corpus and therefore a different-but-
 *    plausible aggregate. Missing roots throw unless you opt in, and then you
 *    get them back so the run can say what it skipped.
 *
 * Sources are read LAZILY, one entry at a time, rather than slurped up front.
 * The digest only ever needs one file's text at a time, and holding all 700+
 * of them for the duration of the walk is live memory bought for nothing.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const DEFAULT_IGNORE = ['.git', 'node_modules/.cache'];

/** Always POSIX-separated, so a Windows run and a POSIX run agree. */
function idOf(base, full) {
  return relative(base, full).split(sep).join('/');
}

/**
 * Walk `roots` under `base` and return the corpus as ids plus a lazy reader.
 *
 * @param {{
 *   base: string,
 *   roots: readonly string[],
 *   extensions: readonly string[],
 *   maxBytes?: number,
 *   ignoreDirs?: readonly string[],
 *   allowMissingRoots?: boolean
 * }} options
 * @returns {{ ids: string[], read: (id: string) => string, missingRoots: string[], skippedLarge: string[] }}
 */
export function loadCorpus(options) {
  const base = resolve(options.base);
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORE;

  /*
   * A NAME pattern matches any directory so called; a PATH pattern (one
   * containing a separator) matches a suffix of the path relative to the root.
   * Testing a basename against `node_modules/.cache` matches nothing, so a
   * declared exclusion would silently admit every cache file it named — and a
   * digest that includes a local build cache is exactly the filesystem-
   * dependent reading ids-relative-to-base exists to prevent.
   */
  const ignoreNames = new Set(ignoreDirs.filter(d => !d.includes('/')));
  const ignorePaths = ignoreDirs
    .filter(d => d.includes('/'))
    .map(d => d.replace(/^\.?\/+/, '').replace(/\/+$/, ''));

  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const exts = new Set(options.extensions.map(e => e.toLowerCase()));

  const missingRoots = [];
  const skippedLarge = [];

  /*
   * Keyed by REALPATH, so one physical file reached through two aliased roots
   * is one entry. The value is the id kept — the SMALLEST, not the first seen,
   * so the corpus is a function of the files and the base alone and not of the
   * order `roots` happens to be listed in.
   */
  const files = new Map();

  const isIgnored = (name, relFromRoot) =>
    ignoreNames.has(name) || ignorePaths.some(p => relFromRoot === p || relFromRoot.endsWith(`/${p}`));

  const walk = (dir, root, visited) => {
    let real;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }

    /*
     * Cycle detection only, and scoped to THIS root's traversal. A set shared
     * across roots makes the second of two aliased roots return immediately,
     * so it contributes nothing and swapping the root order changes every id
     * it owned.
     */
    if (visited.has(real)) {
      return;
    }
    visited.add(real);

    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, item.name);
      if (isIgnored(item.name, relative(root, full).split(sep).join('/'))) {
        continue;
      }

      // A symlink reports neither isDirectory nor isFile, so stat through it.
      let isDir = item.isDirectory();
      let isFile = item.isFile();
      let size = 0;
      if (item.isSymbolicLink() || (!isDir && !isFile)) {
        try {
          const st = statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
          size = st.size;
        } catch {
          continue;
        }
      }

      if (isDir) {
        walk(full, root, visited);
        continue;
      }
      if (!isFile) {
        continue;
      }

      const dot = item.name.lastIndexOf('.');
      if (dot < 0 || !exts.has(item.name.slice(dot).toLowerCase())) {
        continue;
      }
      if (size === 0) {
        try {
          size = statSync(full).size;
        } catch {
          continue;
        }
      }
      if (size > maxBytes) {
        skippedLarge.push(idOf(base, full));
        continue;
      }

      let realFile;
      try {
        realFile = realpathSync(full);
      } catch {
        continue;
      }
      const id = idOf(base, full);
      const existing = files.get(realFile);
      if (existing === undefined || id < existing) {
        files.set(realFile, id);
      }
    }
  };

  for (const root of options.roots) {
    const full = resolve(base, root);
    let ok = false;
    try {
      ok = statSync(full).isDirectory();
    } catch {
      ok = false;
    }
    if (!ok) {
      if (!options.allowMissingRoots) {
        throw new Error(
          `loadCorpus: root ${JSON.stringify(root)} does not resolve to a directory (${full}). A corpus that `
          + 'quietly shrank produces a different aggregate that looks like a grammar change. Fix the root, or pass '
          + 'allowMissingRoots and record `missingRoots` alongside the digest.'
        );
      }
      missingRoots.push(root);
      continue;
    }
    walk(full, full, new Set());
  }

  return {
    ids: [...files.values()].sort(),
    read: id => readFileSync(resolve(base, id), 'utf8'),
    missingRoots,
    skippedLarge: skippedLarge.sort()
  };
}
