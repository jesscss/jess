import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst, sniffFileVarsViaAst } from './bridge.js';
import { createImportState } from '../import.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';
import { renderImportOracle } from './import-oracle.js';

// Authored fixtures pinning each @import MODE explicitly. The real less.js
// corpus has no clean-passing `(reference)` fixture — every corpus reference
// case is entangled with the extend-across-reference trap (a reference-imported
// rule pulled into visibility by `:extend`, which the tree2 reference fold does
// not yet reproduce and is deferred) — so a purpose-built pair is the honest way
// to cover the reference visibility projection in isolation. The oracle is the
// same real import-resolving jess Compiler the sibling import-byte-identity test
// uses; these fixtures live under this suite's own fixtures/ dir.
const DIR = `${__dirname}/fixtures/import`;

/** Parse + bridge a FILE (resolving its imports), serialize to CSS bytes. */
async function renderAstFile(file: string): Promise<string> {
  const src = fs.readFileSync(file, 'utf8');
  const parsed = parseLessFn(src);
  const bridged = bridgeToAst(parsed.tree, src, file, createImportState(sniffFileVarsViaAst));
  const evaluator = buildEvaluator(makeBuiltinRegistry());
  return (await serialize(bridged, { evaluator })).css;
}

describe('tree2 @import — import-mode byte-identity (authored fixtures)', () => {
  it('plain: imported statements inline at the import site', async () => {
    const file = `${DIR}/plain-main.less`;
    expect(await renderAstFile(file)).toBe(await renderImportOracle(file));
  });

  it('once (default dedup): a repeated import of the same file emits once', async () => {
    const file = `${DIR}/once-main.less`;
    expect(await renderAstFile(file)).toBe(await renderImportOracle(file));
  });

  it('(reference): unused rulesets suppressed; referenced mixin + var still resolve', async () => {
    const file = `${DIR}/ref-main.less`;
    const t2css = await renderAstFile(file);
    expect(t2css).toBe(await renderImportOracle(file));
    // The reference-only ruleset contributes NO output; the mixin it defines is
    // pulled in where called, and its variable crosses the import boundary.
    expect(t2css).not.toContain('unused-ruleset');
    expect(t2css).toContain('from: reference-mixin');
    expect(t2css).toContain('width: 42px');
  });

  it('(specifier): a variable-interpolated path resolves + inlines', async () => {
    const file = `${DIR}/interp-main.less`;
    const t2css = await renderAstFile(file);
    expect(t2css).toBe(await renderImportOracle(file));
    // The `@{theme}.less` path resolved to interp-target.less and inlined.
    expect(t2css).toContain('from: interpolated-import');
  });

  it('(specifier): interpolation vars hoisted from a later plain import resolve', async () => {
    // `@{prefix}-@{suffix}` are defined in a file imported AFTER the interpolated
    // import — Less hoists imported variables into scope, so the path still
    // resolves. Exercises the transitive plain-import variable collection.
    const file = `${DIR}/interp-cross-main.less`;
    const t2css = await renderAstFile(file);
    expect(t2css).toBe(await renderImportOracle(file));
    expect(t2css).toContain('from: interpolated-import');
  });

  // Less is last-declaration-wins: a variable redefined BEFORE an interpolated
  // import path must resolve to the LAST value (`@theme` = "interp-target", not
  // the earlier "does-not-exist"). Regression for the first-wins bug in
  // collectFileVars — a first-wins collector would resolve the stale first value
  // and fail to find the target. Verified against `less@4.6.3`.
  it('(specifier): a variable redefined before the import resolves to the LAST value', async () => {
    const file = `${DIR}/interp-redefine-main.less`;
    const t2css = await renderAstFile(file);
    expect(t2css).toBe(await renderImportOracle(file));
    expect(t2css).toContain('from: interpolated-import');
  });

  // The `.themed` block (from interp-target) then the local `.own` rule — the
  // exact `less@4.6.3` output for the two cross-file cases below. The legacy jess
  // Compiler oracle MIS-resolves these (it reads the stale local value at path-
  // resolution time and throws `File not found: does-not-exist.less`), so the
  // trustworthy anchor is the real Less 4.x output, not that oracle.
  const CROSS_FILE_EXPECTED = '.themed {\n  from: interpolated-import;\n}\n.own {\n  color: blue;\n}\n';

  // A plain import placed AFTER the stale own decl splices its `@theme` at that
  // position, so (last-wins by source position) the imported value overrides the
  // earlier own value. Guards the source-order interleave in collectFileVars.
  it('(specifier): an import after a stale own decl overrides it (positional last-wins)', async () => {
    const t2css = await renderAstFile(`${DIR}/interp-import-after-main.less`);
    expect(t2css).toBe(CROSS_FILE_EXPECTED);
  });

  // Cross-file scope shadowing: the importing (inner) file redefines `@theme`
  // locally; that innermost binding must win over the outer file's stale value.
  // Guards importScopeVars keeping the innermost value. Verified against 4.x.
  it('(specifier): an inner redefinition shadows the outer value (innermost wins)', async () => {
    const t2css = await renderAstFile(`${DIR}/interp-shadow-main.less`);
    expect(t2css).toBe(CROSS_FILE_EXPECTED);
  });

  it('(inline): raw bytes of the target emitted verbatim', async () => {
    const file = `${DIR}/inline-main.less`;
    expect(await renderAstFile(file)).toBe(await renderImportOracle(file));
  });

  // DEFERRED: a media-query postlude (`@import (inline) "x" (min-width:…)`) wraps
  // the raw splice in an `@media` block; that needs the postlude query serialized
  // as an at-rule prelude, so the bridge still rejects `import:inline-media` (the
  // census counts it; no mis-emit). Un-skip once the postlude wrap lands.
  it.skip('(inline media): raw bytes wrapped in @media (postlude)', async () => {
    const file = `${DIR}/inline-media-main.less`;
    expect(await renderAstFile(file)).toBe(await renderImportOracle(file));
  });
});
