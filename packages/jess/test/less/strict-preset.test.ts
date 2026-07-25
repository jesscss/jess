import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/**
 * `strict` convenience preset. Modeled after tsconfig `strict`: it only SETS
 * semantic options (for any left undefined), it is not itself a mode. It expands
 * to the strict bundle — `unitMode: 'strict'`, `equalityMode: 'exact'`,
 * `leakyScope: false`, `allowOverloadedImport: false` — on the compile config, so
 * the values reach eval via `context.opts`. The resolver logic is unit-tested in
 * `@jesscss/styles-config` (options.test.ts); here we prove the compile→eval seam
 * is real by observing `equalityMode` flip: `2px = 2` is true under the default
 * `less` dialect but false under strict's `exact`.
 */
async function guardMatches(compileExtra: Record<string, unknown>): Promise<boolean> {
  const dir = mkdtempSync(path.join(tmpdir(), 'strict-'));
  const f = path.join(dir, 'a.less');
  writeFileSync(f, `.m() when (2px = 2) { hit: 1; }\n.a { .m(); }`);
  const c = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()], ...compileExtra }
  });
  const css = await c.render(f, { breakOnError: false, suppressWarnings: true } as any);
  return css.includes('hit');
}

describe('strict preset (compile→eval seam)', () => {
  it('default (no strict) uses the less dialect — `2px = 2` matches', async () => {
    expect(await guardMatches({})).toBe(true);
  }, 60000);

  it('strict: true sets equalityMode \'exact\' — `2px = 2` no longer matches', async () => {
    expect(await guardMatches({ strict: true })).toBe(false);
  }, 60000);

  it('an explicit equalityMode overrides the strict-set value (individual options win)', async () => {
    // strict would set 'exact'; the explicit 'less' must win, so the guard matches.
    expect(await guardMatches({ strict: true, equalityMode: 'less' })).toBe(true);
  }, 60000);
});
