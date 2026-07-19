/**
 * Byte-identity gate for `@import url(<x>.less)` inlining.
 *
 * An UNQUOTED `url(...)` import whose target is NOT a `.css`/remote path is a LESS
 * import in Less — the `url()` wrapper does not force CSS-passthrough; only the
 * extension / `(css)` option / remoteness does. Real Less 4.x therefore INLINES
 * `@import url(import-test-f.less)` (verified with `lessc`), and tree2 must too.
 *
 * These two fixtures cannot be gated by the jess import-census oracle: the real
 * Compiler mis-renders `url(<x>.less)` imports (it wraps the inlined body in a
 * spurious `@media url(<x>.less)` block, and resolves a nested import relative to
 * the wrong directory — "File not found" for `import-test-a` reached via
 * `json/index`). So the oracle here is the real Less 4.x output, captured as a
 * fixed reference (both fixtures render identically under Less 4.x).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { createImportState } from '../import.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

const ROOT = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';

// Real Less 4.x output for `import/import/import-test-a.less` and
// `import/import/json/index.less` (they render identically).
const LESS_4X_REFERENCE = `#import {
  color: red;
}
.mixin {
  height: 10px;
  color: red;
}
body {
  width: 100%;
}
.test-rule-f {
  height: 10px;
}
.deep-import-url {
  color: red;
}
`;

async function renderAst(file: string): Promise<string> {
  const src = fs.readFileSync(file, 'utf8');
  const bridged = bridgeToAst(parseLessFn(src).tree, src, file, createImportState(parseLessFn));
  return (await serialize(bridged, { evaluator: buildEvaluator(makeBuiltinRegistry()) })).css;
}

describe('tree2 @import — url(<x>.less) inlines as Less (byte-identical to Less 4.x)', () => {
  it('import-test-a: url(import-test-f.less) + url("deeper/url-import.less") inline', async () => {
    expect(await renderAst(`${ROOT}/import/import/import-test-a.less`)).toBe(LESS_4X_REFERENCE);
  });

  it('json/index: @import "../import-test-a" resolves nested url imports from the target dir', async () => {
    expect(await renderAst(`${ROOT}/import/import/json/index.less`)).toBe(LESS_4X_REFERENCE);
  });
});
