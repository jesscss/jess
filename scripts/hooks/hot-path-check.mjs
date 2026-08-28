#!/usr/bin/env node
/*
 * PostToolUse guard for the hot paths.
 *
 * Reads the Claude Code hook payload on stdin, and when an edited file is on a
 * hot path, runs the hot-path antipattern check against it. The findings are
 * returned to the model as `additionalContext` rather than blocking: the point
 * is to put the violation in front of whoever just wrote it, while it is still
 * their turn.
 *
 * Why this exists. Every defect in the 2026-07-30 sweep -- a scan restarted at
 * index 0 inside a per-statement loop, an array allocated only to test
 * `.length`, four per-node `WeakMap`s, and `indexOf('/*')` re-deriving comment
 * structure the parser already owned -- was invisible to every gate the repo
 * had. They emit byte-identical output, so correctness, byte-identity, and the
 * full Less corpus all stayed green. Documents stating the rule did not stop
 * them; five files state it. Only a mechanical check can.
 *
 * Fails open, always. A guard that blocks a write because it could not find its
 * own checker teaches people to reach for `--no-verify`, which is the failure
 * `c3db7e53e` was landed to end. Missing checker, bad payload, or any internal
 * error exits 0 silently.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, relative, sep } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/** Paths the compiler-grade rules bind. Keep in sync with the scope statement
 * in `docs/perf/V8-ARCHITECTURE.md` invariant 11. A glob here that stops
 * resolving is indistinguishable from a guard that passed -- see the
 * `e96d1035d` regroup, which left every parser rule pointing at a directory
 * that no longer existed. */
function isHotPath(relPath) {
  const p = relPath.split(sep).join('/');
  return p.startsWith('packages/core/src/ast/')
    || p.startsWith('packages/core/src/tree/')
    || /^packages\/syntax\/[^/]+\/[^/]+-parser\/src\//.test(p)
    || p.startsWith('packages/parser-shared/src/');
}

function readStdin() {
  try {
    return require('node:fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdin();
  if (raw.trim() === '') {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const filePath = payload?.tool_response?.filePath ?? payload?.tool_input?.file_path;
  if (typeof filePath !== 'string' || !filePath.endsWith('.ts')) {
    return;
  }

  const relPath = relative(REPO_ROOT, resolve(filePath));
  if (relPath.startsWith('..') || !isHotPath(relPath)) {
    return;
  }

  const checker = resolve(REPO_ROOT, 'scripts/verify-hot-path-antipatterns.mjs');
  if (!existsSync(checker)) {
    /* The checker lands with the hot-path antipattern gate. Until then this
     * hook is a no-op rather than a source of noise. */
    return;
  }

  const run = spawnSync(process.execPath, [checker, '--file', relPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 20_000
  });

  if (run.status === 0 || run.error) {
    return;
  }

  /*
   * Distinguish "the checker found something" from "the checker fell over".
   * A worktree without `node_modules` makes it throw MODULE_NOT_FOUND, and
   * reporting that stack as a finding is precisely the misfire this hook must
   * never produce -- an unbuilt worktree would flag every edit. Findings come
   * from stdout; a stack on stderr means skip.
   */
  const stderr = run.stderr ?? '';
  if (/Cannot find module|MODULE_NOT_FOUND|^\s+at .+:\d+:\d+$/m.test(stderr)) {
    return;
  }

  const findings = (run.stdout ?? '').trim();
  if (findings === '') {
    return;
  }

  process.stdout.write(JSON.stringify({
    systemMessage: `hot-path check flagged ${relPath}`,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: [
        `Hot-path antipattern check flagged \`${relPath}\`:`,
        '',
        findings,
        '',
        'These are compiler-grade rules -- see `docs/perf/V8-ARCHITECTURE.md`',
        'invariant 11. None of this class changes emitted bytes, so no test or',
        'byte-identity gate will catch it. Fix it now or state explicitly why it',
        'is correct here; do not leave it silent.'
      ].join('\n')
    }
  }));
}

try {
  main();
} catch {
  // Fail open. See header.
}
