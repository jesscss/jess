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
 * to the strict bundle — `unitMode: 'strict'`, `leakyScope: false`,
 * `allowOverloadedImport: false` — on the compile config, so the values reach
 * eval via `context.opts`. The resolver logic is unit-tested in
 * `@jesscss/styles-config` (options.test.ts); here we prove the compile→eval
 * seam is real by observing `unitMode` flip.
 *
 * The observable used to be `equalityMode` (`2px = 2` true under `less`, false
 * under `exact`). That option is gone (§5.1) — comparison is one set of
 * semantics, not a configurable dialect — so the seam is now watched through
 * `unitMode`, which the preset still sets: an unreconcilable operand pair is a
 * silent non-match under `preserve` and a hard error under `strict`.
 */
async function guardMatches(compileExtra: Record<string, unknown>): Promise<boolean> {
  const dir = mkdtempSync(path.join(tmpdir(), 'strict-'));
  const f = path.join(dir, 'a.less');
  writeFileSync(f, `.m() when (2px > 1em) { hit: 1; }\n.a { .m(); }`);
  const c = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()], ...compileExtra }
  });
  const css = await c.render(f, { breakOnError: false, suppressWarnings: true });
  return css.includes('hit');
}

describe('strict preset (compile→eval seam)', () => {
  it('default (no strict) reports the clash as a non-match, not an error', async () => {
    expect(await guardMatches({})).toBe(false);
  }, 60000);

  it('strict: true sets unitMode \'strict\' — the same pair now raises', async () => {
    await expect(guardMatches({ strict: true })).rejects.toThrow(/Incompatible units/);
  }, 60000);

  it('an explicit unitMode overrides the strict-set value (individual options win)', async () => {
    expect(await guardMatches({ strict: true, unitMode: 'preserve' })).toBe(false);
  }, 60000);
});
