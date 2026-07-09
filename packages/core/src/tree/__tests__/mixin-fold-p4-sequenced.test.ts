import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN #3/#5 — the P4 TERMINAL/SINK rework, FOLDED). Two
 * ruleset-as-mixin shapes now FOLD through the unified callable sink (they used to
 * render correctly only via the eval path):
 *
 *   - #3 (ruleset-as-mixin): a lone `.foo {}` called `.foo()`. FOLD A routes the
 *     Ruleset candidate through `context.spineMixinSurfaceSink` in the special-case
 *     terminal (`callable-special-case.ts`) BEFORE eval-materializing, so its body
 *     folds inline at the call site AND the ruleset streams standalone. Locked by
 *     `emit-walk-ratchet.test.ts` (FOLD A test).
 *   - #5 (MIXED match): `.foo{}` + `.foo(){}` both matched by `.foo()`. FOLD B: with
 *     the Ruleset candidate captured by the sink (FOLD A) alongside the Mixin
 *     candidate, `resolveSpineMixinCall.finish` assembles BOTH call-site
 *     contributions in source DOCUMENT ORDER (the existing sort — the eval path's
 *     `compareCallableOutputPosition` reproduced). The `treeHasMixinRulesetMixedMatch`
 *     gate is DELETED.
 *
 * This ratchet asserts the FOLD (spine ran, byte-identical to eval, both
 * contributions in document order) so a regression that re-defers these to eval —
 * or drops a contribution — trips RED.
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

describe('mixin #3/#5 — ruleset-as-mixin + mixed-match FOLD through the spine (P4 terminal/sink)', () => {
  it('#5: MIXED match (ruleset FIRST) folds — both contributions in document order', async () => {
    const r = await render(`.foo { color: red; }\n.foo() { width: 1px; }\n.a { .foo(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    // the ruleset ALSO emits standalone
    expect(r.css).toContain('.foo {\n  color: red;\n}');
    // at the call site BOTH contributions assemble in DOCUMENT ORDER:
    // ruleset `.foo` (line 1) before mixin `.foo()` (line 2) → color then width
    expect(r.css).toMatch(/\.a \{\n {2}color: red;\n {2}width: 1px;\n\}/);
    // no raw call syntax leaked
    expect(r.css).not.toContain('.foo(');
  });

  it('#5: MIXED match (mixin FIRST) folds — document order flips to width then color', async () => {
    const r = await render(`.foo() { width: 1px; }\n.foo { color: red; }\n.a { .foo(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toContain('.foo {\n  color: red;\n}');
    // mixin `.foo()` (line 1) before ruleset `.foo` (line 2) → width then color
    expect(r.css).toMatch(/\.a \{\n {2}width: 1px;\n {2}color: red;\n\}/);
    expect(r.css).not.toContain('.foo(');
  });
});
