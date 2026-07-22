import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ESLINT_BIN = join(ROOT, 'node_modules/eslint/bin/eslint.js');

describe('repository ESLint scope', () => {
  it('ignores a lint-invalid fixture under .claude/worktrees', () => {
    const worktreeRoot = join(ROOT, '.claude', 'worktrees');
    mkdirSync(worktreeRoot, { recursive: true });
    const fixtureDir = mkdtempSync(join(worktreeRoot, 'lint-scope-proof-'));
    const fixture = join(fixtureDir, 'invalid.js');
    writeFileSync(fixture, 'if (true) console.log("this must be ignored");\n');
    try {
      const result = spawnSync(process.execPath, [ESLINT_BIN, '--no-warn-ignored', fixture], {
        cwd: ROOT,
        encoding: 'utf8'
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(existsSync(fixture), true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
