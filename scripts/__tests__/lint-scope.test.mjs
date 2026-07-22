import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { globSync } from 'glob';

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

  it('keeps package-test fixtures outside production scope without globally ignoring them', () => {
    const testRoot = join(ROOT, 'packages', 'awaitable-pipe', 'test');
    const fixture = join(mkdtempSync(join(testRoot, 'lint-scope-proof-')), 'invalid.js');
    writeFileSync(fixture, 'if (true) console.log("this must be linted by lint:tests");\n');
    try {
      const productionFiles = [
        ...globSync('packages/**/src/**/*.{mjs,cjs,js,ts}', { cwd: ROOT, absolute: true }),
        ...globSync('scripts/**/*.{mjs,cjs,js,ts}', { cwd: ROOT, absolute: true }),
        ...globSync('*.config.{mjs,cjs,js,ts}', { cwd: ROOT, absolute: true }),
        ...globSync('vitest.d.ts', { cwd: ROOT, absolute: true }),
        ...globSync('test/setup.ts', { cwd: ROOT, absolute: true })
      ];
      assert.equal(productionFiles.includes(fixture), false);

      const direct = spawnSync(process.execPath, [ESLINT_BIN, '--no-warn-ignored', fixture], {
        cwd: ROOT,
        encoding: 'utf8'
      });
      assert.equal(direct.error, undefined);
      assert.notEqual(direct.status, 0, `${direct.stdout}\n${direct.stderr}`);
    } finally {
      rmSync(dirname(fixture), { recursive: true, force: true });
    }
  });
});
