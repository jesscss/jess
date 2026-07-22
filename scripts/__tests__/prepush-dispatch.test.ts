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
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('pre-push dispatcher', () => {
  it.each([
    ['alpha', 'release:alpha:check'],
    ['dev', 'prepush:changed-packages:upstream']
  ])('runs %s branch through %s', (branch, expectedScript) => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const tempRoot = mkdtempSync(resolve(tmpdir(), 'jess-prepush-dispatch-'));
    const sandbox = resolve(tempRoot, 'repo');
    const fakeBin = resolve(sandbox, '.test-bin');
    const invocationLog = resolve(sandbox, '.pnpm-invocations');
    try {
      execFileSync('git', ['clone', '--quiet', '--no-hardlinks', '--branch', 'dev', repo, sandbox]);
      writeFileSync(
        resolve(sandbox, 'scripts/prepush-dispatch.mjs'),
        readFileSync(resolve(repo, 'scripts/prepush-dispatch.mjs'))
      );
      mkdirSync(fakeBin);
      const fakePnpm = resolve(fakeBin, 'pnpm');
      writeFileSync(fakePnpm, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$JESS_PREPUSH_INVOCATIONS"\n');
      chmodSync(fakePnpm, 0o755);
      if (branch === 'alpha') {
        execFileSync('git', ['switch', '--quiet', '-c', 'alpha'], { cwd: sandbox });
      }

      execFileSync(process.execPath, ['scripts/prepush-dispatch.mjs'], {
        cwd: sandbox,
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
          JESS_PREPUSH_INVOCATIONS: invocationLog
        }
      });

      expect(readFileSync(invocationLog, 'utf8').trim()).toBe(`run ${expectedScript}`);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
