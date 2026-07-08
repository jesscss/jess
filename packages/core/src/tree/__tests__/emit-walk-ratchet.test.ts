import { beforeEach, describe, expect, it } from 'vitest';
import { rules, decl, spaced, el, vardecl, ref } from '../index.js';
import { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import { spineRenderCounter, isSpineEligibleRoot } from '../util/emit-walk.js';

/**
 * RATCHET (metric axis (b): pass count 3→1). These tests LOCK the wire-in gain:
 * a spine-eligible root renders through the SINGLE downward pass — no `eval`
 * call on the root, no `state.output` tree, no separate serialize walk. A later
 * change that re-introduces the eval pass on this path (or stops routing to the
 * spine) trips these RED.
 */
describe('emit-walk wire-in ratchet (P1)', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  const spyEval = (root: Rules) => {
    // Shadow the instance's `eval` with an own property so `this.eval(...)` in
    // render() hits the counter; no prototype mutation, no unsafe assertion.
    const original = root.eval.bind(root);
    let rootEvalCalls = 0;
    root.eval = ((...args: Parameters<Rules['eval']>) => {
      rootEvalCalls++;
      return original(...args);
    }) as Rules['eval'];
    return {
      restore: () => {
        delete (root as { eval?: Rules['eval'] }).eval;
      },
      calls: () => rootEvalCalls
    };
  };

  it('routes a leaf-only root through the single pass — spine counter moves', () => {
    const root = rules([
      decl({ name: 'color', value: spaced([el('red')]) }),
      decl({ name: 'margin', value: spaced([el('0')]) })
    ]);
    expect(isSpineEligibleRoot(root, context)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const css = root.render(context) as string;
    const after = spineRenderCounter.rootRenders;

    expect(after).toBe(before + 1); // the wired single pass ran
    expect(css).toContain('color: red');
    expect(css).toContain('margin: 0');
  });

  it('does NOT call the root eval() on the wired path (two-walk eliminated)', () => {
    const root = rules([
      vardecl({ name: 'w', value: spaced([el('10px')]) }),
      decl({ name: 'width', value: ref({ key: 'w' }, { type: 'variable' }) })
    ]);
    expect(isSpineEligibleRoot(root, context)).toBe(true);

    const evalSpy = spyEval(root);
    try {
      const css = root.render(context) as string;
      // The dynamic leaf resolved against the live frame in the SINGLE pass...
      expect(css).toContain('width: 10px');
      // ...and the separate eval pass over the root was NOT invoked.
      expect(evalSpy.calls()).toBe(0);
    } finally {
      evalSpy.restore();
    }
  });

  it('a root with a nested container is NOT yet spine-eligible (routes to old path)', () => {
    // Nested-container descent is the next push — until then such a root uses
    // the eval path. This asserts the eligibility boundary so the wire-in does
    // not silently claim shapes it does not yet fully handle.
    const root = rules([
      rules([decl({ name: 'color', value: spaced([el('red')]) })])
    ]);
    expect(isSpineEligibleRoot(root, context)).toBe(false);
  });
});
