import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN SEQUENCE item — recursion / nested-call-in-body). This
 * shape is the one genuinely architectural fold (the splice must be made RE-ENTRANT
 * — run the surface expansion on a folded surface's OWN children). Until that lands
 * it MUST stay on the eval path, byte-identical: a mixin whose body itself calls a
 * mixin (a wrapper, or a self-recursive loop) is kept off the spine. Relaxing #1/#2
 * eligibility must not leak this shape onto the spine (it would emit the nested
 * call's raw source). A change that folds it (before the re-entrant splice exists)
 * trips these.
 */
async function render(source: string): Promise<{ css: string; eligible: boolean; spineRan: boolean }> {
  const context = new Context({ output: { collapseNesting: false }, leakyRules: true });
  const { tree } = new Parser().parse(source);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const root = tree as unknown as Rules;
  const eligible = isSpineEligibleRoot(root, context, false);
  const before = spineRenderCounter.rootRenders;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const css = (await renderNodeToString(root as unknown as RenderBufferNode, context, { context })).trim();
  return { css, eligible, spineRan: spineRenderCounter.rootRenders > before };
}

describe('mixin SEQUENCE gate — recursion / nested-call-in-body stays on eval', () => {
  it('wrapper mixin calling another mixin stays on eval (byte-identical)', async () => {
    const r = await render(`.base(@c) { color: @c; }\n.wrapper(@c) { .base(@c); }\n.test { .wrapper(blue); }`);
    expect(r.eligible).toBe(false);
    expect(r.spineRan).toBe(false);
    expect(r.css).toBe(`.test {\n  color: blue;\n}`);
  });

  it('self-recursive guarded loop stays on eval', async () => {
    const r = await render(`.stripe(@n) when (@n > 0) {\n  a { border-width: @n; }\n  .stripe(@n - 1);\n}\n.wrap { .stripe(2); }`);
    expect(r.eligible).toBe(false);
    expect(r.spineRan).toBe(false);
    // eval renders the recursion correctly
    expect(r.css).toContain('border-width: 2');
    expect(r.css).toContain('border-width: 1');
  });
});
