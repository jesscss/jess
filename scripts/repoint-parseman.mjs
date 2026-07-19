#!/usr/bin/env node
/**
 * Repoint node_modules/parseman to an absolute symlink.
 *
 * pnpm turns an absolute `link:` spec into a RELATIVE symlink whose `../` depth
 * encodes the install directory's depth. This repo is checked out at multiple
 * depths (main `~/git/oss/jess` and nested git worktrees under
 * `.claude/worktrees/agent-*`), so a relative link generated for one depth
 * resolves to the wrong place at another, breaking `require('parseman')`.
 *
 * The `link:` target is an absolute path, so an absolute symlink is
 * depth-invariant and always correct. This runs on postinstall to enforce it.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const spec = pkg.dependencies?.parseman ?? pkg.devDependencies?.parseman;
if (!spec || !spec.startsWith('link:')) {
  process.exit(0); // nothing to enforce
}
const target = spec.slice('link:'.length);
if (!existsSync(target)) {
  console.error(`[repoint-parseman] link: target does not exist: ${target}`);
  process.exit(0); // don't fail the install; surface loudly
}
const nm = join(root, 'node_modules');
if (!existsSync(nm)) {
  mkdirSync(nm, { recursive: true });
}
const linkPath = join(nm, 'parseman');

// Already resolving to the right place? Leave it (relative-but-correct is fine).
try {
  if (realpathSync(linkPath) === realpathSync(target)) {
    process.exit(0);
  }
} catch { /* broken/dangling/missing link — recreate below */ }

// Remove whatever is there: symlink (broken or not) -> unlink; real dir -> rm -r.
try {
  const st = lstatSync(linkPath);
  if (st.isDirectory() && !st.isSymbolicLink()) {
    rmSync(linkPath, { recursive: true, force: true });
  } else {
    unlinkSync(linkPath);
  }
} catch { /* nothing to remove */ }

symlinkSync(target, linkPath);
console.error(`[repoint-parseman] linked node_modules/parseman -> ${target}`);
