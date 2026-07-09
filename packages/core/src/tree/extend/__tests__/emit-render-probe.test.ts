/**
 * emit-render-probe.test.ts — pins the EXISTING-ENGINE BUG that EMIT fixes.
 * =========================================================================
 *
 * The current render pipeline (`processExtends` + the `ownSelector`/`analyzeNonPartialExtends`
 * cascade) emits a NESTED extender's BARE OWN FRAGMENT (`.sidebar3`) into the extended subject's
 * Or-set, where the ratified v5 alpha `.css` requires the COMPOSED form (`.type1 .sidebar3`). This
 * test renders `extend-nest` through the live engine and asserts the buggy shape it produces TODAY,
 * next to EMIT's correct composed shape — so the fix EMIT lands is documented and regression-pinned.
 *
 * When the eventual wire-in routes extend through EMIT, this expectation FLIPS to the composed form
 * (and this probe is retired). It exists now purely as evidence the bug is real and EMIT closes it.
 */
import { describe, it, expect } from 'vitest';
import { Parser } from '../../../../../less-parser/src/index.js';
import { Context } from '../../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../../util/render-buffer.js';
import { el, compound } from '../../index.js';
import { projectSubject, emitSubjectHeader } from '../emit.js';

async function render(src: string, collapseNesting: boolean): Promise<string> {
  const context = new Context({ output: { collapseNesting }, leakyRules: true });
  const parser = new Parser();
  const { tree } = parser.parse(src);
  // Force the EVAL path (identity `preSerializeRoot`): this probe pins the EVAL-engine bug for
  // the shapes the spine does NOT yet route (this fixture's `&.sidebar4` nested-amp extender +
  // `.box` nesting exceed the P3 increment-2 gate, so it stays on eval — where the bare-fragment
  // bug persists). The spine's FIX for the simpler nested shape is proven separately (the
  // jess spine-extend ratchet + the EMIT unit test below).
  return await renderNodeToString(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    tree as unknown as RenderBufferNode,
    context,
    { context, preSerializeRoot: r => r }
  );
}

const EXTEND_NEST = `
.sidebar { width: 300px; background: red; .box { background: #FFF; } }
.sidebar2 { &:extend(.sidebar all); background: blue; }
.type1 { .sidebar3 { &:extend(.sidebar all); background: green; } }
.type2 { &.sidebar4 { &:extend(.sidebar all); background: red; } }
`;

describe('EMIT fixes the current-engine nested-extender bug (extend-nest)', () => {
  it('the EVAL engine still emits the BARE fragment .sidebar3 (bug persists on the eval path)', async () => {
    // The eval-path render (forced above) still exhibits the nested-extender bug: `.sidebar3`
    // bare, NOT the composed `.type1 .sidebar3`. The SPINE fixes this for the simpler nested
    // shape (proven by the jess `spine-extend` ratchet); this fixture stays on eval (its
    // `&.sidebar4` nested-amp extender exceeds the P3 increment-2 gate), so the bug persists here.
    const out = await render(EXTEND_NEST, true);
    const header = out.slice(0, out.indexOf('{')).replace(/\s+/g, ' ').trim();
    expect(header).toBe('.sidebar, .sidebar2, .sidebar3, .type2.sidebar4');
    // Confirm the composed form is ABSENT from the extended subject's header (the defect).
    expect(header).not.toContain('.type1 .sidebar3');
  });

  it('EMIT produces the ratified composed form .type1 .sidebar3', () => {
    const proj = projectSubject({
      path: [el('.sidebar')],
      order: 0,
      contributions: [
        { path: [el('.sidebar2')], order: 1 },
        { path: [el('.type1'), el('.sidebar3')], order: 2 },
        { path: [compound([el('.type2'), el('.sidebar4')])], order: 3 }
      ]
    });
    // The correct v5 shape (extend-nest.css:1-4) — the composed `.type1 .sidebar3`, not the bare one.
    expect(emitSubjectHeader(proj)).toBe('.sidebar,.sidebar2,.type1 .sidebar3,.type2.sidebar4');
  });
});
