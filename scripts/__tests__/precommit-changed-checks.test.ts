import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('pre-commit aggressive-review mode', () => {
  it('uses release mode only for an alpha squash commit', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const tempRoot = mkdtempSync(resolve(tmpdir(), 'jess-alpha-precommit-'));
    const sandbox = resolve(tempRoot, 'repo');
    const fakeBin = resolve(sandbox, '.test-bin');
    const invocationLog = resolve(sandbox, '.pnpm-invocations');
    try {
      execFileSync('git', ['clone', '--quiet', '--no-hardlinks', repo, sandbox]);
      writeFileSync(
        resolve(sandbox, 'scripts/precommit-changed-checks.mjs'),
        readFileSync(resolve(repo, 'scripts/precommit-changed-checks.mjs'))
      );
      mkdirSync(fakeBin);
      const fakePnpm = resolve(fakeBin, 'pnpm');
      writeFileSync(fakePnpm, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$JESS_PRECOMMIT_INVOCATIONS"\n');
      chmodSync(fakePnpm, 0o755);

      const probe = resolve(sandbox, 'docs/precommit-mode-probe.md');
      writeFileSync(probe, 'release-mode probe\n');
      execFileSync('git', ['add', 'docs/precommit-mode-probe.md'], { cwd: sandbox });
      execFileSync('git', ['switch', '--quiet', '-c', 'alpha'], { cwd: sandbox });

      const env = {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
        JESS_PRECOMMIT_INVOCATIONS: invocationLog
      };
      execFileSync(process.execPath, [
        'scripts/precommit-changed-checks.mjs',
        '--mode=staged'
      ], { cwd: sandbox, env, encoding: 'utf8' });

      execFileSync('git', ['switch', '--quiet', 'dev'], { cwd: sandbox });
      execFileSync(process.execPath, [
        'scripts/precommit-changed-checks.mjs',
        '--mode=staged'
      ], { cwd: sandbox, env, encoding: 'utf8' });

      expect(readFileSync(invocationLog, 'utf8').trim().split('\n')).toEqual([
        'run verify:aggressive-cutting-review -- --mode=release --skip-executable-evidence',
        'run verify:aggressive-cutting-review -- --mode=staged --skip-executable-evidence'
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
