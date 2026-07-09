import { beforeEach, describe, expect, it } from 'vitest';
import { rules, decl, spaced, el, vardecl, ref, ruleset, sel } from '../../index.js';
import { Context } from '../../../context.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../../util/emit-walk.js';
import {
  engageExtendLayer,
  treeHasExtend,
  extendLayerCounter,
  resetExtendLayerCounter
} from '../spine-extend.js';
import { Ruleset } from '../../ruleset.js';
import { F_EXTENDED } from '../../node.js';

/**
 * RATCHET — the EXTEND-WORK GATE (§4.0), the zero-regression safety floor for P3.
 *
 * These tests LOCK the fast-path invariant: a render whose tree carries NO `:extend`
 * performs ZERO extend-layer work — no PLAN, no SOLVE, no per-subject header buffering —
 * and stays byte-identical to the pure streaming spine. As later increments wire PLAN /
 * SOLVE / buffering, each bumps its `extendLayerCounter` through `spine-extend.ts`, so a
 * change that starts paying extend cost on the extend-free fast path trips these RED.
 *
 * @see UNIFIED-EVAL-EMIT-DESIGN.md §4.0
 * @see CUTOVER-CHECKLIST.md P3 — "Extend-work gate (§4.0) — the fast path"
 */
describe('extend-work gate (P3 increment 0)', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
    resetExtendLayerCounter();
  });

  it('gate is CLOSED (no extend layer) for an extend-free leaf-only root', () => {
    const root = rules([
      decl({ name: 'color', value: spaced([el('red')]) }),
      decl({ name: 'margin', value: spaced([el('0')]) })
    ]);
    expect(engageExtendLayer(root)).toBe(false);
    expect(treeHasExtend(root)).toBe(false);
  });

  it('gate is CLOSED for an extend-free NESTED-ruleset root', () => {
    const root = rules([
      vardecl({ name: 'w', value: spaced([el('10px')]) }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [
          decl({ name: 'width', value: ref({ key: 'w' }, { type: 'variable' }) }),
          ruleset({ selector: sel([el('.b')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
        ]
      })
    ]);
    expect(engageExtendLayer(root)).toBe(false);
  });

  it('gate is OPEN when a ruleset carries an F_EXTENDED selector, at any depth', () => {
    const extender = sel([el('.b')]);
    extender.addFlag(F_EXTENDED);
    expect(Ruleset.hasExtendedTopLevelSelector(extender)).toBe(true);

    const root = rules([
      ruleset({
        selector: sel([el('.a')]),
        rules: [ruleset({ selector: extender, rules: [decl({ name: 'color', value: spaced([el('red')]) })] })]
      })
    ]);
    expect(treeHasExtend(root)).toBe(true);
    expect(engageExtendLayer(root)).toBe(true);
  });

  it('ZERO extend-layer work counted across an extend-free spine render', () => {
    const root = rules([
      vardecl({ name: 'w', value: spaced([el('10px')]) }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [decl({ name: 'width', value: ref({ key: 'w' }, { type: 'variable' }) })]
      })
    ]);
    // Precondition: this IS the wired spine path.
    expect(isSpineEligibleRoot(root, context)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const css = root.render(context) as string;

    // The single pass ran...
    expect(spineRenderCounter.rootRenders).toBe(before + 1);
    // ...streaming byte-identically (dynamic leaf resolved live)...
    expect(css).toContain('.a');
    expect(css).toContain('width: 10px');
    // ...and NO extend-layer work was performed: the fast path pays nothing.
    expect(extendLayerCounter.planRuns).toBe(0);
    expect(extendLayerCounter.solveRuns).toBe(0);
    expect(extendLayerCounter.subjectBuffers).toBe(0);
  });
});
