import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN fold #4): a `!important` mixin call (`.m() !important`)
 * folds through the spine — the KEPT `Call.makeImportant` derives every folded
 * declaration with the `!important` flag, byte-identical to the eval path.
 */
async function render(source: string, spine: boolean): Promise<{ css: string; eligible: boolean; spineRan: boolean }> {
  const context = new Context({ output: { collapseNesting: false }, leakyScope: true });
  const { tree } = new Parser().parse(source);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const root = tree as unknown as Rules;
  const eligible = isSpineEligibleRoot(root, context, false);
  const before = spineRenderCounter.rootRenders;
  const options = spine ? { context } : { context, preSerializeRoot: (r: Rules): Rules => r };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const css = (await renderNodeToString(root as unknown as RenderBufferNode, context, options)).trim();
  return { css, eligible, spineRan: spineRenderCounter.rootRenders > before };
}

describe('mixin fold #4 — !important on a mixin call', () => {
  it('marks every folded declaration important, byte-identical to eval', async () => {
    const src = `.m() { color: red; width: 1px; }\n.a { .m() !important; }`;
    const spine = await render(src, true);
    const evalR = await render(src, false);
    expect(spine.eligible).toBe(true);
    expect(spine.spineRan).toBe(true);
    expect(spine.css).toBe(evalR.css);
    expect(spine.css).toBe(`.a {\n  color: red !important;\n  width: 1px !important;\n}`);
  });

  it('important propagates through a parametric mixin', async () => {
    const src = `.tint(@c) { color: @c; }\n.a { .tint(blue) !important; }`;
    const spine = await render(src, true);
    const evalR = await render(src, false);
    expect(spine.spineRan).toBe(true);
    expect(spine.css).toBe(evalR.css);
    expect(spine.css).toBe(`.a {\n  color: blue !important;\n}`);
  });

  it('a NON-important call is unaffected (no stray !important)', async () => {
    const src = `.m() { color: red; }\n.a { .m(); }`;
    const spine = await render(src, true);
    expect(spine.spineRan).toBe(true);
    expect(spine.css).toBe(`.a {\n  color: red;\n}`);
  });
});
