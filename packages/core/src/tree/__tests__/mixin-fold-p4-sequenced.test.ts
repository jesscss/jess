import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN #3/#5 — SEQUENCED to the P4 terminal/sink rework). Two
 * ruleset-as-mixin shapes render CORRECTLY today via the eval path but are NOT yet
 * a pure spine fold; they are kept on eval until the P4-era rework routes Ruleset
 * candidates through `context.spineMixinSurfaceSink`. This ratchet locks that they
 * STAY on eval (and stay byte-correct) so a premature/partial fold trips RED.
 *
 * P4 SPEC (why these need the terminal rework, captured for the P4 batch):
 *   - A Ruleset candidate (ruleset-as-mixin) is ALWAYS handled by
 *     `evaluateCallableSpecialCaseCandidate` (`callable-special-case.ts`), which
 *     eval-materializes it and returns `{handled:true}` — it NEVER reaches
 *     `evaluateCallableCandidateOutput`, so `context.spineMixinSurfaceSink` is never
 *     consulted for it (a lone ruleset-as-mixin resolves as `kind:'eval'`, zero sink
 *     calls). Genuine folding needs the special-case terminal to consult the sink for
 *     a plain (unguarded) Ruleset candidate — a change to KEPT callable machinery
 *     shared with the eval path.
 *   - MIXED match (`.foo{}` + `.foo(){}` both matched by `.foo()`): the mixin
 *     candidate is captured by the sink, the ruleset candidate goes through the
 *     special-case eval-output path, and `resolveSpineMixinCall.finish` DISCARDS the
 *     eval output whenever `captured` is non-empty — dropping the ruleset's
 *     contribution. The fix (route the ruleset candidate through the sink too, then
 *     the existing document-order sort in `finish` assembles both) rides the same
 *     special-case-terminal rework. It joins recursion + extend-#4a as the P4-era
 *     architectural pieces.
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

describe('mixin #3/#5 — ruleset-as-mixin + mixed-match SEQUENCED to eval (P4)', () => {
  it('#5: MIXED match (mixin + same-named ruleset) stays on eval and renders both', async () => {
    const r = await render(`.foo { color: red; }\n.foo() { width: 1px; }\n.a { .foo(); }`);
    expect(r.eligible).toBe(false);
    expect(r.spineRan).toBe(false);
    // eval assembles BOTH contributions in document order at the call site
    expect(r.css).toContain('color: red');
    expect(r.css).toContain('width: 1px');
    // and the ruleset also emits standalone
    expect(r.css).toContain('.foo {\n  color: red;\n}');
  });

  it('#5: mixed match with the ruleset defined FIRST preserves document order on eval', async () => {
    const r = await render(`.foo() { width: 1px; }\n.foo { color: red; }\n.a { .foo(); }`);
    expect(r.eligible).toBe(false);
    expect(r.spineRan).toBe(false);
    expect(r.css).toContain('width: 1px');
    expect(r.css).toContain('color: red');
  });
});
