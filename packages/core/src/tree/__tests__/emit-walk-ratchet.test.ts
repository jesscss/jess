import { beforeEach, describe, expect, it } from 'vitest';
import { rules, decl, spaced, el, vardecl, ref, ruleset, sel, amp, call, list, op, dimension, num, attr, any, atrule, mixin, nil, rest } from '../index.js';
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

  it('eligibility boundary excludes AMPERSAND-APPEND (the eval-pass materialize+hoist shape)', () => {
    // `&-mod` (anonymous append) stays on the eval path — its suffix materializes
    // + hoists only via Ampersand.evalNode's appendValue path. A scoped frontier,
    // not a safety fallback. (Plain `&` composition IS admitted — see below.)
    const appendRoot = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        ruleset({ selector: sel([amp('-mod')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
      ] })
    ]);
    expect(isSpineEligibleRoot(appendRoot, context)).toBe(false);
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

  it('still EXCLUDES ROOT-LEVEL `+:` merge + conditional/`setDefined` (scoped frontier)', () => {
    // Root-level property-merge is applied on the CONTAINER descent path only, so
    // a `+:` DIRECTLY in the root body routes to the eval path (unusual shape).
    const rootMerge = rules([
      decl({ name: 'background', value: any('red') }, { assign: '+:' }),
      decl({ name: 'background', value: any('blue') }, { assign: '+:' })
    ]);
    expect(isSpineEligibleRoot(rootMerge, context)).toBe(false);

    // Conditional `?:` stays on the eval path.
    const condRoot = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        decl({ name: 'color', value: any('red') }, { assign: '?:' })
      ] })
    ]);
    expect(isSpineEligibleRoot(condRoot, context)).toBe(false);
  });

  it('EXCLUDES conditional `?:` + scope-mutating `setDefined`/`nearestOuter` (the frontier, correctness-gated)', () => {
    // `?:` (assign-if-undefined), `setDefined` (Sass !global), `nearestOuter`
    // (Jess :=) all need eval/registration-time BINDING-WRITE semantics — a
    // conditional or outer-scope cell write keyed on the frame state AT the
    // assign's position — that the spine's upfront-frame + position-gated-READ
    // model does not yet perform (it would need a read-time side table threaded
    // into `lookupScopeFrameVariable`, or incremental binding-writes during
    // descent). Admitting them WITHOUT that regresses (a `@x ?: v` after `@x: u`
    // wrongly resolves to `v` — last-wins — instead of keeping `u`). Locked here
    // so a future change can't silently admit them and regress.
    const condVar = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        vardecl({ name: 'x', value: any('red') }),
        vardecl({ name: 'x', value: any('blue') }, { assign: '?:' }),
        decl({ name: 'color', value: ref({ key: 'x' }, { type: 'variable' }) })
      ] })
    ]);
    expect(isSpineEligibleRoot(condVar, context)).toBe(false);

    const globalAssign = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        vardecl({ name: 'x', value: any('red') }, { setDefined: true })
      ] })
    ]);
    expect(isSpineEligibleRoot(globalAssign, context)).toBe(false);

    const nearestOuter = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        vardecl({ name: 'x', value: any('red') }, { nearestOuter: true })
      ] })
    ]);
    expect(isSpineEligibleRoot(nearestOuter, context)).toBe(false);
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

  it('EXCLUDES `@property` (custom-property registration is an eval-pass side effect)', () => {
    // `@property --x { … }` REGISTERS a custom property during eval — a side effect
    // the spine does not replicate. Kept on the eval path; locked here.
    const property = rules([
      atrule({ name: '@property', prelude: any('--x'), rules: [
        decl({ name: 'syntax', value: any('"<color>"') }),
        decl({ name: 'inherits', value: any('false') })
      ] })
    ]);
    expect(isSpineEligibleRoot(property, context)).toBe(false);
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

  it('EXCLUDES a mixin definition with a NESTED-CONTAINER body (deferred — eval-fallback can\'t re-descend)', () => {
    // `.m() { .inner { … } }` — a non-leaf body eval-falls-back, but the fallback's
    // resolved tree can't be re-spine-descended without losing the surface frame
    // for deeply-nested calls. Kept on the eval path.
    const root = rules([
      mixin({
        name: '.m',
        rules: [ruleset({ selector: sel([el('.inner')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })]
      }),
      ruleset({ selector: sel([el('.a')]), rules: [call({ name: ref({ key: '.m' }, { type: 'mixin' }) })] })
    ]);
    expect(isSpineEligibleRoot(root, context)).toBe(false);
  });

  it('EXCLUDES a body with BOTH a mixin call and a `+:` merge decl (merge-across-mixin deferred)', () => {
    const root = rules([
      mixin({ name: '.m', rules: [decl({ name: 'box-shadow', value: spaced([el('a')]) })] }),
      ruleset({
        selector: sel([el('.a')]),
        rules: [
          call({ name: ref({ key: '.m' }, { type: 'mixin' }) }),
          decl({ name: 'box-shadow', value: spaced([el('b')]) }, { assign: '+:' })
        ]
      })
    ]);
    expect(isSpineEligibleRoot(root, context)).toBe(false);
  });

  it('EXCLUDES a body using a mixin as a variable value / map (`@p: .m()` — mixin-as-value deferred)', () => {
    const root = rules([
      ruleset({
        selector: sel([el('.a')]),
        rules: [
          mixin({ name: '.m', rules: [decl({ name: 'text', value: spaced([el('white')]) })] }),
          vardecl({ name: 'p', value: call({ name: ref({ key: '.m' }, { type: 'mixin' }) }) })
        ]
      })
    ]);
    expect(isSpineEligibleRoot(root, context)).toBe(false);
  });
});
