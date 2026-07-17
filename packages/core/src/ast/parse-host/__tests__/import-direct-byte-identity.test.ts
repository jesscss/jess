import { describe, it, expect } from 'vitest';
import { renderAstFile } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';
import { renderImportOracle } from './import-oracle.js';

/**
 * `@import` resolution on the DIRECT build host (`parseToAst` → `resolveDirectImports`
 * → `serialize`), the whole-document render path — distinct from the bridge path the
 * sibling `import-modes-byte-identity` suite covers. The direct host resolves +
 * inlines imports itself (gap G5); this pins the plain / once / reference modes
 * byte-identically against the real import-resolving jess Compiler oracle.
 *
 * The `(reference)` case is authored WITHOUT a mixin call so it isolates the
 * reference-VISIBILITY projection (unused rulesets suppressed; a definition that
 * crosses the import boundary still resolves) from mixin-call EXPANSION, which is a
 * separate direct-host gap (G2). The mixin-inclusive `ref-main.less` reference
 * fixture is covered on the bridge path in `import-modes-byte-identity`.
 */
const DIR = `${__dirname}/fixtures/import`;
const ev = buildEvaluator(makeBuiltinRegistry());

function renderDirect(file: string): string {
  const r = renderAstFile(file, { evaluator: ev });
  if (r.threw) throw r.threw;
  if (r.css === undefined) throw new Error(`no css (parse errors: ${JSON.stringify(r.parseErrors)})`);
  return r.css;
}

describe('tree2 @import — DIRECT host byte-identity', () => {
  it('plain: imported statements inline at the import site', async () => {
    const file = `${DIR}/plain-main.less`;
    expect(renderDirect(file)).toBe(await renderImportOracle(file));
  });

  it('once (default dedup): a repeated import of the same file emits once', async () => {
    const file = `${DIR}/once-main.less`;
    expect(renderDirect(file)).toBe(await renderImportOracle(file));
  });

  it('(reference): unused rulesets suppressed; a boundary-crossing var still resolves', async () => {
    const file = `${DIR}/ref-direct-main.less`;
    const css = renderDirect(file);
    expect(css).toBe(await renderImportOracle(file));
    expect(css).not.toContain('unused');
    expect(css).not.toContain('should');
    expect(css).toContain('#abc');
  });
});
