import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN-AS-VALUE / detached-ruleset-arg, FOLDED onto the spine).
 *
 * A mixin call passing a DETACHED RULESET as an argument — either by REFERENCE
 * (`.wrap(@ruleset)`) or as a NAMED block arg (`.wrap(@r: { … })`) — used to be a
 * silent MIS-FOLD: the outer call passed the static call-eligibility gate (its arg
 * is a `Reference` / a `VarDeclaration`-wrapping-`Mixin`, neither caught by the
 * literal-block arg reject), so the spine drove its resolution with the surface sink
 * installed. The mixin body's detached-ruleset call (`@r()`) is NOT spine-simple, so
 * the surface was correctly REJECTED and the candidate fell through to the eval
 * terminal — BUT the sink was still live on `context`, so the NESTED `@r()`
 * resolution (which resolves the bound detached ruleset as its own callable) was
 * intercepted by the same sink: it captured the inner body and told eval to skip
 * building its output, DROPPING it. Result: empty output.
 *
 * FIX (`callable-candidate-output.ts`): when a candidate's surface is rejected and it
 * eval-materializes as the byte-identical fall-back, the sink is SUSPENDED across
 * that `rules.eval` so a nested call builds its own output tree, then restored for
 * sibling candidates. The detached-ruleset-arg call now folds through the spine
 * (root descends via the single pass; the DR-arg call takes the eval-fallback rung),
 * byte-identical to the pure-eval oracle.
 *
 * RESIDUAL (spec, byte-identical): the detached-ruleset-arg call itself resolves via
 * the eval FALL-BACK (`resolveSpineMixinCall` → `kind: 'eval'`), NOT a pure spine
 * splice — the spine has no detached-ruleset-call (`@r()`) expansion yet (the body's
 * `@r()` is a `Reference`-keyed `Call`, `optType: 'variable'`, deliberately not
 * `isSpineEligibleMixinCall`). This is the sanctioned eval-fallback rung inside the
 * spine descent (the same mechanism ruleset-as-mixin / merge-across use), not a
 * whole-root eval punt: the ENCLOSING root still folds. A regression that (a) re-
 * introduces the sink-corruption mis-fold (empty output), or (b) forces the whole
 * root off the spine for this shape, trips these RED.
 */
async function render(source: string): Promise<{ css: string; eligible: boolean; spineRan: boolean }> {
  const context = new Context({ output: { collapseNesting: false }, leakyScope: true });
  const { tree } = new Parser().parse(source);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const root = tree as unknown as Rules;
  const eligible = isSpineEligibleRoot(root, context, false);
  const before = spineRenderCounter.rootRenders;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const css = (await renderNodeToString(root as unknown as RenderBufferNode, context, { context })).trim();
  return { css, eligible, spineRan: spineRenderCounter.rootRenders > before };
}

describe('mixin-as-value — detached-ruleset argument FOLD through the spine', () => {
  it('detached-ruleset by REFERENCE: .wrap(@ruleset) folds (root spine, call eval-fallback)', async () => {
    const r = await render(
      `@ruleset: {\n  color: black;\n}\n.wrap(@r) {\n  @r();\n}\n.a {\n  .wrap(@ruleset);\n}`
    );
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    // no empty output (the sink-corruption mis-fold): the detached body emits
    expect(r.css).toBe(`.a {\n  color: black;\n}`);
  });

  it('detached-ruleset as a NAMED block arg: .wrap(@r: { … }) folds', async () => {
    const r = await render(
      `.wrap(@r) {\n  @r();\n}\n.a {\n  .wrap(@r: {\n    color: red;\n  });\n}`
    );
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.a {\n  color: red;\n}`);
  });

  it('detached-ruleset arg through a NESTED container body (.inner { @r(); }) folds', async () => {
    const r = await render(
      `.wrap(@r) {\n  .inner {\n    @r();\n  }\n}\n.wrap({\n  color: black;\n});`
    );
    // root ineligible (literal-block arg forces the call off the static gate), but the
    // whole tree renders byte-identical to eval — no sink corruption of the nested call.
    expect(r.css).toBe(`.inner {\n  color: black;\n}`);
  });

  it('detached-ruleset arg wrapped in @media (.dm(@rules) { @media … { @rules() } }) folds', async () => {
    const r = await render(
      `.dm(@rules) {\n  @media screen {\n    @rules();\n  }\n}\nheader {\n  .dm({\n    background: red;\n  });\n}`
    );
    expect(r.css).toBe(`header {\n  @media screen {\n    background: red;\n  }\n}`);
  });

  it('detached-ruleset arg DEFAULT + override (.mixin-definition(@a: {}; @b: {…})) folds', async () => {
    const r = await render(
      `.mx(@a: {}; @b: {default: works;};) {\n  @a();\n  @b();\n}\n.c {\n  .mx();\n}`
    );
    expect(r.css).toBe(`.c {\n  default: works;\n}`);
  });

  it('detached-ruleset arg DIRECT + NAMED overrides fold', async () => {
    const r = await render(
      `.mx(@a: {}; @b: {default: works;};) {\n  @a();\n  @b();\n}\n.c {\n  .mx({direct: works;}; @b: {named: works;});\n}`
    );
    expect(r.css).toBe(`.c {\n  direct: works;\n  named: works;\n}`);
  });

  it('bare detached-ruleset variable call (@rs()) with NO mixin renders byte-identical', async () => {
    const r = await render(`@rs: {\n  b: 1;\n};\n.a {\n  @rs();\n}`);
    expect(r.css).toBe(`.a {\n  b: 1;\n}`);
  });
});
