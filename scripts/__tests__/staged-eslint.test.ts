import { describe, expect, it } from 'vitest';
import { lintStagedFiles } from '../staged-eslint.mjs';

describe('staged ESLint API transport', () => {
  it('keeps a report larger than the legacy stdout buffer intact', async () => {
    const reports = Array.from({ length: 2048 }, (_, index) => ({
      filePath: `/repo/packages/example/src/${index}.ts`,
      messages: [{ line: 1, column: 1, severity: 1, message: 'x'.repeat(600) }],
      errorCount: 0,
      warningCount: 1,
      fatalErrorCount: 0
    }));
    expect(Buffer.byteLength(JSON.stringify(reports))).toBeGreaterThan(1024 * 1024);

    class FakeESLint {
      options: unknown;

      constructor(options: unknown) {
        this.options = options;
      }

      async lintFiles(files: string[]) {
        expect(files).toEqual(['packages/example/src/value.ts']);
        return reports;
      }
    }

    await expect(lintStagedFiles(['packages/example/src/value.ts'], {
      cwd: '/repo',
      ESLintClass: FakeESLint
    })).resolves.toEqual(reports);
  });

  it('propagates a failed ESLint API invocation for the guard to block', async () => {
    class FailingESLint {
      constructor(_options: unknown) {}

      async lintFiles() {
        throw new Error('invalid ESLint configuration');
      }
    }

    await expect(lintStagedFiles(['scripts/example.mjs'], {
      cwd: '/repo',
      ESLintClass: FailingESLint
    })).rejects.toThrow('invalid ESLint configuration');
  });
});
