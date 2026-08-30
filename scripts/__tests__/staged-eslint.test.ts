import { describe, expect, it, vi } from 'vitest';
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

      async lintText(source: string, options: unknown) {
        expect(source).toBe('const staged = true;\n');
        expect(options).toEqual({
          filePath: '/repo/packages/example/src/value.ts',
          warnIgnored: true
        });
        return [reports[0]];
      }
    }

    await expect(lintStagedFiles(['packages/example/src/value.ts'], {
      cwd: '/repo',
      ESLintClass: FakeESLint,
      readStagedFile: () => 'const staged = true;\n'
    })).resolves.toEqual([reports[0]]);
  });

  it('propagates a failed ESLint API invocation for the guard to block', async () => {
    class FailingESLint {
      constructor(_options: unknown) {}

      async lintText() {
        throw new Error('invalid ESLint configuration');
      }
    }

    await expect(lintStagedFiles(['scripts/example.mjs'], {
      cwd: '/repo',
      ESLintClass: FailingESLint,
      readStagedFile: () => 'export {};\n'
    })).rejects.toThrow('invalid ESLint configuration');
  });

  it('reads each staged source once instead of linting the working-tree file', async () => {
    const read = vi.fn(() => 'const indexed = true;\n');
    class FakeESLint {
      constructor(_options: unknown) {}

      async lintText(source: string) {
        expect(source).toBe('const indexed = true;\n');
        return [{ filePath: '/repo/packages/example/src/value.ts', messages: [] }];
      }
    }

    await lintStagedFiles(['packages/example/src/value.ts'], {
      cwd: '/repo',
      ESLintClass: FakeESLint,
      readStagedFile: read
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('packages/example/src/value.ts');
  });
});
