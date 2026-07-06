import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import { resolveLessTestDataRoot, lessHarnessFunctionsPlugin } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/**
 * `strict` convenience preset. Modeled after tsconfig `strict`: it only SETS
 * semantic options (for any left undefined), it is not itself a mode. It expands
 * to the v5 bundle — `functionMode: 'preserve'`, `unitMode: 'preserve'`,
 * `leakyScope: true`, `allowOverloadedImport: false` — on the compile config, so
 * the values reach eval via `context.opts`. `equalityMode` (a dialect) is
 * untouched. The resolver logic itself is unit-tested in
 * `@jesscss/styles-config` (options.test.ts); here we prove the compile→eval
 * seam: `strict` carries `functionMode` through, and an explicit option wins.
 */
const TD = resolveLessTestDataRoot();
const UNRESOLVED_FN = 'tests-error/eval/unit-function'; // matched builtin, can't eval

function makeCompiler(compileExtra: Record<string, unknown> = {}) {
  return new Compiler({
    output: { collapseNesting: true },
    compile: {
      plugins: [lessPlugin(), lessCompatPlugin({ plugins: [lessHarnessFunctionsPlugin] })],
      ...compileExtra
    }
  });
}

describe('strict preset (compile→eval seam)', () => {
  it("strict: true sets functionMode 'preserve' — the call renders as-is and warns", async () => {
    const r = await makeCompiler({ strict: true })
      .renderToResult(path.join(TD, `${UNRESOLVED_FN}.less`), { breakOnError: true } as any);
    expect(r.errors ?? []).toHaveLength(0);
    expect(r.css.length).toBeGreaterThan(0);
    expect((r.warnings ?? []).map((w: any) => w.code)).toContain('function/unresolved');
  }, 60000);

  it('an explicit functionMode overrides the strict-set value (individual options win)', async () => {
    // strict would set 'preserve'; the explicit 'error' must win and throw.
    const r = await makeCompiler({ strict: true, functionMode: 'error' })
      .renderToResult(path.join(TD, `${UNRESOLVED_FN}.less`), { breakOnError: true } as any)
      .catch((e: any) => ({ errors: [{ message: String(e?.message) }] }));
    expect((r as any).errors?.length ?? 0).toBeGreaterThan(0);
  }, 60000);
});
