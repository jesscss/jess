import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN SEQUENCE item — recursion / nested-call-in-body, FOLD C).
 * FOLD C makes the fold splice RE-ENTRANT (`runSpineMixinExpansion` re-scans a folded
 * surface's OWN spliced children from `i`, pushing each entry's `spineFrame` around the
 * resolve), so a NON-recursive nested call in a mixin body — a wrapper
 * `.wrapper(@c){ .base(@c) }`, a chain `.a(){ .b() }`, incl. frame-dependent args —
 * FOLDS through the spine byte-identical. `callMap` terminates genuine recursion.
 *
 * FLAT RECURSION now FOLDS (the frame-threaded arg-binding rung, §7): a self / mutual
 * name-cycle whose body is declarations + the recursive call with a frame-dependent
 * ARG (`.loop((@n - 1))`) folds byte-identical — each level's freshly-bound param frame
 * is threaded through the recursive call's arg-binding eval AND the spliced body decls'
 * dedup-key + emit resolution. `callMap` bounds the recursion.
 *
 * STRIPE now FOLDS too (distinct-per-level container surfaces): a recursive cycle whose
 * body has a NESTED CONTAINER shared across levels (`.stripe(@n){ a{…} .stripe(@n-1) }`)
 * used to re-use the same canonical container child per level, collapsing two levels'
 * blocks into one (the header-merge keys on node identity). `distinctFoldChild`
 * (`serialize-helper.ts`) now splices a distinct per-level copy on the container's 2nd+
 * occurrence — mirroring the loop fold's per-iteration `copyWithReusableLeaves` — so each
 * level emits its own block, byte-identical to eval / less@4. A change that RE-DEFERS
 * STRIPE, FLAT recursion, or the wrapper to eval — or that RE-COLLAPSES the STRIPE blocks
 * — trips RED.
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

describe('mixin SEQUENCE gate — nested-call-in-body FOLDS (FOLD C); recursion (incl. STRIPE nested-container) folds', () => {
  it('FOLD C: a wrapper mixin calling another mixin (frame-dependent arg) FOLDS through the spine', async () => {
    const r = await render(`.base(@c) { color: @c; }\n.wrapper(@c) { .base(@c); }\n.test { .wrapper(blue); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.test {\n  color: blue;\n}`);
  });

  it('FOLD C: a nested CHAIN .a(){ .b() } (multi-level) folds in document order', async () => {
    const r = await render(`.c() { z: 3; }\n.b() { .c(); y: 2; }\n.a() { .b(); x: 1; }\n.k { .a(); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.k {\n  z: 3;\n  y: 2;\n  x: 1;\n}`);
  });

  it('FOLD (STRIPE): a self-recursive guarded loop with a NESTED CONTAINER folds via distinct-per-level surfaces', async () => {
    // The re-entrant splice used to re-use the SAME canonical `a { … }` child per level,
    // collapsing both levels' blocks into one. `distinctFoldChild` now splices a distinct
    // per-level copy on the container's 2nd+ occurrence, so each level emits its own
    // `.wrap a { … }` block — byte-identical to eval / less@4 (two distinct blocks).
    const r = await render(`.stripe(@n) when (@n > 0) {\n  a { border-width: @n; }\n  .stripe(@n - 1);\n}\n.wrap { .stripe(2); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    // collapseNesting:false → the expanded nested form, two DISTINCT `a` blocks
    expect(r.css).toBe(`.wrap {\n  a {\n    border-width: 2;\n  }\n  a {\n    border-width: 1;\n  }\n}`);
  });

  it('FOLD (§7 frame-threaded arg rung): a FLAT self-recursive loop (frame-dependent arg) FOLDS through the spine, byte-identical', async () => {
    const r = await render(`.loop(@n) when (@n > 0) { m: @n; .loop((@n - 1)); }\n.x { .loop(3); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.x {\n  m: 3;\n  m: 2;\n  m: 1;\n}`);
  });

  it('FOLD (§7): FLAT MUTUAL recursion (ping↔pong, frame-dependent arg) FOLDS byte-identical', async () => {
    const r = await render(`.ping(@n) when (@n > 0) { p: @n; .pong((@n - 1)); }\n.pong(@n) when (@n > 0) { q: @n; .ping((@n - 1)); }\n.x { .ping(2); }`);
    expect(r.eligible).toBe(true);
    expect(r.spineRan).toBe(true);
    expect(r.css).toBe(`.x {\n  p: 2;\n  q: 1;\n}`);
  });
});
