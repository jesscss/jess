/**
 * Internal trust-boundary helpers for `@jesscss/plugin-js`. Not part of the
 * published API: the package `exports` map exposes only `.`, and `index.ts`
 * does not re-export anything from here. Tests import this module directly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

/** Whether `candidatePath` is `rootPath` or lies inside it (pure path math; callers canonicalize first). */
export const isPathInside = (candidatePath: string, rootPath: string): boolean => {
  const rel = path.relative(rootPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * The one package we load in this Node process instead of the Deno sandbox:
 * the built-in `@jesscss/fns`. We identify it by the REALPATH of the copy this
 * plugin itself resolves through its own dependency edge — never by a package
 * name or a path spelling, both of which a script author controls. A
 * `package.json` can name itself `@jesscss/fns`, and a directory or a symlink
 * can be spelled `@jesscss/fns`, but the realpath of the dependency we resolve
 * from our own location cannot be forged that way (it does follow the install
 * graph: an `overrides`/replacement of `@jesscss/fns` is what we resolve).
 * Resolved once; `undefined` when `@jesscss/fns` is not installed beside this
 * plugin, in which case nothing is trusted and every script runs sandboxed
 * (fail closed).
 */
const trustedFnsRoot: string | undefined = (() => {
  try {
    const manifest = createRequire(import.meta.url).resolve('@jesscss/fns/package.json');
    return fs.realpathSync.native(path.dirname(manifest));
  } catch {
    return undefined;
  }
})();

/**
 * The canonical realpath of `importPath` when it is a file inside the trusted
 * `@jesscss/fns` package, else `undefined`. Both the candidate and the trusted
 * root are canonicalized with `realpathSync.native`, so a symlink, a `..`
 * segment, or a case-variant spelling on a case-insensitive filesystem cannot
 * pass off a file as trusted that does not physically live in the resolved
 * package. A path that cannot be canonicalized (it does not exist) is untrusted.
 *
 * The caller both DECIDES trust and IMPORTS this returned realpath, so the file
 * checked and the file loaded are the same inode-path — a symlink component
 * swapped between a lexical check and the import cannot redirect the load.
 */
export const trustedFnsRealPath = (importPath: string): string | undefined => {
  if (trustedFnsRoot === undefined) {
    return undefined;
  }
  let realPath: string;
  try {
    realPath = fs.realpathSync.native(path.resolve(importPath));
  } catch {
    return undefined;
  }
  return isPathInside(realPath, trustedFnsRoot) ? realPath : undefined;
};
