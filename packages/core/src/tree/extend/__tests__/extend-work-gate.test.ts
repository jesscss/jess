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
 * CASE 3 — `&`-under-multi-branch-list is now ADMITTED (the wall is solved).
 *
 * The gather resolves an `&`-bearing local by the EAGER STATIC `Ruleset.composeSelector`-reduce over
 * its ancestor path (a pure function of selector nodes: `_substituteAmpInComplex`/`_substituteAmpInCompound`
 * wrap a multi-branch `SelectorList` parent as `:is(...)` with no eval/frames), after propagating
 * `F_AMPERSAND` up the container chain. So the amp-test `&+&` under `.amp-test-a, .amp-test-b` folds to
 * the ratified `:is`-graft and is ADMITTED (was gate-excluded). An `&`-APPEND local (`&-modifier`) still
 * DISQUALIFIES — `composeSelector` does not build the anonymous-suffix append.
 */
describe('spine extend gate — `&`-under-multi-branch-list now ADMITTED (CASE 3 solved)', () => {
  const gateOf = (src: string): boolean => {
    const { tree } = new Parser().parse(src);
    return isSpineExtendTopology(tree, true);
  };

  it('ADMITS an `&`-combinator extender under a multi-branch (OR) parent (amp-test `&+&`)', () => {
    const src = `
.amp-test-a,
.amp-test-b {
  .amp-test-c &.amp-test-d&.amp-test-e {
    .amp-test-f&+&.amp-test-g:extend(.amp-test-h) {}
  }
}
.amp-test-h { test: x; }
`;
    expect(gateOf(src)).toBe(true);
  });

  it('ADMITS a single-branch `&` extender (`.type2.sidebar4 { &:extend }`)', () => {
    const src = `.sidebar { w: 1; }\n.type2.sidebar4 { &:extend(.sidebar all); }`;
    expect(gateOf(src)).toBe(true);
  });
  // (The `&`-APPEND `&-mod` exclusion — composeSelector cannot build the anonymous suffix — is
  // ratcheted in emit-walk-ratchet.test.ts via the `amp('-mod')` AST builder.)
});

/**
 * Q-40 REJECTION LOCK — the canonical imported/reference root still has a real post-wire blocker.
 *
 * `benchmark.less` contains the same shape: a root selector list with an `h1` branch, then a nested
 * `.prose h1:extend(h1)` shadow. The synchronous import gate must admit provisionally so imports can
 * resolve, but the strict post-wire gate must reject the shape: treating `h1` as the root branch
 * would rewrite the wrong subject. A later worker may only relax this with a source-order/reference
 * proof and exact canonical output; this test prevents silently reopening the rejected zero-proof cut.
 */
describe('spine extend gate — imported/reference partial admission remains rejected', () => {
  it('rejects the resolved h1 shadow while preserving speculative import admission', () => {
    const src = `
@import "benchmark-import-target.less";
@import (reference) "benchmark-import-reference-target.less";
h1, h2 > a > p, h3 { color: red; }
.prose { h1:extend(h1) {} }
.typography-base { line-height: 1.6; }
.heading-base:extend(.typography-base) { font-weight: bold; }
h1:extend(.heading-base) { font-size: 2.5em; }
`;
    const { tree } = new Parser().parse(src);
    const importedRootSubjects = new Set(['.ref-button', '.ref-alert', '.ref-grid-system']);

    expect(isSpineExtendTopology(tree, true, { speculativeImport: true })).toBe(true);
    expect(isSpineExtendTopology(tree, true, { importedRootSubjects })).toBe(false);
  });
});
