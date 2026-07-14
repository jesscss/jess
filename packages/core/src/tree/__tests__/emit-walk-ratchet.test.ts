import { beforeEach, describe, expect, it } from 'vitest';
import { rules, decl, spaced, el, vardecl, ref, ruleset, sel, amp, call, list, op, dimension, num, attr, any, atrule, mixin, nil, rest, condition, extend, ExtendFlag, compound, co } from '../index.js';
import { Context } from '../../context.js';
import { Rules } from '../rules.js';
import { isThenable } from '@jesscss/awaitable-pipe';
import { spineRenderCounter, isSpineEligibleRoot, isSpineEligibleMixinCall } from '../util/emit-walk.js';
import { bodyHasConditionalAssign } from '../util/spine-cond.js';
import { bodyHasSetDefined } from '../util/spine-setdefined.js';
import { Parser } from '../../../../less-parser/src/index.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';

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

  it('ADMITS + hoists AMPERSAND-APPEND (`&-modifier` → `.a-modifier`) through the spine (no eval/derive)', () => {
    // `.a { &-mod { color: red } }` → `.a-mod` HOISTED to root: the resolved
    // append selector carries `hoistToRoot` (from `Ampersand.evalNode`'s append path),
    // which `Ruleset.isHoisted` reads off `options.spineSelector` so the block places
    // at root exactly like the eval pass — in ONE downward pass, no output tree.
    const appendRoot = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        ruleset({ selector: sel([amp('-mod')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
      ] })
    ]);
    const appendContext = new Context({ output: { collapseNesting: true } });
    expect(isSpineEligibleRoot(appendRoot, appendContext)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = appendRoot.render(appendContext) as string;
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      expect(deriveCalls).toBe(0); // no output tree
      expect(css).toContain('.a-mod'); // append materialized + hoisted
      expect(css).not.toContain('&'); // the `&` is resolved away, not emitted raw
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('folds NESTED append (`.a { &-b { &-c {…} } }` → `.a-b-c`) via the resolved-frame side-channel', () => {
    // Each level appends against the RESOLVED parent (`.a-b`), read from
    // `context.spineResolvedFrameSelector`, not the raw authored `&-b` (which throws).
    const nested = new Parser().parse('.a { &-b { &-c { color: red; } } }').tree;
    const ctx = new Context({ output: { collapseNesting: true } });
    expect(isSpineEligibleRoot(nested, ctx)).toBe(true);
    const css = nested.render(ctx) as string;
    expect(css).toContain('.a-b-c');
  });

  it('DEFERS the append edge-shapes to eval (precise, ratchet-locked P4 items)', () => {
    // (1) append ruleset with a NESTED-CONTAINER child.
    const containerChild = new Parser().parse('.a { &-x { color: red; .inner { color: green; } } }').tree;
    expect(isSpineEligibleRoot(containerChild, new Context())).toBe(false);
    // (2) append child under a SELECTOR-LIST parent.
    const listParent = new Parser().parse('.a, .b { &-x { color: red; } }').tree;
    expect(isSpineEligibleRoot(listParent, new Context())).toBe(false);
    // (3) append × extend — an append-generated selector may be an extend target the
    //     static gather can't see.
    const appendExtend = new Parser().parse('.button { &-primary { color: red; } } .theme:extend(.button-primary) {}').tree;
    expect(isSpineEligibleRoot(appendExtend, new Context())).toBe(false);
  });

  it('ADMITS + composes plain `&` selectors through the spine (no eval/derive)', () => {
    // `.parent { &.active { color: red } }` → `.parent.active` composed from the
    // live structural stack at ruleset-enter, in ONE pass.
    const root = rules([
      ruleset({ selector: sel([el('.parent')]), rules: [
        ruleset({ selector: sel([amp(), el('.active')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
      ] })
    ]);
    const ampContext = new Context({ output: { collapseNesting: true } });
    expect(isSpineEligibleRoot(root, ampContext)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = root.render(ampContext) as string;
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      expect(deriveCalls).toBe(0); // no output tree
      expect(css).toContain('.parent.active'); // `&` composed from the live stack
    } finally {
      Rules.prototype.derive = original;
    }
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

  it('folds a NESTED-CHILD `:is()`-COLLAPSE through the spine (extend-nest `.box`, no eval/derive)', () => {
    // §5 collapse: `.sidebar { .box {…} }` with two PARTIAL extenders of `.sidebar`
    // (`.sidebar2`, `.type1 .sidebar3`). The parent `.sidebar` gains an Or-set; the nested
    // `.box` folds into it → `:is(.sidebar, .sidebar2, .type1 .sidebar3) .box`. Wired via the
    // spine's parent-projection fold (`foldNestedChildHeaderNode`), NOT the eval-path
    // `extend-roots.ts` re-derivation. RATCHET: shape folds via the Compiler with `Rules.derive`=0.
    const root = rules([
      ruleset({
        selector: el('.sidebar'),
        rules: [
          decl({ name: 'width', value: any('300px') }),
          ruleset({ selector: el('.box'), rules: [decl({ name: 'background', value: any('#FFF') })] })
        ]
      }),
      ruleset({ selector: el('.sidebar2'), rules: [extend({ target: el('.sidebar'), flag: ExtendFlag.All })] }),
      ruleset({
        selector: el('.type1'),
        rules: [ruleset({ selector: el('.sidebar3'), rules: [extend({ target: el('.sidebar'), flag: ExtendFlag.All })] })]
      })
    ]);
    const collapseContext = new Context({ output: { collapseNesting: true } });
    expect(isSpineEligibleRoot(root, collapseContext)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = root.render(collapseContext) as string;
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      expect(deriveCalls).toBe(0); // shape folds via the Compiler, no output tree
      // `.box` folded into the parent Or-set — the ratified alpha collapse shape.
      expect(css).toContain(':is(.sidebar, .sidebar2, .type1 .sidebar3) .box');
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('folds a PARTIAL-extend-into-nested-child under an OR-parent through the spine (extend-selector `.ext`/`.c`, no eval/derive)', () => {
    // `.a, .b { .c:extend(.ext all) {…} }` — `.c` nested under a MULTI-BRANCH (OR) parent
    // partial-extends root `.ext`. `.ext` gains the composed contribution `:is(.a, .b) .c`
    // (the list parent grouped under `:is`). Wired via the CASE-2 `flatLocalSelector`
    // materialization of the `.a, .b` list surface into a path level, so
    // `composeContribution`'s `wrapIsIfMultiList` produces the grouped form. RATCHET: folds via
    // the Compiler with `Rules.derive`=0.
    const root = rules([
      ruleset({ selector: el('.ext'), rules: [decl({ name: 'test', value: any('1') })] }),
      ruleset({
        selector: [el('.a'), el('.b')],
        rules: [
          decl({ name: 'test', value: any('2') }),
          ruleset({ selector: el('.c'), rules: [extend({ target: el('.ext'), flag: ExtendFlag.All }), decl({ name: 'test', value: any('3') })] })
        ]
      })
    ]);
    const collapseContext = new Context({ output: { collapseNesting: true } });
    expect(isSpineEligibleRoot(root, collapseContext)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = root.render(collapseContext) as string;
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      expect(deriveCalls).toBe(0);
      // `.ext` gains the grouped composed contribution — the ratified alpha shape.
      expect(css).toContain('.ext,\n:is(.a, .b) .c');
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('wraps a PARTIAL-OF-LEADING-COMPOUND in place through the spine (extend-selector `.foo .bar`, no eval/derive)', () => {
    // `.foo .bar, .foo .baz` with root-level partial extenders of the LEADING compound `.foo`
    // (`.ext1 .ext2`, `.ext3`, `.ext4`) → each branch wraps `.foo` IN PLACE:
    // `:is(.foo, .ext1 .ext2, .ext3, .ext4) .bar`. SHAPE 4: `.foo` is recognized as an addressable
    // leading-compound subject (gate), and the header comes from SOLVE's local-apply rewrite (not
    // EMIT's branch-append, which would wrongly add siblings). RATCHET: folds via the Compiler,
    // `Rules.derive`=0.
    const root = rules([
      ruleset({ selector: [sel([el('.foo'), co(' '), el('.bar')]), sel([el('.foo'), co(' '), el('.baz')])], rules: [decl({ name: 'display', value: any('none') })] }),
      ruleset({ selector: sel([el('.ext1'), co(' '), el('.ext2')]), rules: [extend({ target: el('.foo'), flag: ExtendFlag.All })] }),
      ruleset({ selector: [el('.ext3'), el('.ext4')], rules: [extend({ target: el('.foo'), flag: ExtendFlag.All })] })
    ]);
    const partialCtx = new Context({ output: { collapseNesting: true } });
    expect(isSpineEligibleRoot(root, partialCtx)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = root.render(partialCtx) as string;
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      expect(deriveCalls).toBe(0);
      // Leading `.foo` wrapped in place per branch — the ratified alpha shape.
      expect(css).toContain(':is(.foo, .ext1 .ext2, .ext3, .ext4) .bar');
      expect(css).toContain(':is(.foo, .ext1 .ext2, .ext3, .ext4) .baz');
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('folds the amp-test `&+&`-crossing graft through the spine (CASE 3, eager composeSelector, no derive)', async () => {
    // `.amp-test-a, .amp-test-b { .amp-test-c &.amp-test-d&.amp-test-e { .amp-test-f&+&.amp-test-g:extend(.amp-test-h) } }`
    // The `&`-bearing extender under a MULTI-BRANCH parent folds — via the gather's PURE
    // `Ruleset.composeSelector`-reduce (F_AMPERSAND propagated up) — to the ratified `:is`-graft, then
    // appends as a sibling of `.amp-test-h`. No eval, no frames. RATCHET: folds via the Compiler,
    // `Rules.derive`=0; byte-identical to the ratified `.css`.
    const src = `
.amp-test-a,
.amp-test-b {
  .amp-test-c &.amp-test-d&.amp-test-e {
    .amp-test-f&+&.amp-test-g:extend(.amp-test-h) {}
  }
}
.amp-test-h {
  test: extended by masses of selectors;
}
`;
    const context = new Context({ output: { collapseNesting: true }, leakyScope: true });
    const { tree } = new Parser().parse(src);
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const css = (await renderNodeToString(tree as unknown as RenderBufferNode, context, { context })).trim();
      expect(deriveCalls).toBe(0);
      expect(css).toBe(`.amp-test-h,
.amp-test-f:is(.amp-test-c :is(.amp-test-a, .amp-test-b).amp-test-d:is(.amp-test-a, .amp-test-b).amp-test-e) + :is(.amp-test-c :is(.amp-test-a, .amp-test-b).amp-test-d:is(.amp-test-a, .amp-test-b).amp-test-e).amp-test-g {
  test: extended by masses of selectors;
}`);
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('resolves a RE-DECLARED var + `snapshot` read PER-POSITION through the spine (no eval/derive)', () => {
    // @color: red; seen(snapshot): @color; @color: blue; later: @color
    //   → seen sees red (binding at its source position), later sees blue.
    // The single-pass spine numbers the children at scope-enter
    // (assignSpineChildIndices) so the position-gated lookup picks the right
    // declaration — NOT last-wins. NO eval pass, NO output tree.
    const root = rules([
      vardecl({ name: 'color', value: any('red') }),
      decl({ name: 'seen', value: ref({ key: 'color' }, { type: 'variable', readMode: 'snapshot' }) }),
      vardecl({ name: 'color', value: any('blue') }),
      decl({ name: 'later', value: ref({ key: 'color' }, { type: 'variable' }) })
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
      expect(deriveCalls).toBe(0);
      expect(css).toContain('seen: red'); // snapshot: value at its position
      expect(css).toContain('later: blue'); // read after the re-declaration
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('coalesces `+:` / `+_:` MERGE declarations in a ruleset body through the spine (no eval/derive)', () => {
    // `+:` → comma list on the anchor (last), earlier suppressed; `+_:` → space
    // sequence. The combined value is a genuinely new node produced at emit time;
    // NO eval pass, NO output tree. Both printed as plain `prop: value`.
    const addRoot = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        decl({ name: 'background', value: any('red') }, { assign: '+:' }),
        decl({ name: 'background', value: any('blue') }, { assign: '+:' })
      ] })
    ]);
    const seqRoot = rules([
      ruleset({ selector: sel([el('.b')]), rules: [
        decl({ name: 'transform', value: any('scale(1)') }, { assign: '+_:' }),
        decl({ name: 'transform', value: any('rotate(5deg)') }, { assign: '+_:' })
      ] })
    ]);
    expect(isSpineEligibleRoot(addRoot, context)).toBe(true);
    expect(isSpineEligibleRoot(seqRoot, context)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const addCss = addRoot.render(context) as string;
      const seqCss = seqRoot.render(new Context()) as string;
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before);
      expect(deriveCalls).toBe(0); // no output tree
      expect(addCss).toContain('background: red, blue'); // comma-coalesced anchor
      expect(addCss).not.toContain('+:'); // operator normalized away
      expect(seqCss).toContain('transform: scale(1) rotate(5deg)'); // space-coalesced
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('FOLDS ROOT-LEVEL `?:` + same-scope `setDefined` through the spine, byte-identical to eval (cutover root-fold, gates 4/5); KEEPS root `+:`/`+_:` merge on eval (gate 3 residual)', () => {
    // The root body is just another entry sequence: an `@x ?: v` conditional-assign
    // or a same-scope `!global` `setDefined` DIRECTLY in the root body folds via the
    // SAME `withSpineMergePlan` machinery the container descent uses (installed at the
    // root spine descent in `Rules._emitRulesBody`), byte-identical to eval. A
    // root-direct property-MERGE stays on eval (gate 3 residual — `planBodyMerges`
    // edge-shape gaps; see `isSpineEligibleRoot`).
    const evalOracle = (build: () => Rules): string =>
      String(build().render(new Context(), { preSerializeRoot: (r: Rules): Rules => r })).trim();
    const foldsByteIdentical = (build: () => Rules): void => {
      expect(isSpineEligibleRoot(build(), context)).toBe(true);
      const original = Rules.prototype.derive;
      let deriveCalls = 0;
      Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
        deriveCalls++;
        return original.apply(this, args);
      } as Rules['derive'];
      const before = spineRenderCounter.rootRenders;
      try {
        const css = String(build().render(new Context())).trim();
        expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine ran
        expect(deriveCalls).toBe(0); // no output tree
        expect(css).toBe(evalOracle(build)); // byte-identical to eval
      } finally {
        Rules.prototype.derive = original;
      }
    };

    // GATE 3 residual — a root-direct `+:` / `+_:` merge STAYS on eval (byte-identical).
    const rootMergeAdd = rules([
      decl({ name: 'background', value: any('red') }, { assign: '+:' }),
      decl({ name: 'background', value: any('blue') }, { assign: '+:' }),
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'color', value: any('green') })] })
    ]);
    expect(isSpineEligibleRoot(rootMergeAdd, context)).toBe(false);
    const rootMergeSeq = rules([
      decl({ name: 'transform', value: any('scale(1)') }, { assign: '+_:' }),
      decl({ name: 'transform', value: any('rotate(5deg)') }, { assign: '+_:' }),
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'color', value: any('green') })] })
    ]);
    expect(isSpineEligibleRoot(rootMergeSeq, context)).toBe(false);

    // GATE 4 — root-direct `@x ?: v` on a VARIABLE (prior wins; else fallback), read
    // by a following ruleset.
    foldsByteIdentical(() => rules([
      vardecl({ name: 'x', value: any('red') }),
      vardecl({ name: 'x', value: any('blue') }, { assign: '?:' }),
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'color', value: ref({ key: 'x' }, { type: 'variable' }) })] })
    ]));
    foldsByteIdentical(() => rules([
      vardecl({ name: 'x', value: any('blue') }, { assign: '?:' }),
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'color', value: ref({ key: 'x' }, { type: 'variable' }) })] })
    ]));

    // GATE 5 — root-direct same-scope `!global` `setDefined` (prior same-body binding),
    // read by a following ruleset.
    foldsByteIdentical(() => rules([
      vardecl({ name: 'color', value: any('red') }),
      vardecl({ name: 'color', value: any('blue') }, { setDefined: true }),
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'seen', value: ref({ key: 'color' }, { type: 'variable' }) })] })
    ]));

    // A `?:` on a plain PROPERTY at root is NOT a binding rewrite — stays on eval.
    const propCondRoot = rules([
      decl({ name: 'color', value: any('green') }),
      decl({ name: 'color', value: any('red') }, { assign: '?:' })
    ]);
    expect(isSpineEligibleRoot(propCondRoot, context)).toBe(false);

    // A CROSS-SCOPE root `setDefined` (no same-body prior) stays on eval.
    const crossScopeRoot = rules([
      vardecl({ name: 'y', value: any('blue') }, { setDefined: true }),
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'seen', value: ref({ key: 'y' }, { type: 'variable' }) })] })
    ]);
    expect(isSpineEligibleRoot(crossScopeRoot, context)).toBe(false);

    // `nearestOuter` (Jess `:=`) has no eval oracle — the deferred mechanism-B is NOT
    // pulled forward; a root-direct `:=` stays EXCLUDED.
    const nearestOuterRoot = rules([
      vardecl({ name: 'x', value: any('red') }, { nearestOuter: true })
    ]);
    expect(isSpineEligibleRoot(nearestOuterRoot, context)).toBe(false);
  });

  it('FOLDS conditional `@x ?: v` (variable, assign-if-undefined) through the spine, byte-identical to eval', () => {
    // `?:` on a VARIABLE is the eval-path VALUE REWRITE (a self-reference with a
    // `fallbackValue`, position-gated to the `?:` node's index) reproduced as a
    // body plan (`planBodyConditionals`): the prior binding wins, else the
    // fallback. Byte-identical to eval by construction (same reference, same
    // position-gated read); no eval pass, no output tree (`derive` not called).
    const buildPriorWins = () => rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        vardecl({ name: 'x', value: any('red') }),
        vardecl({ name: 'x', value: any('blue') }, { assign: '?:' }),
        decl({ name: 'color', value: ref({ key: 'x' }, { type: 'variable' }) })
      ] })
    ]);
    const buildFallback = () => rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        vardecl({ name: 'x', value: any('blue') }, { assign: '?:' }),
        decl({ name: 'color', value: ref({ key: 'x' }, { type: 'variable' }) })
      ] })
    ]);
    // Eval oracle: a `preSerializeRoot` hook forces the two-walk eval path.
    const evalOracle = (build: () => Rules): string =>
      String(build().render(new Context(), { preSerializeRoot: (r: Rules): Rules => r })).trim();

    for (const build of [buildPriorWins, buildFallback]) {
      const root = build();
      expect(isSpineEligibleRoot(root, context)).toBe(true);
      const original = Rules.prototype.derive;
      let deriveCalls = 0;
      Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
        deriveCalls++;
        return original.apply(this, args);
      } as Rules['derive'];
      const before = spineRenderCounter.rootRenders;
      try {
        const css = String(root.render(new Context())).trim();
        expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine ran
        expect(deriveCalls).toBe(0); // no output tree
        expect(css).toBe(evalOracle(build)); // byte-identical to eval
      } finally {
        Rules.prototype.derive = original;
      }
    }
    // Prior wins → `red`; no-prior → fallback `blue`.
    expect(String(buildPriorWins().render(new Context())).trim()).toContain('color: red');
    expect(String(buildFallback().render(new Context())).trim()).toContain('color: blue');
  });

  it('FOLDS a SAME-SCOPE `setDefined` (Sass !global) through the spine, byte-identical to eval', () => {
    // `setDefined` on a variable with a PRIOR same-body binding is an incremental
    // binding-WRITE (`spine-setdefined.ts`, mechanism B): resolve the existing
    // SAME-frame cell and write it in-descent. Byte-identical to eval's same-scope
    // update; no eval pass, no output tree.
    const build = () => rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        vardecl({ name: 'color', value: any('red') }),
        vardecl({ name: 'color', value: any('blue') }, { setDefined: true }),
        decl({ name: 'seen', value: ref({ key: 'color' }, { type: 'variable' }) })
      ] })
    ]);
    const evalOracle = String(build().render(new Context(), { preSerializeRoot: (r: Rules): Rules => r })).trim();
    const root = build();
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    const before = spineRenderCounter.rootRenders;
    try {
      const css = String(root.render(new Context())).trim();
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine ran
      expect(deriveCalls).toBe(0); // no output tree
      expect(css).toBe(evalOracle); // byte-identical
      expect(css).toContain('seen: blue'); // the !global write is observed
    } finally {
      Rules.prototype.derive = original;
    }
    // Miss (no enclosing binding) throws `"x" is not defined` — like eval.
    const miss = () => rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        vardecl({ name: 'y', value: any('blue') }, { setDefined: true })
      ] })
    ]);
    // A bare cross-scope `setDefined` is NOT same-scope-covered, so it stays on
    // eval; assert eligibility false so it is not folded (miss still throws in eval).
    expect(isSpineEligibleRoot(miss(), context)).toBe(false);
  });

  it('STILL EXCLUDES a plain-PROPERTY `?:`, a CROSS-SCOPE `setDefined`, and `nearestOuter` (the frontier)', () => {
    // A `?:` on a plain PROPERTY (`color ?: v`) is NOT a binding rewrite — eval
    // keeps BOTH the prior property decl AND the fallback as a new decl. The body
    // plan models the VARIABLE-binding shape only, so a property `?:` stays on
    // eval (SEQUENCED — spec in `spine-cond.ts`).
    const propCond = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        decl({ name: 'color', value: any('green') }),
        decl({ name: 'color', value: any('red') }, { assign: '?:' })
      ] })
    ]);
    expect(isSpineEligibleRoot(propCond, context)).toBe(false);

    // A CROSS-SCOPE `setDefined` (no same-body prior — the write resolves to an
    // OUTER frame) diverges from eval's two-pass (which does not leak an outer
    // write to a later same-scope read). SEQUENCED to eval (`spine-setdefined.ts`);
    // a nested-scope !global writing an outer binding stays off the spine.
    const crossScope = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        vardecl({ name: 'x', value: any('red') }),
        ruleset({ selector: sel([el('.inner')]), rules: [
          vardecl({ name: 'x', value: any('blue') }, { setDefined: true })
        ] })
      ] })
    ]);
    expect(isSpineEligibleRoot(crossScope, context)).toBe(false);

    // `nearestOuter` (Jess :=) has NO eval implementation — no correctness oracle
    // — so it stays EXCLUDED (owner decision pending). NOT silently no-op'd.
    const nearestOuter = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        vardecl({ name: 'x', value: any('red') }, { nearestOuter: true })
      ] })
    ]);
    expect(isSpineEligibleRoot(nearestOuter, context)).toBe(false);
  });

  it('NEGATIVE ratchet: a tree WITHOUT `?:`/`setDefined` adds NO read-time tax (no plan / no write-pass)', () => {
    // The `?:` fold is a per-body PLAN and `setDefined` is a per-body WRITE-pass,
    // each built/run ONLY when a body contains that shape (fast pre-scan bail). A
    // plain tree must build NO cond plan, run NO setDefined write-pass, and consult
    // NO side-table on the variable-READ hot path — this locks the "no hot-path tax"
    // decision (the read-time side-table mechanism was REJECTED precisely to avoid
    // taxing every read). A future change that threads a conditional/outer-write
    // overlay into `lookupScopeFrameVariable` (mechanism A) trips this.
    const plain = rules([
      vardecl({ name: 'x', value: any('red') }),
      decl({ name: 'color', value: ref({ key: 'x' }, { type: 'variable' }) }),
      decl({ name: 'margin', value: any('0') })
    ]);
    expect(isSpineEligibleRoot(plain, context)).toBe(true);
    // The pre-scan bails: no cond plan, no setDefined write-pass on a plain body.
    expect(bodyHasConditionalAssign(plain.rules)).toBe(false);
    expect(bodyHasSetDefined(plain.rules)).toBe(false);
    const css = String(plain.render(new Context())).trim();
    expect(css).toContain('color: red');
    expect(css).toContain('margin: 0');
  });

  it('ADMITS root-only WRAP+EMIT at-rules through the spine (declaration + keyframe bodies)', () => {
    // The "wrap + emit" family (`@font-face`/`@page`/`@keyframes`/…): no hoist, no
    // composition — a prelude + a self-contained body. Locked eligible so a
    // regression that drops them back to the eval path trips RED.
    const fontFace = rules([
      atrule({ name: '@font-face', rules: [
        decl({ name: 'font-family', value: any('"X"') }),
        decl({ name: 'src', value: call({ name: 'url', args: list([any('"x.woff2"')]) }) })
      ] })
    ]);
    expect(isSpineEligibleRoot(fontFace, context)).toBe(true);

    const page = rules([
      atrule({ name: '@page', rules: [decl({ name: 'margin', value: any('2cm') })] })
    ]);
    expect(isSpineEligibleRoot(page, context)).toBe(true);

    const counterStyle = rules([
      atrule({ name: '@counter-style', prelude: any('c'), rules: [decl({ name: 'system', value: any('fixed') })] })
    ]);
    expect(isSpineEligibleRoot(counterStyle, context)).toBe(true);

    // Keyframes: keyframe-selector rulesets (`0%`, `100%`) as children — admitted
    // (no `&`, standalone via the root-only composed-stack reset).
    const keyframes = rules([
      atrule({ name: '@keyframes', prelude: any('spin'), rules: [
        ruleset({ selector: sel([el('0%')]), rules: [decl({ name: 'top', value: any('0') })] }),
        ruleset({ selector: sel([el('100%')]), rules: [decl({ name: 'top', value: any('10px') })] })
      ] })
    ]);
    expect(isSpineEligibleRoot(keyframes, context)).toBe(true);

    const webkitKeyframes = rules([
      atrule({ name: '@-webkit-keyframes', prelude: any('frames'), rules: [
        ruleset({ selector: sel([el('0%')]), rules: [decl({ name: 'border', value: any('1px') })] })
      ] })
    ]);
    expect(isSpineEligibleRoot(webkitKeyframes, context)).toBe(true);
  });

  it('ADMITS `@property` (declaration-bodied root-only, NO eval-pass registration)', () => {
    // `@property --x { … }` was formerly deferred on the assumption it registers a
    // custom property during eval — but it carries NO such side effect (it registers
    // nothing into a scope or the extend-roots graph, verified against the eval pass).
    // It is structurally a `@font-face`-like declaration block, so it folds.
    const property = rules([
      atrule({ name: '@property', prelude: any('--x'), rules: [
        decl({ name: 'syntax', value: any('"<color>"') }),
        decl({ name: 'inherits', value: any('false') })
      ] })
    ]);
    expect(isSpineEligibleRoot(property, context)).toBe(true);
  });

  it('EXCLUDES a root-only at-rule whose body carries an `&` (the composed-frontier guard)', () => {
    // A stray `&`-bearing child ruleset inside a wrap+emit at-rule has no
    // meaningful parent to compose against and the composed serializer would
    // mis-handle it — kept on the eval path.
    const ampInAtRule = rules([
      atrule({ name: '@document', prelude: any('url-prefix("x")'), rules: [
        ruleset({ selector: sel([amp(), el('.x')]), rules: [decl({ name: 'color', value: any('red') })] })
      ] })
    ]);
    expect(isSpineEligibleRoot(ampInAtRule, context)).toBe(false);
  });
});

/**
 * MIXIN-FOLD RATCHET (cutover increment 1 — the FIRST dynamic-machinery fold).
 * A simple no-arg mixin call over a literal-body definition is EXPANDED INLINE
 * through the single pass: the KEPT callable pipeline resolves the candidate +
 * binds + guards, the terminal hands the bound surface to the emit-walk sink
 * INSTEAD of building an output tree, and the surface's declarations are spliced
 * into the enclosing body's statement stream. LOCKS: the call routes via the
 * spine (`spineRenderCounter` moves) with NO output tree (`Rules.derive`
 * uncalled), byte-identical to the eval path; and the precise increment-1 exclusion
 * boundary (`mixin-ruleset`/closures, parametric defs, var-reading bodies,
 * merge-adjacent, mixin-as-value) stays on the eval path. A regression that stops
 * folding, builds an output tree, or silently admits a deferred shape trips RED.
 *
 * @see docs/future/core-architecture/UNIFIED-EVAL-EMIT-DESIGN.md §2/§3 (frame
 *   threading + always-share body).
 */
describe('emit-walk MIXIN-FOLD ratchet (cutover increment 1)', () => {
  let context: Context;
  beforeEach(() => {
    context = new Context();
  });

  const simpleMixinRoot = () => rules([
    mixin({ name: '.m', rules: [
      decl({ name: 'color', value: spaced([el('red')]) }),
      decl({ name: 'width', value: spaced([el('10px')]) })
    ] }),
    ruleset({
      selector: sel([el('.a')]),
      rules: [call({ name: ref({ key: '.m' }, { type: 'mixin' }) })]
    })
  ]);

  it('folds a simple literal mixin call through the spine — counter moves, output correct', async () => {
    const root = simpleMixinRoot();
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);

    const before = spineRenderCounter.rootRenders;
    // A mixin call resolves ASYNC (Call.evalNode is async) — the fold threads a
    // promise; await it (unlike the pure-sync leaf/container ratchets above).
    const css = await root.render(context);
    expect(spineRenderCounter.rootRenders).toBe(before + 1);
    expect(css).toContain('.a');
    expect(css).toContain('color: red');
    expect(css).toContain('width: 10px');
    // The raw call syntax must NOT leak (the fold expanded, not printed).
    expect(css).not.toContain('.m(');
  });

  it('builds NO output tree (Rules.derive not called) on the folded mixin path', async () => {
    const root = simpleMixinRoot();
    context.root = root;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = await root.render(context);
      expect(css).toContain('color: red');
      expect(deriveCalls).toBe(0);
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('INCREMENT 2: folds the Less `mixin-ruleset` dot-call over a Mixin def through the spine', async () => {
    // `type: 'mixin-ruleset'` (the Less `.m()` dot-call) resolving to a MIXIN
    // definition now folds via the frame-threaded descent — the first shape the
    // Less corpus actually exercises. (A ruleset-as-mixin candidate still defers.)
    const root = rules([
      mixin({ name: '.m', rules: [decl({ name: 'color', value: spaced([el('red')]) })] }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [call({ name: ref({ key: '.m' }, { type: 'mixin-ruleset' }) })]
      })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const css = await root.render(context);
    expect(spineRenderCounter.rootRenders).toBe(before + 1);
    expect(css).toContain('.a');
    expect(css).toContain('color: red');
  });

  it('FOLD A (P4 terminal/sink): folds a LONE ruleset-as-mixin — body at the call site + standalone', async () => {
    // `.foo { color: red }` called as `.foo()` (a `mixin-ruleset` dot-call matching a
    // same-named RULESET, no mixin of that name). FOLD A routes the Ruleset candidate
    // through `context.spineMixinSurfaceSink` in the special-case terminal, so its body
    // FOLDS at the call site (`.a { color: red }`) AND the ruleset ALSO streams
    // standalone (`.foo { color: red }`) — byte-identical to the eval path, no output
    // tree. Before FOLD A this shape hit the `!candidateIsMixin` sink reject → eval
    // fallback (byte-identical but on eval).
    const root = rules([
      ruleset({
        selector: sel([el('.foo')]),
        rules: [decl({ name: 'color', value: spaced([el('red')]) })]
      }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [call({ name: ref({ key: '.foo' }, { type: 'mixin-ruleset' }) })]
      })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = await root.render(context);
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      // standalone ruleset
      expect(css).toContain('.foo');
      // body folded at the call site
      expect(css).toContain('.a');
      // color: red appears TWICE (standalone + folded)
      expect(css.match(/color: red/g)?.length).toBe(2);
      // no raw call syntax
      expect(css).not.toContain('.foo(');
      // no output tree
      expect(deriveCalls).toBe(0);
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('FOLD C (P4 terminal/sink): folds a nested CHAIN mixin body (.a(){ .b() }) — re-entrant splice, no output tree', async () => {
    // `.b(){ inner } .a(){ .b(); x } .k{ .a() }` — the fold splice is RE-ENTRANT, so the
    // nested `.b()` call inside `.a()`'s folded surface is expanded in turn. Byte-
    // identical to eval (`.k { inner; x }` in document order), no output tree. A
    // RECURSIVE call (name-cycle) stays on eval (see mixin-fold-sequence-gate.test.ts).
    const root = rules([
      mixin({ name: '.b', rules: [decl({ name: 'inner', value: spaced([el('9')]) })] }),
      mixin({ name: '.a', rules: [
        call({ name: ref({ key: '.b' }, { type: 'mixin' }) }),
        decl({ name: 'x', value: spaced([el('1')]) })
      ] }),
      ruleset({
        selector: sel([el('.k')]),
        rules: [call({ name: ref({ key: '.a' }, { type: 'mixin' }) })]
      })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = await root.render(context);
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      expect(css).toContain('inner: 9');
      expect(css).toContain('x: 1');
      // the nested call expanded (no raw call syntax)
      expect(css).not.toContain('.b(');
      expect(css).not.toContain('.a(');
      // no output tree
      expect(deriveCalls).toBe(0);
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('INCREMENT 2: folds a VAR-READING mixin body (frame-threaded descent — resolves the definition scope)', async () => {
    // The body reads a variable bound in the DEFINITION scope (root). Increment 2
    // descends the bound surface under its own value-frame, so `@c` resolves to
    // `blue` (the closure/lexical binding) — NOT last-wins against the caller. This
    // is the shape increment 1 excluded (literal-only) and inc 2 unlocks; it is the
    // fix for the `'var' is not defined` failures inc 1 catalogued.
    const root = rules([
      vardecl({ name: 'c', value: spaced([el('blue')]) }),
      mixin({ name: '.m', rules: [decl({ name: 'color', value: ref({ key: 'c' }, { type: 'variable' }) })] }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [call({ name: ref({ key: '.m' }, { type: 'mixin' }) })]
      })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const css = await root.render(context);
    expect(css).toContain('color: blue');
    expect(css).not.toContain('.m(');
  });

  it('INCREMENT 3: folds a POSITIONAL-arg mixin call through the spine (arg bound into the param cell)', async () => {
    // `.m(@c, @w) { color: @c; width: @w }` called `.m(red, 10px)` — the positional
    // args bind into the param live-cells (`matchCallableParams`), resolved by the
    // frame-threaded descent. No output tree.
    const root = rules([
      mixin({
        name: '.m',
        params: list([
          vardecl({ name: 'c', value: nil() }, { paramVar: true }),
          vardecl({ name: 'w', value: nil() }, { paramVar: true })
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'c' }, { type: 'variable' }) }),
          decl({ name: 'width', value: ref({ key: 'w' }, { type: 'variable' }) })
        ]
      }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [call({
          name: ref({ key: '.m' }, { type: 'mixin' }),
          args: list([spaced([el('red')]), spaced([el('10px')])])
        })]
      })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const css = await root.render(context);
    expect(spineRenderCounter.rootRenders).toBe(before + 1);
    expect(css).toContain('color: red');
    expect(css).toContain('width: 10px');
    expect(css).not.toContain('.m(');
  });

  it('INCREMENT 5: folds a NAMED-arg mixin call (order-independent binding by param name)', async () => {
    const root = rules([
      mixin({
        name: '.m',
        params: list([
          vardecl({ name: 'c', value: spaced([el('red')]) }),
          vardecl({ name: 'w', value: spaced([el('1px')]) })
        ]),
        rules: [
          decl({ name: 'color', value: ref({ key: 'c' }, { type: 'variable' }) }),
          decl({ name: 'width', value: ref({ key: 'w' }, { type: 'variable' }) })
        ]
      }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [call({
          name: ref({ key: '.m' }, { type: 'mixin' }),
          args: list([
            vardecl({ name: 'w', value: spaced([el('9px')]) }),
            vardecl({ name: 'c', value: spaced([el('blue')]) })
          ])
        })]
      })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const css = await root.render(context);
    expect(css).toContain('color: blue');
    expect(css).toContain('width: 9px');
  });

  it('INCREMENT 6: folds a REST-param mixin call (tail args collected into `@rest`)', async () => {
    const root = rules([
      mixin({
        name: '.m',
        params: list([vardecl({ name: 'a', value: nil() }, { paramVar: true }), rest('rest')]),
        rules: [
          decl({ name: 'a', value: ref({ key: 'a' }, { type: 'variable' }) }),
          decl({ name: 'r', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ]
      }),
      ruleset({
        selector: sel([el('.x')]),
        rules: [call({
          name: ref({ key: '.m' }, { type: 'mixin' }),
          args: list([spaced([el('1')]), spaced([el('2')]), spaced([el('3')])])
        })]
      })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const css = await root.render(context);
    expect(spineRenderCounter.rootRenders).toBe(before + 1);
    expect(css).toContain('a: 1');
  });

  it('INCREMENT 4: folds a DEFAULT-param mixin call (default used when the arg is omitted)', async () => {
    // `.m(@c: red)` called `.m()` — `matchCallableParams` fills the default into the
    // param cell, resolved by the frame-threaded descent. No output tree.
    const root = rules([
      mixin({
        name: '.m',
        params: list([vardecl({ name: 'c', value: spaced([el('red')]) })]),
        rules: [decl({ name: 'color', value: ref({ key: 'c' }, { type: 'variable' }) })]
      }),
      ruleset({ selector: sel([el('.a')]), rules: [call({ name: ref({ key: '.m' }, { type: 'mixin' }) })] })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const css = await root.render(context);
    expect(spineRenderCounter.rootRenders).toBe(before + 1);
    expect(css).toContain('color: red');
  });

  it('FOLDS a mixin definition with a spine-eligible NESTED-CONTAINER body (surface descends the container carrying the frame)', async () => {
    // `.m() { .inner { … } }` — a non-leaf body now FOLDS: the captured surface's
    // container child descends via `serializeSpineFrameContainer` carrying the surface
    // frame. Only UNFOLDABLE container-body sub-shapes (at-rule ancestor-rewrap, nested
    // Mixin def, non-eligible container) still force eval.
    const root = rules([
      mixin({
        name: '.m',
        rules: [ruleset({ selector: sel([el('.inner')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })]
      }),
      ruleset({ selector: sel([el('.a')]), rules: [call({ name: ref({ key: '.m' }, { type: 'mixin' }) })] })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const css = await root.render(context);
    expect(spineRenderCounter.rootRenders).toBe(before + 1); // spine path
    // Expanded mode (this harness's default): the nested container emits nested.
    expect(css).toContain('.a');
    expect(css).toContain('.inner');
    expect(css).toContain('color: red');
  });

  it('Q-27: admits static array namespace keys and preserves source-span overload order', async () => {
    const namespace = (value: string, start: number) => mixin({
      name: '#ns',
      rules: [mixin({
        name: '#deeper',
        rules: [mixin({
          name: '.m',
          rules: [decl({ name: 'value', value: spaced([el(value)]) })]
        }, undefined, { start: start + 20, end: start + 40 })]
      }, undefined, { start: start + 10, end: start + 50 })]
    }, undefined, { start, end: start + 60 });
    const callNode = call({
      name: ref({ key: ['#ns', '#deeper', '.m'], rawKey: '#ns > #deeper > .m' }, { type: 'mixin-ruleset' })
    });
    const root = rules([
      namespace('first', 0),
      namespace('second', 100),
      ruleset({ selector: sel([el('.a')]), rules: [callNode] })
    ]);
    context.opts.output = { ...context.opts.output, collapseNesting: true };
    context.root = root;

    expect(isSpineEligibleMixinCall(callNode)).toBe(true);
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await root.render(context);
      expect(spineRenderCounter.rootRenders).toBe(before + 1);
      expect(deriveCalls).toBe(0);
      expect(css).toBe('.a {\n  value: first;\n  value: second;\n}\n');
    } finally {
      Rules.prototype.derive = original;
    }
  });

  it('INCREMENT 7: folds GUARDED mixin overloads — the passing guard SELECTS, the failing one emits nothing', async () => {
    // Two overloads of `.m(@x)` — `when (@x > 0)` and `when (@x <= 0)`. The terminal
    // evaluates the guard before the sink; only the passing candidate folds. A call
    // with no passing guard emits nothing (its sibling decl still emits).
    const guarded = (opStr: string, out: string) => mixin({
      name: '.m',
      params: list([vardecl({ name: 'x', value: nil() }, { paramVar: true })]),
      guard: condition([ref({ key: 'x' }, { type: 'variable' }), opStr, dimension(num(0))]),
      rules: [decl({ name: 's', value: spaced([el(out)]) })]
    });
    const root = rules([
      guarded('>', 'pos'),
      guarded('<=', 'nonpos'),
      ruleset({ selector: sel([el('.a')]), rules: [call({ name: ref({ key: '.m' }, { type: 'mixin' }), args: list([dimension(num(5))]) })] }),
      ruleset({ selector: sel([el('.b')]), rules: [call({ name: ref({ key: '.m' }, { type: 'mixin' }), args: list([dimension(num(-3))]) })] })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const css = await root.render(context);
    // `.a` (x=5) selects the `> 0` overload; `.b` (x=-3) selects `<= 0`.
    expect(css).toMatch(/\.a\s*\{[^}]*s:\s*pos/);
    expect(css).toMatch(/\.b\s*\{[^}]*s:\s*nonpos/);
  });

  it('INCREMENT 7: a guard that FAILS for all candidates folds to no mixin output', async () => {
    const root = rules([
      mixin({
        name: '.m',
        params: list([vardecl({ name: 'x', value: nil() }, { paramVar: true })]),
        guard: condition([ref({ key: 'x' }, { type: 'variable' }), '>', dimension(num(100))]),
        rules: [decl({ name: 's', value: spaced([el('big')]) })]
      }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [
          call({ name: ref({ key: '.m' }, { type: 'mixin' }), args: list([dimension(num(5))]) }),
          decl({ name: 'color', value: spaced([el('red')]) })
        ]
      })
    ]);
    context.root = root;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const css = await root.render(context);
    expect(css).toContain('color: red');
    expect(css).not.toContain('s: big');
  });

  it('FOLDS merge-across-mixin: STATIC merge decls arriving through CALLS coalesce on the spine (distinct mixins COMBINE; one mixin body coalesces)', async () => {
    // `.r { .a(); .b(); }` where each mixin body carries a STATIC `transform+:` merge
    // decl. The container descent RE-PLANS the coalesce over the POST-EXPANSION
    // `rulesToRender` sequence (`replanMergesIfExpanded`). TWO SEPARATE mixin bodies
    // COMBINE (Add-pull-prior — Less merges every same-property merge decl in the
    // output ruleset regardless of which mixin injected it), matching eval + the
    // upstream `merge.less` `.test-rule1` oracle (`rotate, skew, scale`). NOT last-wins.
    const twoMixins = '.a(){transform+: r;}\n.b(){transform+: s;}\n.r{ .a(); .b(); }';
    const context = new Context({ output: { collapseNesting: false }, leakyScope: true });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const root = new Parser().parse(twoMixins).tree as unknown as Rules;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const css = (await renderNodeToString(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      root as unknown as RenderBufferNode, context, { context, collapseNesting: false }
    )).trim();
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // ran the spine
    expect(css).toBe('.r {\n  transform: r, s;\n}'); // distinct mixins COMBINE (oracle)
    expect(css.startsWith('.r {')).toBe(true);
    expect(css).not.toContain('.a(');

    // TWO merges INSIDE ONE mixin body DO coalesce (same owner) — comma list.
    const oneMixin = '.a(){transform+: r; transform+: s;}\n.r{ .a(); }';
    const ctx2 = new Context({ output: { collapseNesting: false }, leakyScope: true });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const root2 = new Parser().parse(oneMixin).tree as unknown as Rules;
    expect(isSpineEligibleRoot(root2, ctx2)).toBe(true);
    const before2 = spineRenderCounter.rootRenders;
    const css2 = (await renderNodeToString(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      root2 as unknown as RenderBufferNode, ctx2, { context: ctx2, collapseNesting: false }
    )).trim();
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before2);
    expect(css2).toBe('.r {\n  transform: r, s;\n}'); // same-body coalesce
  });

  it('FOLDS merge-across-mixin: an ASYNC-valued mixin merge folds through the spine, byte-identical to eval', async () => {
    // `transform+: rotate(90deg)` — a merge value containing a `Call` resolves async,
    // so the call takes the EVAL-FALLBACK expansion. That expansion (and the dedup
    // key resolution) evaluates the unknown `Call`, whose call-syntax render used to
    // RESET the shared `context.printState` in place — swapping the live spine writer
    // mid-render and dropping the enclosing `.r { … }` header. Now every spine value
    // eval is wrapped in `evalIsolatingSpinePrintState`, so the scratch serialization
    // leaves the print state byte-identical and the merge folds (distinct mixin bodies
    // COMBINE via Add-pull-prior, matching eval).
    const source = '.a(){transform+: rotate(90deg);}\n.b(){transform+: scale(2);}\n.r{ .a(); .b(); }';
    const context = new Context({ output: { collapseNesting: false }, leakyScope: true });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const root = new Parser().parse(source).tree as unknown as Rules;
    expect(isSpineEligibleRoot(root, context)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const css = (await renderNodeToString(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      root as unknown as RenderBufferNode, context, { context, collapseNesting: false }
    )).trim();
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // ran the spine
    expect(css).toBe('.r {\n  transform: rotate(90deg), scale(2);\n}'); // distinct mixins COMBINE (oracle)
  });

  it('FOLDS merge-alongside-mixin: a DIRECT caller-body merge decl alongside a mixin call folds byte-identically', async () => {
    // `.a { .m(); box-shadow+: b; }` — a merge decl authored DIRECTLY in the caller
    // body next to a mixin call. The former `bodyHasMixinCall && bodyHasDirectMergeDecl`
    // reject is LIFTED: the post-expansion replan (`replanMergesIfExpanded`) combines
    // the direct decl's value off the accumulated prior (Add-pull-prior) across owners,
    // and the ruleset-as-mixin surface is now adopted before the sink is consulted
    // (`callable-special-case.ts`), so its contribution is counted exactly once. Here
    // the mixin injects a PLAIN `box-shadow: a` and the caller's `box-shadow+: b` follows;
    // Less emits both decls (the `+:` does not coalesce onto a plain prior) — verified
    // byte-identical to the eval path. RESIDUAL (fast-follow, still eval): a chain where a
    // member carries `!important` (the flag-propagation gap).
    const source = '.m(){box-shadow: a;}\n.a{ .m(); box-shadow+: b; }';
    const ctx = new Context({ output: { collapseNesting: false }, leakyScope: true });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const root = new Parser().parse(source).tree as unknown as Rules;
    expect(isSpineEligibleRoot(root, ctx)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const css = (await renderNodeToString(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      root as unknown as RenderBufferNode, ctx, { context: ctx, collapseNesting: false }
    )).trim();
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // ran the spine
    expect(css).toBe('.a {\n  box-shadow: a;\n  box-shadow: b;\n}'); // byte-identical to eval
  });

  it('a merge-contributing mixin DEFINED but never CALLED still folds', () => {
    const source = '.a(){transform+: t1;}\n.r{ color: red; }';
    const context = new Context({ output: { collapseNesting: false }, leakyScope: true });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const root = new Parser().parse(source).tree as unknown as Rules;
    // A merge-free caller body folds regardless of a defined-but-uncalled merge mixin.
    expect(isSpineEligibleRoot(root, context)).toBe(true);
  });

  it('FOLDS a body using a mixin as a variable value / map (`@p: .m()` — mixin-as-value)', () => {
    // A mixin DEFINITION bound to a variable then map-subscripted (`@p[key]`) folds on
    // the spine: the var cell binds at scope-enter and the lookup resolves via the KEPT
    // `Reference.eval` against the live value-frame, byte-identical to eval + less@4. The
    // old conservative `bodyHasMixinDefinition && bodyHasCallInVarValue` reject is removed.
    const root = rules([
      ruleset({
        selector: sel([el('.a')]),
        rules: [
          mixin({ name: '.m', rules: [decl({ name: 'text', value: spaced([el('white')]) })] }),
          vardecl({ name: 'p', value: call({ name: ref({ key: '.m' }, { type: 'mixin' }) }) })
        ]
      })
    ]);
    expect(isSpineEligibleRoot(root, context)).toBe(true);
  });
});

/**
 * AT-RULE FOLD ratchet (design pass: `@property`/`@scope`/`@layer` + var-ref names).
 * Each newly-folded at-rule shape renders through the SINGLE spine pass with NO
 * output tree (`Rules.derive`=0) and byte-identical output to the (former) eval
 * path. A later change that re-defers one of these — or re-introduces the output
 * tree — trips the relevant test RED. The expected CSS strings are the eval-path
 * baselines captured during the design pass.
 */
describe('at-rule fold ratchet (property / scope / layer / var-ref names)', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  /**
   * Parse `src`, assert it is spine-eligible, render through the single pass with
   * NO output tree (`Rules.derive`=0), and return the trimmed CSS for a BYTE-EXACT
   * `.toBe(...)` assertion against the eval-path baseline. Any `Rules.derive` call
   * (an output tree) fails the ratchet — the fold is proven, not merely allowed.
   */
  const foldToBytes = async (src: string, ctx: Context): Promise<string> => {
    const { tree } = new Parser().parse(src);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const root = tree as unknown as Rules;
    expect(isSpineEligibleRoot(root, ctx)).toBe(true);
    const before = spineRenderCounter.rootRenders;
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const css = (await renderNodeToString(tree as unknown as RenderBufferNode, ctx, { context: ctx })).trim();
      expect(spineRenderCounter.rootRenders).toBe(before + 1); // single pass ran
      expect(deriveCalls).toBe(0); // no output tree — fold, not eval fall-back
      return css;
    } finally {
      Rules.prototype.derive = original;
    }
  };

  it('folds `@property` byte-identical (static + `initial-value: @c`, no registration)', async () => {
    const css = await foldToBytes(
      `@c: red; @property --foo { syntax: "<color>"; inherits: false; initial-value: @c; }`,
      context
    );
    expect(css).toBe(`@property --foo {
  syntax: "<color>";
  inherits: false;
  initial-value: red;
}`);
  });

  it('folds a BARE `@scope` byte-identical', async () => {
    const css = await foldToBytes(`@scope { :scope { color: red; } }`, context);
    expect(css).toBe(`@scope {
  :scope {
    color: red;
  }
}`);
  });

  it('folds `@scope (.card) to (.content)` byte-identical (start/end prelude)', async () => {
    // The `(start) to (end)` prelude rides the existing `rawPrelude.eval`
    // at-enter path — no special handling; body composes as a normal container.
    const css = await foldToBytes(`@scope (.card) to (.content) { .a { color: red; } }`, context);
    expect(css).toBe(`@scope (.card) to(.content) {
  .a {
    color: red;
  }
}`);
  });

  it('folds `@scope` with a variable resolved in its body byte-identical', async () => {
    const css = await foldToBytes(`@w: 10px; @scope (.card) { .a { width: @w; } }`, context);
    expect(css).toBe(`@scope (.card) {
  .a {
    width: 10px;
  }
}`);
  });

  it('folds a VAR-REF at-rule NAME byte-identical (`@keyframes @name` → resolved keyword)', async () => {
    // The interpolated-NAME shape that actually parses is a bare var-ref in the
    // NAME/prelude position (NOT `@{…}` in the keyword — that parse-errors). It
    // resolves via the same prelude-eval-at-enter path; no special handling.
    const css = await foldToBytes(
      `@name: my-anim; @keyframes @name { from { opacity: 0; } to { opacity: 1; } }`,
      context
    );
    expect(css).toBe(`@keyframes my-anim {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}`);
  });

  it('folds a simple `@layer` byte-identical', async () => {
    const css = await foldToBytes(`@layer base { .a { color: red; } }`, context);
    expect(css).toBe(`@layer base {
  .a {
    color: red;
  }
}`);
  });

  it('folds a NESTED-NAME `@layer` byte-identical', async () => {
    const css = await foldToBytes(`@layer a { @layer b { .x { color: red; } } }`, context);
    expect(css).toBe(`@layer a {
  @layer b {
    .x {
      color: red;
    }
  }
}`);
  });

  it('folds a `@layer` with a variable resolved in its body byte-identical', async () => {
    const css = await foldToBytes(`@w: 10px; @layer base { .a { width: @w; } }`, context);
    expect(css).toBe(`@layer base {
  .a {
    width: 10px;
  }
}`);
  });

  it('folds a VAR-REF `@layer` NAME byte-identical (`@layer @ln`)', async () => {
    const css = await foldToBytes(`@ln: base; @layer @ln { .a { color: red; } }`, context);
    expect(css).toBe(`@layer base {
  .a {
    color: red;
  }
}`);
  });

  it('keeps an EXTEND-bearing `@layer` OFF the spine (layer-scoped registration is eval-pass)', () => {
    // GUARANTEE for the `@layer` fold: layer-NAME registration only scopes
    // extend-reach, and `isSpineExtendTopology` keeps ANY extend-bearing at-rule
    // body off the spine — so an extend-under-`@layer` runs on the eval path where
    // registration happens. Verified for both an in-layer extend and a cross-layer
    // extend (which must NOT reach across layers). If a future change admitted these
    // to the spine, the layer-name registration would be skipped and extend-reach
    // would break — this test trips RED first.
    const inLayer = new Parser().parse(`@layer base { .a { color: red; } .b:extend(.a) {} }`).tree;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect(isSpineEligibleRoot(inLayer as unknown as Rules, context)).toBe(false);

    const crossLayer = new Parser().parse(`@layer one { .a { color: red; } } @layer two { .b:extend(.a) {} }`).tree;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect(isSpineEligibleRoot(crossLayer as unknown as Rules, context)).toBe(false);
  });
});
