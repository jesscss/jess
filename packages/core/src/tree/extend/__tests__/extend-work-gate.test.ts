import { beforeEach, describe, expect, it } from 'vitest';
import { rules, decl, spaced, el, vardecl, ref, ruleset, sel } from '../../index.js';
import { Context } from '../../../context.js';
import { isSpineEligibleRoot, spineRenderCounter } from '../../util/emit-walk.js';
import {
  engageExtendLayer,
  treeHasExtend,
  extendLayerCounter,
  resetExtendLayerCounter,
  isSpineExtendTopology
} from '../spine-extend.js';
import { Ruleset } from '../../ruleset.js';
import { F_EXTENDED } from '../../node.js';
import { Parser } from '../../../../../less-parser/src/index.js';
import type { Rules } from '../../rules.js';

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

/**
 * CASE 3 gate exclusion — the `&`-under-multi-branch-list wall (amp-test `&+&`).
 *
 * The gather's pure-structural `&`-resolution (`local.eval` + `normalizeResolvedAmpersand`) does NOT
 * reproduce the serialize-time `:is(...)`-graft that a MULTI-BRANCH (`.amp-test-a, .amp-test-b`)
 * `&`-parent requires — it distributes the list raw into the compound and leaves literal `&`s
 * (verified 2026-07-09). So an `&`-bearing local BENEATH a multi-branch-list ancestor must stay on the
 * eval path (the working oracle). These lock the gate exclusion so the spine never silently drops such
 * an extend. A SINGLE-branch `&`-parent (`.type2.sidebar4 { &:extend }`) is still ADMITTED.
 */
describe('spine extend gate — `&`-under-multi-branch-list exclusion (CASE 3 wall)', () => {
  const gateOf = (src: string): boolean => {
    const { tree } = new Parser().parse(src);
    return isSpineExtendTopology(tree as unknown as Rules, true);
  };

  it('EXCLUDES an `&`-combinator extender under a multi-branch (OR) parent (amp-test `&+&`)', () => {
    const src = `
.amp-test-a,
.amp-test-b {
  .amp-test-c &.amp-test-d&.amp-test-e {
    .amp-test-f&+&.amp-test-g:extend(.amp-test-h) {}
  }
}
.amp-test-h { test: x; }
`;
    expect(gateOf(src)).toBe(false);
  });

  it('EXCLUDES a plain `&` local under a multi-branch (OR) parent', () => {
    const src = `.a, .b { &.mod { .c:extend(.ext all) {} } }\n.ext { t: 1; }`;
    expect(gateOf(src)).toBe(false);
  });

  it('still ADMITS a single-branch `&` extender (`.type2.sidebar4 { &:extend }`)', () => {
    const src = `.sidebar { w: 1; }\n.type2.sidebar4 { &:extend(.sidebar all); }`;
    expect(gateOf(src)).toBe(true);
  });
});
