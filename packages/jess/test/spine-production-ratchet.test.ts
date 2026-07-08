import { describe, it, expect, beforeEach } from 'vitest';
import { Compiler } from '../src/index.js';
import { spineRenderCounter, Rules } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/**
 * PRODUCTION-PATH RATCHET (cutover P2 wire-in). The core `emit-walk-ratchet`
 * tests exercise the spine via a raw `root.render`. These lock the piece that
 * was DORMANT until P2: the single-pass spine actually routing through the
 * `Compiler` render path the corpus + benchmark use.
 *
 * P1 finding: `renderTree` set `preSerializeRoot` unconditionally and the spine
 * gate requires `!preSerializeRoot`, so 0% of real renders routed through the
 * spine. P2 sets `preSerializeRoot` ONLY when a real pre-render visitor is
 * registered, so an extend-free / visitor-free eligible root routes through
 * `renderRootViaSpine` in production. A regression that re-pins the eval path
 * (re-arms `preSerializeRoot` unconditionally, or stops routing) trips these RED.
 *
 * @see docs/future/core-architecture/UNIFIED-EVAL-EMIT-DESIGN.md §4.0 (extend-work
 *   gate), §6.9 (gated pre-eval).
 * @see docs/future/core-architecture/CUTOVER-CHECKLIST.md (RATCHET governance).
 */
describe('spine PRODUCTION-path ratchet (P2 wire-in)', () => {
  const makeCompiler = () =>
    new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });

  beforeEach(() => {
    spineRenderCounter.rootRenders = 0;
  });

  it('routes an extend-free / visitor-free eligible root through the spine on the COMPILER path', async () => {
    // A plain nested ruleset with a dynamic leaf: spine-eligible, no `:extend`,
    // no registered pre-render visitor — the safe subset P2 wires live.
    const compiler = makeCompiler();
    const src = `@w: 10px;\n.a {\n  width: @w;\n  .b { color: red; }\n}`;

    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    const after = spineRenderCounter.rootRenders;

    // The production single pass ran (≥1 root routed via the Compiler).
    expect(after).toBeGreaterThan(before);
    // ...and produced the correct resolved output.
    expect(css).toContain('.a');
    expect(css).toContain('width: 10px');
    expect(css).toContain('color: red');
  });

  it('does NOT enter the eval two-walk (Rules.derive uncalled) for a wired eligible Compiler render', async () => {
    // The eval→output-tree materialization must be GONE for the wired subset.
    // `Rules.derive` (the copy-on-write output-tree surface) is the tell — it
    // fires on the eval path, never the spine.
    const compiler = makeCompiler();
    const src = `@c: red;\n.card {\n  color: @c;\n  padding: 1rem;\n}`;

    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(
      this: Rules,
      ...args: Parameters<Rules['derive']>
    ) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // routed via spine
      expect(deriveCalls).toBe(0); // no output tree materialized
      expect(css).toContain('color: red');
      expect(css).toContain('padding: 1rem');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('P3 increment 1: ROUTES a FLAT root-level `:extend` through the spine (extend folded into the pass)', async () => {
    // The P3 milestone: a root-direct-child `:extend` subject now renders THROUGH the
    // single pass — the pre-scan gathers the instruction, SOLVE/EMIT composes the subject's
    // final Or-branch header, installed as a render-local override. The spine counter MOVES
    // and `processExtends` is NOT called on this path (asserted below).
    const compiler = makeCompiler();
    const src = `.base {\n  color: red;\n}\n.derived:extend(.base) {\n  font-weight: bold;\n}`;

    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });

    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (P3)
    // The subject `.base` gained the `.derived` branch; the extender emits its own block.
    expect(css).toBe('.base,\n.derived {\n  color: red;\n}\n.derived {\n  font-weight: bold;\n}\n');
  });

  it('P3 increment 1: flat `:extend` does NOT enter the eval two-walk (Rules.derive uncalled)', async () => {
    // The extend is applied by the spine PLAN/SOLVE/EMIT, NOT the eval-path
    // gather-and-mutate `processExtends` — which runs INSIDE the eval two-walk. `Rules.derive`
    // (the copy-on-write output-tree surface) fires on that eval path and never on the spine,
    // so `derive` uncalled + the spine counter moving proves `processExtends` did not run.
    const compiler = makeCompiler();
    const src = `.base {\n  color: red;\n}\n.derived:extend(.base) {\n  font-weight: bold;\n}`;
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk → processExtends did not run
      expect(css).toBe('.base,\n.derived {\n  color: red;\n}\n.derived {\n  font-weight: bold;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('P3 increment 1: `&:extend(... all)` with a nested block folds through the spine byte-identically (extend-clearfix shape)', async () => {
    // A root-level `&:extend(.x all)` whose target has a NESTED block: the subject header
    // override (`.clearfix, .foo, .bar`) flows through the existing `&`-composition, so the
    // nested `&:after` composes against the multi-branch parent → `:is(...)`-grouped — no
    // extra nested-composition machinery. Byte-identical to the ratified alpha `.css`.
    const compiler = makeCompiler();
    const src = `.clearfix {\n  *zoom: 1;\n  &:after { content: ''; }\n}\n.foo {\n  &:extend(.clearfix all);\n  color: red;\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toContain('.clearfix,\n.foo');
    expect(css).toContain(":is(.clearfix, .foo):after");
  });

  it('P3 increment 1: a NESTED-scope `:extend` does NOT route through the spine (deferral territory → eval path)', async () => {
    // An extend nested inside a ruleset (not a root-direct child) is NOT the flat topology
    // increment 1 handles — it stays on the eval path (byte-identical), reclaimed by a later
    // increment (nested-subject interception / deferral).
    const compiler = makeCompiler();
    const src = `.wrap {\n  .base {\n    color: red;\n  }\n  .derived:extend(.base) {\n    font-weight: bold;\n  }\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path (nested extend deferred)
    expect(css).toContain('font-weight: bold');
  });

  it('P3 increment 2: a NESTED EXTENDER composes as its BUCKET PATH through the spine (`.type1 .sidebar3`)', async () => {
    // The document-wide gather (increment 2) descends nested rulesets, so a NESTED extender
    // (`.type1 { .sidebar3 { &:extend(.sidebar all) } }`) contributes its COMPOSED form
    // `.type1 .sidebar3` — NOT the bare `.sidebar3` the eval engine emits (the extend-nest bug).
    // This is the pipeline's designed fix, now live through the Compiler. The SUBJECT `.sidebar`
    // is root-level; the widening is that the EXTENDER may be nested.
    const compiler = makeCompiler();
    const src = `.sidebar {\n  width: 300px;\n}\n.sidebar2 {\n  &:extend(.sidebar all);\n  background: blue;\n}\n.type1 {\n  .sidebar3 {\n    &:extend(.sidebar all);\n    background: green;\n  }\n}`;
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      // The subject `.sidebar` gained the nested extender's COMPOSED form, not the bare fragment.
      expect(css).toContain('.type1 .sidebar3');
      expect(css).toMatch(/\.sidebar,\n\.sidebar2,\n\.type1 \.sidebar3 \{/);
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('P3 increment 2: an `&`-bearing nested extender (`&.sidebar4`) STAYS on eval (needs frame `&`-resolution)', async () => {
    // A `.type2 { &.sidebar4 { &:extend(.sidebar all) } }` extender's local `&.sidebar4` needs
    // frame `&`-resolution the direct bucket-path capture does not do — excluded by the gate,
    // stays on eval (byte-identical). A later increment resolves `&` on the gather path.
    const compiler = makeCompiler();
    const src = `.sidebar {\n  width: 300px;\n}\n.type2 {\n  &.sidebar4 {\n    &:extend(.sidebar all);\n    background: red;\n  }\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path (amp-extender excluded)
    expect(css).toContain('.sidebar');
  });

  it('routes ROOT-ONLY wrap+emit at-rules through the spine on the COMPILER path (no eval two-walk)', async () => {
    // Broadened coverage: a root that is a `@font-face` / `@keyframes` / `@page`
    // wrap+emit at-rule now renders LIVE through the spine in production, byte-
    // identical to the eval path. A regression that drops them back to eval trips
    // the counter (no move) or `Rules.derive` (fires) RED.
    const cases: Array<{ src: string; expect: string[] }> = [
      { src: '@font-face { font-family: "X"; src: url("x.woff2"); }', expect: ['@font-face', 'font-family: "X"', 'src: url("x.woff2")'] },
      { src: '@keyframes spin { 0% { top: 0; } 100% { top: 10px; } }', expect: ['@keyframes spin', '0%', 'top: 0', '100%', 'top: 10px'] },
      { src: '@page { margin: 2cm; }', expect: ['@page', 'margin: 2cm'] },
      { src: '@counter-style c { system: fixed; }', expect: ['@counter-style c', 'system: fixed'] }
    ];
    for (const c of cases) {
      const compiler = makeCompiler();
      const originalDerive = Rules.prototype.derive;
      let deriveCalls = 0;
      Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
        deriveCalls++;
        return originalDerive.apply(this, args);
      } as Rules['derive'];
      try {
        const before = spineRenderCounter.rootRenders;
        const css = await compiler.renderString(c.src, { language: 'less' });
        expect(spineRenderCounter.rootRenders, `routed: ${c.src}`).toBeGreaterThan(before);
        expect(deriveCalls, `no derive: ${c.src}`).toBe(0);
        for (const frag of c.expect) {
          expect(css, `output ${frag}: ${c.src}`).toContain(frag);
        }
      } finally {
        Rules.prototype.derive = originalDerive;
      }
    }
  });

  it('does NOT route `@property` through the spine (custom-property registration → eval path)', async () => {
    const compiler = makeCompiler();
    const src = '@property --x { syntax: "<color>"; inherits: false; initial-value: red; }';
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path
    expect(css).toContain('@property --x');
  });

  it('INCREMENT 2: folds a root-level Less `.mixin()` dot-call through the spine on the COMPILER path (mixin-ruleset, no derive)', async () => {
    // The moment of truth for increment 2: a REAL Less `mixin-ruleset` dot-call
    // (`.m()`) over a root-level Mixin definition routes through the spine in
    // production, no output tree — the first mixin shape the Less corpus exercises.
    const compiler = makeCompiler();
    const src = `.m() {\n  color: red;\n  width: 10px;\n}\n.a {\n  .m();\n}`;
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // routed via spine
      expect(deriveCalls).toBe(0); // no output tree materialized for the fold
      expect(css).toContain('color: red');
      expect(css).toContain('width: 10px');
      expect(css).not.toContain('.m('); // the call expanded, not printed
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('INCREMENT 2: folds a VAR-READING Less mixin body (closure over the definition scope) via the Compiler', async () => {
    // The frame-threaded descent resolves the mixin body's `@c` against the
    // DEFINITION scope (root) — the shape increment 1 excluded (literal-only) and
    // inc 2 unlocks; it is the fix for inc 1's `'var' is not defined` catalogue.
    const compiler = makeCompiler();
    const src = `@c: blue;\n.m() {\n  color: @c;\n}\n.a {\n  .m();\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before);
    expect(css).toContain('color: blue');
  });

  it('does NOT route a NESTED-scope mixin definition through the spine (closure/namespace → eval path)', async () => {
    // A mixin defined inside a ruleset captures its enclosing scope; folding a call
    // to it from another scope needs the definition-scope frame the spine does not
    // yet establish — deferred, stays on the eval path (byte-identical).
    const compiler = makeCompiler();
    const src = `.scope {\n  @v: 9px;\n  .m() { width: @v; }\n}\n.a {\n  .scope > .m();\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path
    expect(css).toContain('width: 9px');
  });

  it('INCREMENT 3: folds a POSITIONAL-arg Less mixin call through the spine on the COMPILER path (no derive)', async () => {
    // A `.m(@c, @w)` def called `.m(red, 10px)` binds positional args into the
    // param live-cells (matchCallableParams), resolved by the frame-threaded
    // descent — LIVE in production, no output tree.
    const compiler = makeCompiler();
    const src = `.m(@c, @w) {\n  color: @c;\n  width: @w;\n}\n.a {\n  .m(red, 10px);\n}`;
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before);
      expect(deriveCalls).toBe(0);
      expect(css).toContain('color: red');
      expect(css).toContain('width: 10px');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('INCREMENT 4/5/6: folds DEFAULT / NAMED / REST-arg Less mixin calls through the spine (no derive)', async () => {
    const cases: Array<{ src: string; expect: string[] }> = [
      // default used when omitted
      { src: `.m(@c: red, @w: 5px) { color: @c; width: @w; }\n.a { .m(); }`, expect: ['color: red', 'width: 5px'] },
      // named args, order-independent
      { src: `.m(@c: red, @w: 5px) { color: @c; width: @w; }\n.a { .m(@w: 9px, @c: blue); }`, expect: ['color: blue', 'width: 9px'] },
      // rest collects the tail
      { src: `.m(@a, @rest...) { a: @a; r: @rest; }\n.x { .m(1, 2, 3); }`, expect: ['a: 1', 'r: 2 3'] }
    ];
    for (const c of cases) {
      const compiler = makeCompiler();
      const originalDerive = Rules.prototype.derive;
      let deriveCalls = 0;
      Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
        deriveCalls++;
        return originalDerive.apply(this, args);
      } as Rules['derive'];
      try {
        const before = spineRenderCounter.rootRenders;
        const css = await compiler.renderString(c.src, { language: 'less' });
        expect(spineRenderCounter.rootRenders, `routed: ${c.src}`).toBeGreaterThan(before);
        expect(deriveCalls, `no derive: ${c.src}`).toBe(0);
        for (const frag of c.expect) {
          expect(css, `output ${frag}: ${c.src}`).toContain(frag);
        }
      } finally {
        Rules.prototype.derive = originalDerive;
      }
    }
  });

  it('does NOT route a NESTED-CONTAINER-body mixin through the spine (eval-fallback re-descent gap → eval path)', async () => {
    // `.mix() { .inner { … } }` — a non-leaf body; the eval-fallback's resolved tree
    // can't be re-spine-descended without losing the surface frame for deeply-nested
    // calls, so the whole tree stays on the eval path (byte-identical).
    const compiler = makeCompiler();
    const src = `.mi(@v) { border-width: @v; }\n.mix(@a: 10) { .inner { height: (@a * 10); .innest { .mi((@a * 2)); } } }\n.class { .mix(30); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path
    expect(css).toContain('border-width: 60'); // the deeply-nested call still emits
  });

  it('INCREMENT 7: folds GUARDED (`when`) mixin calls through the spine on the COMPILER path (no derive)', async () => {
    // Guard select-among-overloads + all-fail + default() all fold: the terminal
    // evaluates the guard before the sink, so the passing candidate folds, a failing
    // one emits nothing, and the outcome is byte-identical.
    const cases: Array<{ src: string; has: string[]; hasNot?: string[] }> = [
      // select among two guarded overloads
      { src: `.m(@x) when (@x > 0) { s: pos; }\n.m(@x) when (@x <= 0) { s: nonpos; }\n.a { .m(5); }\n.b { .m(-3); }`,
        has: ['s: pos', 's: nonpos'] },
      // all guards fail → no mixin output (sibling decl survives)
      { src: `.m(@x) when (@x > 100) { s: big; }\n.a { .m(5); color: red; }`,
        has: ['color: red'], hasNot: ['s: big'] },
      // default() fallback
      { src: `.m(@x) when (@x = 1) { s: one; }\n.m(@x) when (default()) { s: other; }\n.a { .m(1); }\n.b { .m(2); }`,
        has: ['s: one', 's: other'] }
    ];
    for (const c of cases) {
      const compiler = makeCompiler();
      const originalDerive = Rules.prototype.derive;
      let deriveCalls = 0;
      Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
        deriveCalls++;
        return originalDerive.apply(this, args);
      } as Rules['derive'];
      try {
        const before = spineRenderCounter.rootRenders;
        const css = await compiler.renderString(c.src, { language: 'less' });
        expect(spineRenderCounter.rootRenders, `routed: ${c.src}`).toBeGreaterThan(before);
        expect(deriveCalls, `no derive: ${c.src}`).toBe(0);
        for (const frag of c.has) {
          expect(css, `output ${frag}: ${c.src}`).toContain(frag);
        }
        for (const frag of c.hasNot ?? []) {
          expect(css, `no output ${frag}: ${c.src}`).not.toContain(frag);
        }
      } finally {
        Rules.prototype.derive = originalDerive;
      }
    }
  });
});
