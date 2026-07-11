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
 * The ONE residual STAYS on eval (byte-identical, gate-locked here): a recursive cycle
 * whose body has a NESTED CONTAINER shared across levels (STRIPE) — the re-entrant
 * splice re-uses the same canonical container child per level, collapsing two levels'
 * blocks. `treeHasRecursiveMixinCall` narrowly detects only that shape. A change that
 * folds STRIPE (before distinct-per-level container surfaces exist) trips RED; a change
 * that RE-DEFERS FLAT recursion or the wrapper to eval also trips RED.
 */
async function render(source: string): Promise<{ css: string; eligible: boolean; spineRan: boolean }> {
  const context = new Context({ output: { collapseNesting: false }, leakyScope: true });
  const { tree } = new Parser().parse(source);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const root = tree as unknown as Rules;
  const eligible = isSpineEligibleRoot(root, context, false);
  const before = spineRenderCounter.rootRenders;
  // D-EVAL FLIP: a spine-eligible root renders on the spine; a non-eligible root
  // (this DEFERRED recursion+nested-container shape stays on eval) renders through
  // the RETAINED eval + serialize path via a no-op `preSerializeRoot` visitor —
  // byte-identical to the pre-flip eval-fallback.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const css = (await renderNodeToString(root as unknown as RenderBufferNode, context, eligible ? { context } : { context, preSerializeRoot: r => r })).trim();
  return { css, eligible, spineRan: spineRenderCounter.rootRenders > before };
}

describe('mixin SEQUENCE gate — nested-call-in-body FOLDS (FOLD C); recursion stays on eval', () => {
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

  it('DEFERRED: a self-recursive guarded loop (recursion + nested container) stays on eval', async () => {
    const r = await render(`.stripe(@n) when (@n > 0) {\n  a { border-width: @n; }\n  .stripe(@n - 1);\n}\n.wrap { .stripe(2); }`);
    expect(r.eligible).toBe(false);
    expect(r.spineRan).toBe(false);
    // eval renders the recursion correctly (byte-identical)
    expect(r.css).toContain('border-width: 2');
    expect(r.css).toContain('border-width: 1');
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
