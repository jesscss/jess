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

describe('changed package checks', () => {
  it('keeps staged checks independent from the release-only push gate', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const tempRoot = mkdtempSync(resolve(tmpdir(), 'jess-alpha-precommit-'));
    const sandbox = resolve(tempRoot, 'repo');
    const fakeBin = resolve(sandbox, '.test-bin');
    const invocationLog = resolve(sandbox, '.pnpm-invocations');
    try {
      execFileSync('git', [
        'clone',
        '--quiet',
        '--no-hardlinks',
        '--branch',
        'dev',
        repo,
        sandbox
      ]);
      writeFileSync(
        resolve(sandbox, 'scripts/precommit-changed-checks.mjs'),
        readFileSync(resolve(repo, 'scripts/precommit-changed-checks.mjs'))
      );
      writeFileSync(
        resolve(sandbox, 'scripts/staged-lint.mjs'),
        readFileSync(resolve(repo, 'scripts/staged-lint.mjs'))
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
        'run verify:config-syntax -- --staged',
        'run verify:config-syntax -- --staged'
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('runs changed packages once in non-watch mode without duplicating package-owned runner flags', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const tempRoot = mkdtempSync(resolve(tmpdir(), 'jess-prepush-review-'));
    const sandbox = resolve(tempRoot, 'repo');
    const fakeBin = resolve(sandbox, '.test-bin');
    const invocationLog = resolve(sandbox, '.pnpm-invocations');
    try {
      execFileSync('git', [
        'clone',
        '--quiet',
        '--no-hardlinks',
        '--branch',
        'dev',
        repo,
        sandbox
      ]);
      writeFileSync(
        resolve(sandbox, 'scripts/precommit-changed-checks.mjs'),
        readFileSync(resolve(repo, 'scripts/precommit-changed-checks.mjs'))
      );
      writeFileSync(
        resolve(sandbox, 'scripts/staged-lint.mjs'),
        readFileSync(resolve(repo, 'scripts/staged-lint.mjs'))
      );
      mkdirSync(fakeBin);
      const fakePnpm = resolve(fakeBin, 'pnpm');
      writeFileSync(fakePnpm, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$JESS_PRECOMMIT_INVOCATIONS"\n');
      chmodSync(fakePnpm, 0o755);

      const coreProbe = resolve(sandbox, 'packages/core/src/prepush-dev-probe.ts');
      const coreProbe = resolve(sandbox, 'packages/core/src/prepush-dev-probe.ts');

      /*
       * The clone is of origin/dev HEAD (pre-regroup), so the nested parser
       * directory does not exist in the sandbox yet. Fabricate it so the
       * probe write succeeds; the path string is what the precommit script
       * classifies, not the surrounding tree.
       */
      mkdirSync(resolve(sandbox, 'packages/syntax/jess/jess-parser/src'), { recursive: true });
      const parserProbe = resolve(sandbox, 'packages/syntax/jess/jess-parser/src/prepush-dev-probe.ts');
      writeFileSync(coreProbe, 'export const prepushDevCoreProbe = true;\n');
      writeFileSync(parserProbe, 'export const prepushDevParserProbe = true;\n');
      execFileSync('git', [
        'add',
        'packages/core/src/prepush-dev-probe.ts',
        'packages/syntax/jess/jess-parser/src/prepush-dev-probe.ts',
        'scripts/precommit-changed-checks.mjs',
        'scripts/staged-lint.mjs'
      ], { cwd: sandbox });
      execFileSync('git', ['commit', '--quiet', '-m', 'test: committed pre-push probe'], { cwd: sandbox });

      const env = {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
        JESS_PRECOMMIT_INVOCATIONS: invocationLog
      };
      execFileSync(process.execPath, [
        'scripts/precommit-changed-checks.mjs',
        '--mode=upstream'
      ], { cwd: sandbox, env, encoding: 'utf8' });

      expect(readFileSync(invocationLog, 'utf8').trim().split('\n')).toEqual([
        'run verify:config-syntax',
        'run verify:parser-runtime-boundary',
        '--filter ./packages/core test -- --run',
        '-w exec tsc -p packages/core/tsconfig.build.json --noEmit',
        '--filter ./packages/core build',
        'exec eslint packages/core/src/prepush-dev-probe.ts',
        '--filter ./packages/syntax/jess/jess-parser test',
        '-w exec tsc -p packages/syntax/jess/jess-parser/tsconfig.build.json --noEmit',
        '--filter ./packages/syntax/jess/jess-parser build',
        'exec eslint packages/syntax/jess/jess-parser/src/prepush-dev-probe.ts'
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
