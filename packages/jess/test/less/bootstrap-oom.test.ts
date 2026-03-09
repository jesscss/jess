/**
 * Bootstrap 4 OOM regression test.
 *
 * Verifies that compiling Bootstrap 4 does NOT cause an out-of-memory crash.
 * Bootstrap compilation may fail with Less compat errors (e.g., undefined
 * variables from mixin scoping), but it should fail fast — not OOM.
 *
 * Run with: pnpm test -- --run bootstrap-oom
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import * as path from 'path';
import * as fs from 'fs';

describe('Bootstrap 4 OOM regression', () => {
  const bootstrapLessPort = path.resolve(
    __dirname,
    '../../../../node_modules/bootstrap-less-port/less/bootstrap.less'
  );
  const lessJsBootstrap = path.resolve(
    __dirname,
    '../../../../../less.js/node_modules/.pnpm/bootstrap-less-port@0.3.0/node_modules/bootstrap-less-port/less/bootstrap.less'
  );

  const bootstrapFile = fs.existsSync(bootstrapLessPort)
    ? bootstrapLessPort
    : fs.existsSync(lessJsBootstrap)
      ? lessJsBootstrap
      : null;

  it('compiles Bootstrap 4 without OOM', async () => {
    if (!bootstrapFile) {
      console.warn('bootstrap-less-port not found, skipping');
      return;
    }

    const compiler = new Compiler({
      compile: {
        plugins: [lessPlugin(), lessCompatPlugin()]
      }
    });

    const heapBefore = process.memoryUsage().heapUsed / 1024 / 1024;
    const start = performance.now();

    try {
      const { tree, context } = await compiler.compile(bootstrapFile, {
        suppressWarnings: true,
        breakOnError: false
      });
      const css = tree.toString({ collapseNesting: context.opts.collapseNesting, context });
      expect(css.length).toBeGreaterThan(0);
    } catch (err: any) {
      const ms = performance.now() - start;
      const heapAfter = process.memoryUsage().heapUsed / 1024 / 1024;
      const heapDelta = heapAfter - heapBefore;

      // Should fail fast with reasonable memory, not OOM at 4GB+
      expect(ms).toBeLessThan(10_000);
      expect(heapDelta).toBeLessThan(500);

      // Compilation may fail with various Less compat errors, but the key
      // assertion is that it fails fast without OOM.
      expect(err.message).toBeTruthy();
    }
  }, 30_000);
});
