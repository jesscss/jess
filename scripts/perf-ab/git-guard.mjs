/**
 * The only place in this harness allowed to run `git` against the B worktree.
 *
 * WHY AN ALLOWLIST AND NOT A DENYLIST
 * -----------------------------------
 * `git stash`, `git restore`, `git checkout -- .` and `git reset --hard` have each
 * silently destroyed work in this repo. A denylist is the wrong shape for that
 * risk: it fails open on the spelling nobody thought of (`git clean -xfd`,
 * `git checkout .`, `git switch --discard-changes`, a future subcommand). This
 * module instead enumerates the EXACT argv shapes the harness may ever use and
 * rejects everything else, so a destructive command is not something the harness
 * declines to run — it is something the harness cannot express.
 *
 * There is deliberately no escape hatch, no `force` option, and no way to pass a
 * raw argv through. Adding one defeats the entire module.
 */
import { execFileSync } from 'node:child_process';

/** Subcommands that only read. None of these can modify a working tree. */
const READ_ONLY = new Set([
  'rev-parse', 'status', 'log', 'show', 'config', 'describe', 'cat-file',
  'symbolic-ref', 'worktree', 'diff', 'ls-files', 'merge-base'
]);

/**
 * The ONE mutating shape the harness needs: move a detached B onto a commit.
 * `--detach` is required, so `checkout -- <path>` and `checkout <branch>` are both
 * unrepresentable. `git checkout --detach` also refuses on its own when it would
 * clobber local modifications; the clean-tree assertion below is the belt to that
 * brace, and runs first.
 */
function isDetachedCheckout(args) {
  return args.length === 3 && args[0] === 'checkout' && args[1] === '--detach';
}

class GitGuardError extends Error {}

/** `git worktree list --porcelain` is the authority on what is a worktree root. */
function assertIsWorktreeRoot(dir) {
  let top;
  try {
    top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch (e) {
    throw new GitGuardError(`${dir} is not inside a git worktree: ${e.message}`);
  }
  if (top !== dir) {
    throw new GitGuardError(`refusing to operate on ${dir}: it is not a worktree root (root is ${top})`);
  }
}

/**
 * The single most dangerous thing this harness does is move B to another commit.
 * It may only ever do so when B has NOTHING to lose: no modified tracked files, no
 * staged changes, and no untracked files. Untracked counts — an agent's scratch
 * file or an un-added new source file is exactly the work that has been destroyed
 * here before, and `checkout --detach` will happily blow past some of it.
 */
export function assertClean(dir) {
  const porcelain = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28
  });
  const dirty = porcelain.split('\n').filter(Boolean);
  if (dirty.length > 0) {
    throw new GitGuardError(
      `refusing to touch ${dir}: working tree is not clean (${dirty.length} entries).\n`
      + dirty.slice(0, 20).map(l => `    ${l}`).join('\n')
      + (dirty.length > 20 ? `\n    ...and ${dirty.length - 20} more` : '')
      + '\n\nThis harness never discards changes. Commit them, move them, or delete them '
      + 'yourself, then re-run. It will not do it for you.'
    );
  }
}

/** Read-only git. Safe against any worktree, including A. */
export function gitRead(dir, args) {
  if (!READ_ONLY.has(args[0])) {
    throw new GitGuardError(`gitRead refuses '${args[0]}': not a read-only subcommand`);
  }
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
}

/**
 * Move a worktree to a commit. The ONLY mutating git this harness can perform.
 *
 * `guardDir` is the worktree that must be B. `protectedDirs` are worktrees this
 * harness must never move (A, and the main checkout, which mirrors dev and holds
 * the owner's uncommitted WIP).
 */
export function checkoutDetached(dir, commitish, protectedDirs = []) {
  const args = ['checkout', '--detach', commitish];
  if (!isDetachedCheckout(args)) {
    throw new GitGuardError('internal: refusing a non-detached checkout shape');
  }
  assertIsWorktreeRoot(dir);
  for (const p of protectedDirs) {
    if (dir === p) {
      throw new GitGuardError(`refusing to move ${dir}: it is a protected worktree (A or the main checkout)`);
    }
  }

  // Clean-tree assertion FIRST. If this throws, nothing has been touched.
  assertClean(dir);
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  return gitRead(dir, ['rev-parse', 'HEAD']);
}

export { GitGuardError };
