import { beforeEach, describe, expect, it } from 'vitest';
import { rules, ruleset, decl, sel, el, spaced, vardecl, ref } from '../index.js';
import { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import { getPrintOptions, OutputWriter, type FinalPrintOptions } from '../util/print.js';
import { withValueFrame, emitLeaf, emitSharedBody, pushBoundBodyFrame } from '../util/emit-walk.js';
import type { BindingCell } from '../scope-frame.js';

/**
 * P1 spine proof — the frame-threading single-pass emit (UNIFIED-EVAL-EMIT §2).
 *
 * These tests exercise the NEW emit path directly: descend the SOURCE tree with
 * the live value-frame threaded through `context.rulesContext`, resolve each
 * leaf against that frame at its emit moment, and write bytes. There is no
 * materialized output tree — the resolved leaf is transient and dropped after
 * its bytes are written.
 */
describe('emit-walk spine (P1)', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  const freshOptions = (): FinalPrintOptions => {
    const options = getPrintOptions({ context, writer: new OutputWriter(false) });
    options.context = context;
    return options;
  };

  /**
   * Seed the value-frame for a hand-built Rules: make its scope frame live and
   * point the context at it, mirroring what `_setupContextForRules` does on the
   * eval descent. This is the value-frame PUSH the spine performs at scope-enter.
   */
  const seedFrame = (body: Rules): void => {
    context.rulesContext = body;

    // Force the scope frame to be built so name lookups resolve against it.
    body.getScopeFrame();
  };

  it('resolves and emits a STATIC leaf with no output tree', () => {
    const body = rules([
      decl({ name: 'color', value: spaced([el('red')]) })
    ]);
    seedFrame(body);
    const options = freshOptions();

    const leaf = body.rules[0]!;
    emitLeaf(leaf, context, options);

    expect(options.writer!.toString()).toContain('color: red');
  });

  it('resolves a DYNAMIC leaf (width: @w) against the live value-frame at emit moment', () => {
    const body = rules([
      vardecl({ name: 'w', value: spaced([el('10px')]) }),
      decl({ name: 'width', value: ref({ key: 'w' }, { type: 'variable' }) })
    ]);
    seedFrame(body);
    const options = freshOptions();

    /*
     * The dynamic leaf is the second child; it resolves @w THROUGH the frame
     * pushed via context.rulesContext — exactly the frame eval would use.
     */
    const dynamicLeaf = body.rules[1]!;
    withValueFrame(context, body, () => emitLeaf(dynamicLeaf, context, options));

    expect(options.writer!.toString()).toContain('width: 10px');
  });

  it('emits a SHARED body reused twice under DIFFERENT frames → different bytes, no copy', () => {
    /*
     * The shared body references @w; each placement binds a different @w as a
     * LIVE CELL in its own pushed value-frame. The SAME source children emit
     * different bytes purely from the pushed frame (the mixin/loop shared-body
     * mechanism, design §2.2 / §3). This is `createIterationEvalSurface`-shaped:
     * one shared body, a fresh frame per placement.
     */
    const sharedBody = rules([
      decl({ name: 'width', value: ref({ key: 'w' }, { type: 'variable' }) })
    ]);
    const sharedLeaf = sharedBody.rules[0]!;

    const bind = (text: string): Map<string, BindingCell> => {
      const cell: BindingCell = { value: spaced([el(text)]) };
      return new Map<string, BindingCell>([['w', cell]]);
    };

    const emitUnder = (widthText: string): { out: string; leaf: unknown } => {
      // Fresh context per placement mirrors real per-call resolution isolation.
      const placementContext = new Context();
      const options = getPrintOptions({ context: placementContext, writer: new OutputWriter(false) });
      options.context = placementContext;
      const surface = pushBoundBodyFrame(sharedBody, bind(widthText), undefined);
      emitSharedBody(surface, surface, placementContext, options);
      return { out: options.writer!.toString(), leaf: surface.rules[0] };
    };

    const a = emitUnder('10px');
    const b = emitUnder('20px');

    expect(a.out).toContain('width: 10px');
    expect(b.out).toContain('width: 20px');

    /*
     * The surface SHARES the source leaf node identity across both placements —
     * proving per-placement difference lives in the pushed frame, not a copy.
     */
    expect(a.leaf).toBe(sharedLeaf);
    expect(b.leaf).toBe(sharedLeaf);
  });

  it('restores the value-frame on exit (push/pop discipline)', () => {
    const outer = rules([decl({ name: 'a', value: spaced([el('1')]) })]);
    const inner = rules([decl({ name: 'b', value: spaced([el('2')]) })]);
    context.rulesContext = outer;

    withValueFrame(context, inner, () => {
      expect(context.rulesContext).toBe(inner);
    });

    expect(context.rulesContext).toBe(outer);
  });
});
