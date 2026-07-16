import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../tree2/index.js';
import { bridgeToTree2 } from '../bridge.js';
import { createImportState } from '../import-bridge.js';
import { buildEvaluator } from '../value-eval.js';
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
async function renderTree2File(file: string): Promise<string> {
  const src = fs.readFileSync(file, 'utf8');
  const parsed = parseLessFn(src);
  const bridged = bridgeToTree2(parsed.tree, src, file, createImportState());
  const evaluator = buildEvaluator();
  return (await serialize(bridged, { evaluator })).css;
}

describe('tree2 @import — import-mode byte-identity (authored fixtures)', () => {
  it('plain: imported statements inline at the import site', async () => {
    const file = `${DIR}/plain-main.less`;
    expect(await renderTree2File(file)).toBe(await renderImportOracle(file));
  });

  it('once (default dedup): a repeated import of the same file emits once', async () => {
    const file = `${DIR}/once-main.less`;
    expect(await renderTree2File(file)).toBe(await renderImportOracle(file));
  });

  it('(reference): unused rulesets suppressed; referenced mixin + var still resolve', async () => {
    const file = `${DIR}/ref-main.less`;
    const t2css = await renderTree2File(file);
    expect(t2css).toBe(await renderImportOracle(file));
    // The reference-only ruleset contributes NO output; the mixin it defines is
    // pulled in where called, and its variable crosses the import boundary.
    expect(t2css).not.toContain('unused-ruleset');
    expect(t2css).toContain('from: reference-mixin');
    expect(t2css).toContain('width: 42px');
  });

  it('(specifier): a variable-interpolated path resolves + inlines', async () => {
    const file = `${DIR}/interp-main.less`;
    const t2css = await renderTree2File(file);
    expect(t2css).toBe(await renderImportOracle(file));
    // The `@{theme}.less` path resolved to interp-target.less and inlined.
    expect(t2css).toContain('from: interpolated-import');
  });

  it('(specifier): interpolation vars hoisted from a later plain import resolve', async () => {
    // `@{prefix}-@{suffix}` are defined in a file imported AFTER the interpolated
    // import — Less hoists imported variables into scope, so the path still
    // resolves. Exercises the transitive plain-import variable collection.
    const file = `${DIR}/interp-cross-main.less`;
    const t2css = await renderTree2File(file);
    expect(t2css).toBe(await renderImportOracle(file));
    expect(t2css).toContain('from: interpolated-import');
  });

  it('(inline): raw bytes of the target emitted verbatim', async () => {
    const file = `${DIR}/inline-main.less`;
    expect(await renderTree2File(file)).toBe(await renderImportOracle(file));
  });

  // DEFERRED: a media-query postlude (`@import (inline) "x" (min-width:…)`) wraps
  // the raw splice in an `@media` block; that needs the postlude query serialized
  // as an at-rule prelude, so the bridge still rejects `import:inline-media` (the
  // census counts it; no mis-emit). Un-skip once the postlude wrap lands.
  it.skip('(inline media): raw bytes wrapped in @media (postlude)', async () => {
    const file = `${DIR}/inline-media-main.less`;
    expect(await renderTree2File(file)).toBe(await renderImportOracle(file));
  });
});
