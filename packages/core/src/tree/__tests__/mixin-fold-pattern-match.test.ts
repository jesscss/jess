import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN fold #2): pattern-match literal-param mixins
 * (`.m(dark) {}` / `.m(light) {}`) fold through the single spine pass. The KEPT
 * `matchCallableParams` selects the literal-matching overload before the fold sink
 * is consulted, exactly as the eval path — so a call folds only the matched body.
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

describe('mixin fold #2 — pattern-match literal params', () => {
  it('selects the matching literal overload through the spine', async () => {
    const r = await render(`.m(dark) { color: black; }\n.m(light) { color: white; }\n.a { .m(dark); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.a {\n  color: black;\n}`);
  });

  it('selects the OTHER literal overload', async () => {
    const r = await render(`.m(dark) { color: black; }\n.m(light) { color: white; }\n.a { .m(light); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.a {\n  color: white;\n}`);
  });

  it('literal-lead param + trailing variable param binds the variable', async () => {
    const r = await render(`.m(dark, @c) { color: @c; }\n.a { .m(dark, red); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.a {\n  color: red;\n}`);
  });
});
