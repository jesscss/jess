import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN fold #3): a LONE ruleset-as-mixin match (`.foo` used as
 * `.foo()`) folds through the spine — the ruleset's declarations are contributed at
 * the call site AND the ruleset emits standalone. The MIXED case (a same-named Mixin
 * AND ruleset both matching one call — #5) stays off the spine.
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

describe('mixin fold #3 — ruleset-as-mixin (lone match)', () => {
  it('folds a lone ruleset used as a mixin (standalone + call-site contribution)', async () => {
    const r = await render(`.foo { color: red; }\n.a { .foo(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.foo {\n  color: red;\n}\n.a {\n  color: red;\n}`);
  });

  it('folds a lone ruleset-as-mixin with multiple declarations', async () => {
    const r = await render(`.box { color: red; width: 1px; }\n.a { .box(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.box {\n  color: red;\n  width: 1px;\n}\n.a {\n  color: red;\n  width: 1px;\n}`);
  });

  it('DEFERRED (#5): mixed match (mixin + same-named ruleset) stays on eval', async () => {
    const r = await render(`.foo { color: red; }\n.foo() { width: 1px; }\n.a { .foo(); }`);
    expect(r.eligible).toBe(false);
    expect(r.spineRan).toBe(false);
    // eval renders both contributions
    expect(r.css).toContain('color: red');
    expect(r.css).toContain('width: 1px');
  });
});
