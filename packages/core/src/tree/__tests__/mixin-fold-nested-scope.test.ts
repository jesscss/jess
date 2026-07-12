import { beforeEach, describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN fold #1): namespace-path calls and nested mixins closing
 * over ROOT vars / their own params fold through the single spine pass. The one
 * deferred shape — a nested mixin closing over an INTERMEDIATE (non-root) scope's
 * local var — stays on the eval path (narrow gate), byte-identical. A change that
 * re-broadens the gate (drops the fold) or narrows it unsafely trips these.
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

describe('mixin fold #1 — namespace-path + nested-mixin root/param closure', () => {
  it('namespace-path #ns.member(arg) folds through the spine', async () => {
    const r = await render(`#ns { .add(@x) { width: @x; } }\n.a { #ns.add(3px); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.a {\n  width: 3px;\n}`);
  });

  it('multi-level namespace #a > #b > .m() folds', async () => {
    const r = await render(`#a { #b { .m() { color: red; } } }\n.consumer { #a > #b > .m(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.consumer {\n  color: red;\n}`);
  });

  it('nested mixin closing over ROOT var folds', async () => {
    const r = await render(`@base: blue;\n.outer { .inner() { color: @base; } }\n.consumer { .outer.inner(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.consumer {\n  color: blue;\n}`);
  });

  it('nested mixin with param + root closure var folds', async () => {
    const r = await render(`@base: 2;\n.ns { .scale(@f) { width: (@base * @f * 1px); } }\n.a { .ns.scale(3); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.a {\n  width: 6px;\n}`);
  });

  it('call BEFORE the definition scope in document order folds', async () => {
    const r = await render(`.consumer { .lib.m(); }\n.lib { .m() { color: green; } }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.consumer {\n  color: green;\n}`);
  });

  // Fold #6 (intermediate-scope closure) — these previously stayed on eval; the
  // definition-scope `.parent` wiring at pass entry + the surface-frame re-parent
  // now fold them byte-identical.
  it('#6: nested mixin closing over an INTERMEDIATE-scope local var folds', async () => {
    const r = await render(`.util { @local: red; .paint() { color: @local; } }\n.consumer { .util.paint(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.consumer {\n  color: red;\n}`);
  });

  it('#6: var-shadowing across an intermediate scope reads the DEFINITION binding', async () => {
    const r = await render(`@c: outer;\n.box { @c: inner; .tint() { content: "@{c}"; } }\n.a { .box.tint(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.a {\n  content: "inner";\n}`);
  });

  it('#6: three-level shadowing reads the innermost definition binding', async () => {
    const r = await render(`@x: 1;\n.mid { @x: 2; .inner { @x: 3; .m() { width: @x; } } }\n.a { .mid.inner.m(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.a {\n  width: 3;\n}`);
  });

  it('#6: intermediate mixin PARAM closure folds (nested body reads enclosing mixin param)', async () => {
    const r = await render(`.outer(@v) { .inner() { color: @v; } .inner(); }\n.a { .outer(teal); }`);
    // .outer has a nested-call body (SEQUENCE) → whole tree stays on eval, but must
    // still render correctly; this guards that #6 wiring does not corrupt it.
    expect(r.css).toContain('color: teal');
  });
});
