import { beforeEach, describe, expect, it } from 'vitest';
import { rules, decl, spaced, el, vardecl, ref, ruleset, sel, amp, call, list, op, dimension, num, attr, any, atrule } from '../index.js';
import { Context } from '../../context.js';
import { Rules } from '../rules.js';
import { isThenable } from '@jesscss/awaitable-pipe';
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

  it('routes a NESTED-RULESET root through the single pass with live leaf resolution', () => {
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
    expect(isSpineEligibleRoot(root, context)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const css = root.render(context) as string;
    expect(spineRenderCounter.rootRenders).toBe(before + 1);
    // Container descended in place; dynamic @w resolved live under the frame.
    expect(css).toContain('.a');
    expect(css).toContain('width: 10px');
    expect(css).toContain('color: red');
  });

  it('builds NO output tree (Rules.derive not called) on the wired container path', () => {
    // RATCHET (metric axis (b)) — the eval→output-tree materialization is GONE
    // for the wired container path. `Rules.derive` (the copy-on-write output-tree
    // surface builder) must not fire. A later change that re-introduces the
    // output tree on this path trips this RED.
    const root = rules([
      vardecl({ name: 'w', value: spaced([el('10px')]) }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [decl({ name: 'width', value: ref({ key: 'w' }, { type: 'variable' }) })]
      })
    ]);
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = root.render(context) as string;
      expect(css).toContain('width: 10px');
      expect(deriveCalls).toBe(0);
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('eligibility boundary excludes shapes the container spine does not yet fold', () => {
    // These stay on the eval path (a scoped frontier, not a safety fallback).
    // Ampersand composition:
    const ampRoot = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        ruleset({ selector: sel([amp(), el('-mod')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
      ] })
    ]);
    expect(isSpineEligibleRoot(ampRoot, context)).toBe(false);
  });

  it('ADMITS calc()/Operation-valued declarations — resolved sync by default, reactive-bail to async', () => {
    // Pure Operation is fully sync (no speculative await); calc() (a Call) is
    // genuinely async here and takes the async path only because eval actually
    // returns a thenable. Both are eligible — the container serializer threads a
    // promise ONLY when one really surfaces.
    const opRoot = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        decl({ name: 'width', value: op([dimension([10, 'px']), '+', dimension([20, 'px'])]) })
      ] })
    ]);
    expect(isSpineEligibleRoot(opRoot, context)).toBe(true);
    const opResult = opRoot.render(context);
    expect(isThenable(opResult)).toBe(false); // sync-by-default: no promise allocated
    expect(opResult as string).toContain('width: 30px');

    const calcRoot = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        decl({ name: 'margin', value: call({ name: 'calc', args: list([op([dimension([10, 'px']), '*', num(2)])]) }) })
      ] })
    ]);
    expect(isSpineEligibleRoot(calcRoot, context)).toBe(true);
  });

  it('resolves an INTERPOLATED selector at ruleset-enter through the spine (OQ-A: concrete selector)', () => {
    // `[data=@{attr-data}]` must resolve to `[data="foo"]` against the live frame
    // at ruleset-enter — via `selector.eval` in the single pass, NO eval pass, NO
    // output tree. This is what lets extend see the CONCRETE selector (OQ-A).
    const root = rules([
      vardecl({ name: 'attr-data', value: spaced([el('foo')]) }),
      ruleset({
        selector: attr({ name: 'data', op: '=', value: any('@{attr-data}') }),
        rules: [decl({ name: 'color', value: spaced([el('red')]) })]
      })
    ]);
    expect(isSpineEligibleRoot(root, context)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = root.render(context) as string;
      expect(spineRenderCounter.rootRenders).toBe(before + 1); // single pass ran
      expect(deriveCalls).toBe(0); // no output tree
      expect(css).toContain('[data="foo"]'); // interpolation resolved concrete
      expect(css).not.toContain('@{'); // raw template gone
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('renders a nested @media AT-RULE through the spine (no eval, no output tree)', () => {
    const root = rules([
      vardecl({ name: 'w', value: spaced([el('10px')]) }),
      atrule({
        name: '@media',
        prelude: any('screen'),
        rules: [
          ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'width', value: ref({ key: 'w' }, { type: 'variable' }) })] })
        ]
      })
    ]);
    expect(isSpineEligibleRoot(root, context)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = root.render(context) as string;
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      expect(deriveCalls).toBe(0); // no output tree
      expect(css).toContain('@media screen');
      expect(css).toContain('width: 10px'); // prelude+leaf resolved live in one pass
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('HOISTS a @media nested in a ruleset to root through the spine (no eval/derive)', () => {
    // `.card { @media screen { .inner { color: red } } }` → @media hoists to root
    // with the composed selector `.card .inner` inside — reusing the KEPT hoist
    // machinery on the walk, with NO eval pass and NO output tree.
    const root = rules([
      ruleset({
        selector: sel([el('.card')]),
        rules: [
          decl({ name: 'padding', value: spaced([el('1rem')]) }),
          atrule({
            name: '@media',
            prelude: any('screen'),
            rules: [
              ruleset({ selector: sel([el('.inner')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
            ]
          })
        ]
      })
    ]);
    const hoistContext = new Context({ output: { collapseNesting: true } });
    expect(isSpineEligibleRoot(root, hoistContext)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = root.render(hoistContext) as string;
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      expect(deriveCalls).toBe(0);
      expect(css).toContain('@media screen');
      expect(css).toContain('.card .inner'); // hoisted + composed selector
      // The @media block is hoisted OUT of `.card` (root-level), so `.card`'s own
      // block closes before the @media opens.
      expect(css.indexOf('padding: 1rem')).toBeLessThan(css.indexOf('@media'));
    } finally {
      Rules.prototype.derive = original;
    }
  });
});
