import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { readFileSync } from 'fs';
import { Compiler } from '../src/index.js';
import { spineRenderCounter, Rules } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { resolveLessTestDataRoot } from './test-utils.js';

const testDataRoot = resolveLessTestDataRoot();

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

  it('extend is LIST-APPEND: an extender authored BEFORE its target still leads with the target', async () => {
    // The projectSubject sort-bug fix (OQ-D corrected): extend appends to the target's list, the
    // target's own selector LEADS unconditionally. A `.b:extend(.a)` authored BEFORE `.a` yields
    // `.a,\n.b` (target-first), NOT `.b,\n.a` (the old sort-among-contributions bug). No corpus
    // fixture exercised this (all author target-first), so it's pinned here.
    const compiler = makeCompiler();
    const src = `.b:extend(.a) {\n  color: blue;\n}\n.a {\n  color: red;\n}\n`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.b {\n  color: blue;\n}\n.a,\n.b {\n  color: red;\n}\n');
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
    expect(css).toContain(':is(.clearfix, .foo):after');
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

  it('P3 increment 7: an `&`-bearing extender (`&.sidebar4`) RESOLVES + composes via the spine (round-1 + round-2 clean)', async () => {
    // A `.type2 { &.sidebar4 { &:extend(.sidebar all) } }` extender's local `&.sidebar4` is RESOLVED
    // (scoped `&`-eval against the tracked ancestor frame) + NORMALIZED to clean atoms → the subject
    // `.sidebar` gains `.type2.sidebar4`. The normalization is what makes the round-2 fixpoint dedup
    // cleanly instead of tripping the amp-target trap (`extendAmpersandTarget` → UNSUPPORTED). Routes
    // via the spine, no eval two-walk.
    const compiler = makeCompiler();
    const src = `.sidebar {\n  width: 300px;\n}\n.type2 {\n  &.sidebar4 {\n    &:extend(.sidebar all);\n    background: red;\n  }\n}`;
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
      expect(deriveCalls).toBe(0); // no eval two-walk (round-2 fixpoint terminated cleanly, not UNSUPPORTED)
      expect(css).toContain('.sidebar,\n.type2.sidebar4'); // resolved amp composed into the subject header
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('P3 increment 7: an `&`-APPEND extender (`&-modifier`) STAYS on eval (append suffix not gather-resolvable)', async () => {
    // The gate still excludes `&`-APPEND (`&-modifier`): its anonymous suffix materializes only via
    // `Ampersand.evalNode`'s `appendValue` path (eval-pass state the gather does not reproduce). A
    // combinator `&` resolves (above); append stays on eval, byte-identical.
    const compiler = makeCompiler();
    const src = `.base {\n  color: red;\n}\n.x {\n  &-modifier {\n    &:extend(.base);\n  }\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path (amp-APPEND excluded)
    expect(css).toContain('.base');
  });

  it('P4: the FULL `extend-nest` fixture folds BYTE-IDENTICAL through the spine (gate relaxed, no eval two-walk)', async () => {
    // The extend-nest fixture FLIPS to the spine (all-less 90→91): the extend gate now admits its
    // full shape set — the `.sidebar`/`.type1 .sidebar3`/`.type2.sidebar4` nested + `&`-resolved
    // extenders (increments 2/7), the `&+&` amp-test crossing (eager `composeSelector`-reduce), the
    // PSEUDO-COMPOUND target `.button:hover` (base `.button` overridden → `&`-flow yields
    // `:is(.button, .submit):hover`), and the INERT descendant nomatch `.button :hover` (structurally
    // proven to match no subject). Renders BYTE-IDENTICAL to the ratified `extend-nest.css` through
    // the Compiler with `Rules.derive` UNCALLED (no eval two-walk / `processExtends`).
    const compiler = makeCompiler();
    const src = readFileSync(path.join(testDataRoot, 'tests-unit/extend-nest/extend-nest.less'), 'utf8');
    const expected = readFileSync(path.join(testDataRoot, 'tests-unit/extend-nest/extend-nest.css'), 'utf8');
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
      expect(css).toBe(expected); // byte-identical to the ratified v5 alpha `.css`
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('P4 #4a: the FULL `extend-selector` fixture FOLDS via the spine (expanded-mode `&`-crossing hoist landed)', async () => {
    // #4a LANDED: the last extend-selector shape — the EXPANDED-MODE `&`-crossing hoist
    // (`.header .header-nav` gains `.footer .footer-nav`, `.issue-2586-somepage .content` gains its
    // crossing extender) — folds via the spine under `collapseNesting:false`. The crossing subject is
    // diverted to the composed-hoist projection (`composeSpineSubjectHeaders`), its header emitted
    // VERBATIM, and its block RELOCATED to root (`Ruleset.isHoisted` + `spineExtendHoisted`). Combined
    // with the C1/C3 root-target folds and the `.replace` compound-target gate admission, the WHOLE
    // fixture now folds byte-identical to the ratified `extend-selector.css` (all-less 91→92). This
    // asserts the spine engages (no eval two-walk) — a regression that dropped it back to eval, or
    // mis-placed the relocated block, trips this.
    const compiler = new Compiler({
      output: { collapseNesting: false },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });
    const src = readFileSync(path.join(testDataRoot, 'tests-unit/extend-selector/extend-selector.less'), 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (no eval two-walk)
      expect(deriveCalls).toBe(0);
      // The crossing hoist relocates the nested block to root with the composed 2-branch header.
      expect(css).toContain('.header .header-nav,\n.footer .footer-nav');
      expect(css).toContain('.issue-2586-bordered,\n.issue-2586-somepage .content');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('P4: a `Rules`-wrapped STANDALONE extend does NOT force the root to eval (folds via the spine)', async () => {
    // The empty-body selector-list-extend block (`.nope, .yes:extend(.zzz all) {}`) parses as a bare
    // `Rules` node (not a `Ruleset`), which `isSpineEligibleBody` rejected — forcing the WHOLE root
    // to eval, where the nested-extender bug re-appeared: a following subject's crossing contribution
    // (`.ext` gains `:is(.a, .b) .c`) lost its descendant prefix (`.ext, .c`). Now the `Rules`-wrapped
    // standalone extend is spine-eligible (its `Extend` is gathered; its empty body emits nothing), so
    // the root folds via the spine and the crossing header is byte-correct. `.zzz` is an inert nomatch,
    // so the block itself contributes nothing.
    const compiler = new Compiler({
      output: { collapseNesting: false },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });
    const src = `.nope, .yes:extend(.zzz all) {}\n.ext { test: 1; }\n.a, .b { .c:extend(.ext all) { test: 3; } }`;
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
      // The crossing contribution keeps its descendant prefix (`:is(.a, .b) .c`, not the bare `.c`).
      expect(css).toBe('.ext,\n:is(.a, .b) .c {\n  test: 1;\n}\n.a,\n.b {\n  .c {\n    test: 3;\n  }\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('P3 increment 3: `&`-CROSSING hoists a nested subject to root with the crossing branch (header/footer)', async () => {
    // The crossing/hoist case (extend-selector.css:45-46): a nested subject `.header .header-nav`
    // gains a crossing contribution `.footer .footer-nav` (an extender nested in a DIFFERENT
    // parent). Under `collapseNesting:true` the subject block already emits at ROOT; its header is
    // overridden VERBATIM with the projected 2-branch set. Eval gets this WRONG (bare `.footer-nav`,
    // missing `.footer`) — the spine composes the full path. Nested `&:before` composes against the
    // hoisted multi-branch header via the existing `&`-flow → `:is(...)`-grouped.
    const compiler = makeCompiler();
    const src = `.header {\n  .header-nav {\n    background: red;\n    &:before { background: blue; }\n  }\n}\n.footer {\n  .footer-nav {\n    &:extend(.header .header-nav all);\n  }\n}`;
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
      expect(css).toContain('.header .header-nav,\n.footer .footer-nav');
      expect(css).toContain(':is(.header .header-nav, .footer .footer-nav):before');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('P3 increment 3: skip-compose fires ONLY for hoisted subjects — a plain nested subject is unaffected (collateral)', async () => {
    // Guardrail: a NON-hoisted nested subject (`.wrap .inner`, no extend) in the SAME document as
    // a root extend must still compose normally against its parent — the verbatim skip-compose is
    // strictly gated to `spineExtendHoisted`. No collateral.
    const compiler = makeCompiler();
    const src = `.wrap {\n  .inner {\n    color: red;\n  }\n}\n.a:extend(.b) {}\n.b {\n  color: green;\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toContain('.wrap .inner'); // nested subject composed normally (not hoisted/verbatim)
    expect(css).toContain('.b,\n.a'); // the root extend still applies
  });

  it('P4 #4a: `&`-crossing FOLDS via the spine under `collapseNesting:false` (block relocation landed)', async () => {
    // #4a LANDED: under expanded mode the crossing subject (`.header .header-nav`) is diverted to the
    // composed-hoist projection, its header emitted VERBATIM, and its block RELOCATED to root
    // (`Ruleset.isHoisted` returns true for a `spineExtendHoisted` member). Previously HELD on eval
    // (the "block already at root" precondition holds only under collapse); block relocation closes
    // that. Asserts the spine engages AND the crossing branch is composed (`.footer .footer-nav`,
    // not the eval-path bare `.footer-nav` bug).
    const compiler = new Compiler({
      output: { collapseNesting: false },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });
    const src = `.header {\n  .header-nav {\n    background: red;\n  }\n}\n.footer {\n  .footer-nav {\n    &:extend(.header .header-nav all);\n  }\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (crossing hoist folds)
    expect(css).toContain('.header .header-nav,\n.footer .footer-nav');
  });

  it('P3 (OQ-A): an INTERPOLATED class extend target resolves against the live frame at capture', async () => {
    // OQ-A (design §9): `:extend(.@{name})` must resolve `@{name}` (→ `.foo`) BEFORE matching, else
    // the raw interpolated target matches nothing and the extend silently no-ops. `Extend.runEffect`
    // now evals an interpolation-bearing target against the live frame at capture. This is an
    // EVAL-PATH fix (the byte-identical fallback + the real `.@{name}` shape); no corpus fixture
    // exercises an interpolated TARGET, so it's pinned here. RESIDUAL: attribute-VALUE interpolation
    // (`[data=@{name}]`) is a distinct attribute-selector shape (raw `@{…}` token in the value), not
    // fixed here — see the remaining-shapes map.
    const compiler = makeCompiler();
    const src = `@name: foo;\n.foo {\n  color: red;\n}\n.bar:extend(.@{name}) {\n  color: blue;\n}`;
    const css = await compiler.renderString(src, { language: 'less' });
    // The interpolated target resolved to `.foo` and the extend applied (`.foo` gains `.bar`).
    expect(css).toBe('.foo,\n.bar {\n  color: red;\n}\n.bar {\n  color: blue;\n}\n');
  });

  it('P3 (OQ-A): a LITERAL extend target is byte-unchanged (interpolation eval skipped)', async () => {
    // Guardrail: the OQ-A target-eval fires ONLY for an interpolation-bearing target; a literal
    // target skips it entirely (byte-unchanged). No collateral on the common case.
    const compiler = makeCompiler();
    const src = `.base {\n  color: red;\n}\n.derived:extend(.base) {\n  font-weight: bold;\n}`;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(css).toBe('.base,\n.derived {\n  color: red;\n}\n.derived {\n  font-weight: bold;\n}\n');
  });

  it('P4 #5: an ATTRIBUTE-VALUE interpolation (`[data=@{var}]`) resolves on the spine via the FRAME STACK', async () => {
    // A raw `@{key}` token in an `AttributeSelector` value resolved (in `AttributeSelector.eval`) via
    // `rulesParent`, which walks `.parent` — back-pointers the eval pass sets but the SPINE never
    // does. So `[data=@{attr-data}]` rendered RAW on the spine (a general bug: `.@{name}` class
    // interpolation resolves via `InterpolatedSelector.eval`, but the attribute-value token did not).
    // The fix adds a FRAME-STACK fallback (`context.rulesetFrames`, the live scope chain the spine
    // maintains) when `rulesParent` is undefined, resolving the token exactly as eval does — no
    // `.parent`. Renders `[data="test3"]` via the spine (rootRenders>0, derive=0).
    const compiler = makeCompiler();
    const src = `.attributes {\n  @attr-data: "test3";\n  [data=@{attr-data}] { c: red; }\n}`;
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (no `.parent`)
      expect(deriveCalls).toBe(0); // no eval two-walk
      // `makeCompiler` collapses nesting → `.attributes [data="test3"]`. The load-bearing assertion:
      // `@{attr-data}` RESOLVED to `test3` (not the raw `@{attr-data}`) via the frame stack.
      expect(css).toBe('.attributes [data="test3"] {\n  c: red;\n}\n');
      expect(css).not.toContain('@{');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
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

  it('folds `@property` through the spine (root-only wrap+emit, no registration side-effect, no derive)', async () => {
    // `@property` is a plain DECLARATION-bodied root-only at-rule, structurally identical
    // to `@font-face`. Its eval pass registers NOTHING into any scope or the extend-roots
    // graph — jess does no compile-time custom-property substitution (no property registry
    // exists in core), so a later `var(--x)` is emitted verbatim regardless. Verified
    // byte-identical spine-vs-eval for the bare form, a `var(--x)` consumer, and mixed
    // sibling rulesets. So folding it drops no output-affecting side-effect.
    const cases: Array<{ src: string; out: string }> = [
      {
        src: '@property --x { syntax: "<color>"; inherits: false; initial-value: red; }',
        out: '@property --x {\n  syntax: "<color>";\n  inherits: false;\n  initial-value: red;\n}\n'
      },
      {
        src: '@property --x { syntax: "<color>"; inherits: false; initial-value: red; }\n.a { color: var(--x); }',
        out: '@property --x {\n  syntax: "<color>";\n  inherits: false;\n  initial-value: red;\n}\n.a {\n  color: var(--x);\n}\n'
      }
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
        expect(spineRenderCounter.rootRenders, `routed: ${c.src}`).toBeGreaterThan(before); // spine path
        expect(deriveCalls, `no derive: ${c.src}`).toBe(0); // no eval two-walk
        expect(css, `output: ${c.src}`).toBe(c.out); // byte-identical to the eval oracle
      } finally {
        Rules.prototype.derive = originalDerive;
      }
    }
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

  it('folds a NESTED-scope mixin closure through the spine (intermediate-scope closure, fold #6, no derive)', async () => {
    // A mixin defined inside `.scope` closes over `.scope`'s local `@v`; a namespace-path
    // call `.scope > .m()` from another scope resolves the body against the DEFINITION
    // scope. Fold #6 lifted the former eval-only gate: `renderRootViaSpine` eagerly wires
    // the definition-scope `.parent` chain (`wireSpineDefinitionScopeParents`) and
    // `executeCallableCandidate` re-parents the folded surface to its lexical frame, so the
    // intermediate-scope closure resolves under the spine sink — byte-identical to eval
    // (verified spine-vs-eval: both emit `.a { width: 9px; }`), no output tree.
    const compiler = makeCompiler();
    const src = `.scope {\n  @v: 9px;\n  .m() { width: @v; }\n}\n.a {\n  .scope > .m();\n}`;
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
      expect(css).toBe('.a {\n  width: 9px;\n}\n'); // byte-identical to the eval oracle
    } finally {
      Rules.prototype.derive = originalDerive;
    }
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

  it('NESTED-CONTAINER-body mixin FOLDS through the spine byte-identical (surface descends nested containers carrying the frame, no derive)', async () => {
    // `.mix(@a) { .inner { … .innest { .mi((@a*2)) } } }` — a non-leaf body with a
    // DEEPLY-NESTED call reading the mixin's param. The captured surface's container
    // child descends via `serializeSpineFrameContainer` carrying the surface frame, so
    // its body resolves `@a` at arbitrary depth AND expands its own nested call in-pass
    // — no eval-fallback re-descent, no frame loss. Folds byte-identical to eval.
    const compiler = makeCompiler();
    const src = `.mi(@v) { border-width: @v; }\n.mix(@a: 10) { .inner { height: (@a * 10); .innest { .mi((@a * 2)); } } }\n.class { .mix(30); }`;
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
      expect(deriveCalls).toBe(0); // no eval two-walk, no output tree
      // byte-identical to the eval oracle: `@a`=30 → height 300, deeply-nested `.mi`=60
      expect(css).toBe('.class .inner {\n  height: 300;\n}\n.class .inner .innest {\n  border-width: 60;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('NESTED-CONTAINER-body: a plain-selector container + a leaf sibling folds (byte-identical, no derive)', async () => {
    const compiler = makeCompiler();
    const src = `.mix() { color: red; .inner { color: blue; } }\n.class { .mix(); }`;
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
      expect(css).toBe('.class {\n  color: red;\n}\n.class .inner {\n  color: blue;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('NESTED-CONTAINER-body: a plain-selector-child at-rule (no ancestor rewrap) folds (byte-identical)', async () => {
    // `@media { .plain { … } }` inside a mixin body — the at-rule hoists, its plain-
    // selector child composes against the call-site selector correctly (no rewrap
    // needed), so it folds. (`@media { color: … }` — a DIRECT decl needing the call-
    // site wrapper on hoist — is the DEFER case below.)
    const compiler = makeCompiler();
    const src = `.mix() { @media screen { .plain { color: green; } } }\n.class { .mix(); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('@media screen {\n  .class .plain {\n    color: green;\n  }\n}\n');
  });

  it('DEFERRED: a mixin body with an at-rule child needing CALL-SITE ancestor rewrap stays on eval (byte-identical)', async () => {
    // `@media screen { color: green }` inside the mixin body — a DIRECT declaration; on
    // hoist to root the CALL-SITE `.class` selector must re-wrap the at-rule body
    // (`@media { .class { color: green } }`). The spine hoist doesn't reproduce that
    // rewrap yet, so the whole tree stays on eval (byte-identical). REQUIRED P4 item.
    const compiler = makeCompiler();
    const src = `.mix() { color: red; @media screen { color: green; } }\n.class { .mix(); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path
    expect(css).toBe('.class {\n  color: red;\n}\n@media screen {\n  .class {\n    color: green;\n  }\n}\n');
  });

  it('DEFERRED: a mixin body containing a nested Mixin DEFINITION stays on eval (byte-identical)', async () => {
    // `.mix() { … .inner() { … } .inner() }` — a nested mixin DEFINITION in a mixin
    // body. The fold's shallow surface descent doesn't register/emit a nested def, so
    // the whole tree stays on eval (byte-identical). REQUIRED P4 item.
    const compiler = makeCompiler();
    const src = `.mix() { color: red; .inner() { color: blue; } .inner(); }\n.class { .mix(); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path
    expect(css).toBe('.class {\n  color: red;\n  color: blue;\n}\n');
  });

  it('DEFERRED: a self-recursive mixin (recursion + nested container) stays on eval (byte-identical)', async () => {
    // `.stripe(@n) when (@n>0) { a { … } .stripe(@n-1) }` — recursion via a name-cycle
    // AND a nested container. `treeHasRecursiveMixinCall` gates it to eval: a recursive
    // call's frame-dependent arg (`@n - 1`) loses the per-level param frame on the
    // recursive re-drive (`P4-TERMINAL-SINK-DESIGN.md` §7). REQUIRED P4 item.
    const compiler = makeCompiler();
    const src = `.stripe(@n) when (@n > 0) {\n  a { border-width: @n; }\n  .stripe(@n - 1);\n}\n.wrap { .stripe(2); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path
    expect(css).toContain('border-width: 2');
    expect(css).toContain('border-width: 1');
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

  // ── IMPORTS increment 1 (cutover) ──────────────────────────────────────────
  // The import fold: CSS-passthrough `@import` emits inline via the spine (no eval),
  // and a plain static-path Less `@import` descends its parsed body INLINE through
  // the spine (no `rules.eval()`, no output tree → `Rules.derive` = 0). The
  // import-work gate (§4.0) keeps a no-import render at zero import cost. Deferred
  // shapes (reference / interpolated-path / inline / multiple / optional / postlude
  // / with / compose) stay on the eval path — each a REQUIRED P4 item.

  it('IMPORTS increment 1: CSS-passthrough `@import` folds via the spine (top-of-doc, no derive)', async () => {
    const compiler = makeCompiler();
    const src = `@import "reset.css";\n.a { color: red; }`;
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
      // The CSS import emits at the top of the document, followed by the ruleset.
      expect(css).toBe('@import "reset.css";\n.a {\n  color: red;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('IMPORTS increment 1: a plain static-path Less `@import` folds its body INLINE via the spine (no derive)', async () => {
    // `import-module.less` = three plain static-path `@import "x.less"` of self-contained
    // root-level rulesets — the smallest real Less-import fold. The parsed imported bodies
    // descend INLINE through the spine (no `rules.eval()`), byte-identical to the eval path.
    const compiler = makeCompiler();
    const lessPath = path.join(testDataRoot, 'tests-unit/import/import-module.less');
    const expected = readFileSync(path.join(testDataRoot, 'tests-unit/import/import-module.css'), 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk, no output tree
      expect(result.css).toBe(expected); // byte-identical to the Less golden
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('IMPORTS increment 2: an importer that CONSUMES imported scope (var + mixin) now FOLDS via the spine (no derive)', async () => {
    // The registration-during-fold win: a root `@import` of a vars/mixins library is
    // REGISTERED into its placement frame and LINKED as an importer fallback
    // (`wireSpineImports`), so the importer's `@brand` read and `.rounded(8px)` mixin
    // call resolve against the imported scope — folding through the spine with no eval
    // two-walk. This is the common "import a library, then use it" shape.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc2-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '@brand: #3366cc;\n.rounded(@r: 4px) {\n  border-radius: @r;\n}\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "lib.less";\n.box {\n  color: @brand;\n  .rounded(8px);\n}\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // registration seeds NAMES only — no output tree
      // The imported `@brand` var and `.rounded` mixin both resolved against the linked scope.
      expect(result.css).toBe('.box {\n  color: #3366cc;\n  border-radius: 8px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 2: a NAMESPACE-PATH call over an imported namespace STAYS on eval (namespace-merge wall)', async () => {
    // `namespacing-2.less`: a LOCAL `#library` (overriding `.sizes`) plus the imported
    // `#library` (defining `.add-one`), consumed by `#library.add-one()`. Fallback-frame
    // linking makes the imported namespace resolvable but does NOT MERGE it with the
    // same-named local definition — the lookup finds the local `#library` first and never
    // falls through for a member only the imported one defines. So a tree with a
    // namespace-path call + an import stays on the eval path (byte-identical). A regression
    // that folds it throws "No matching mixins for '#library.add-one'". DEFERRED (P4):
    // cross-definition namespace merge in the fold.
    const compiler = makeCompiler();
    const lessPath = path.join(testDataRoot, 'tests-config/namespacing/namespacing-2.less');
    const before = spineRenderCounter.rootRenders;
    const result = await compiler.renderToResult(lessPath, {});
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path (namespace-merge wall)
    expect(result.css).toContain('width: 800px'); // namespace lookup resolved (eval path)
  });

  it('IMPORTS increment 3: a TRANSITIVE import var chain (main->lib->inner) folds via the spine (no derive)', async () => {
    // Transitive-wiring fix: `main.less` imports `lib.less`, which itself imports
    // `inner.less` (defining `@z`) and reads it (`@pad: @z`); `main` then reads `lib`'s
    // `@pad`. Before the fix, the nested `@import` inside `lib`'s placement body was
    // never linked into `lib`'s own frame on the spine, so `@pad: @z` threw
    // `'z' is not defined` (empty output). The wire pass now recursively wires a
    // placement body's own top-level imports into the placement frame, so the chain
    // resolves — byte-identical to the eval path (`.x { padding: 3px; }`), derive=0.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc3-transitive-'));
    fs.writeFileSync(path.join(dir, 'inner.less'), '@z: 3px;\n');
    fs.writeFileSync(path.join(dir, 'lib.less'), '@import "inner.less";\n@pad: @z;\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "lib.less";\n.x { padding: @pad; }\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      expect(result.css).toBe('.x {\n  padding: 3px;\n}\n'); // transitive `@z` resolved through the chain
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 3: an `@import` inside a RULESET registers its scope into the container frame and folds (no derive)', async () => {
    // Nested-scope registration: an `@import` inside `.card` links its imported scope
    // to `.card`'s frame (`wireSpineContainerImports` at container-enter), so a consumer
    // INSIDE `.card` (`@pad` read, `.mk()` mixin call) resolves against the container's
    // fallback chain — folding through the spine with no eval two-walk.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc3-rs-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '@pad: 10px;\n.mk() {\n  margin: 1px;\n}\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '.card {\n  @import "lib.less";\n  padding: @pad;\n  .mk();\n}\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // registration seeds NAMES only — no output tree
      expect(result.css).toBe('.card {\n  padding: 10px;\n  margin: 1px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 3: an `@import` inside `@media` registers its scope into the at-rule frame and folds', async () => {
    // The at-rule analogue: an `@import` inside `@media` links its scope to the at-rule
    // frame (`serializeSpineFrameAtRule` → `wireSpineContainerImports`), so a body
    // consumer (`@c`) resolves. Folds through the spine, byte-identical.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc3-md-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '@c: blue;\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@media screen {\n  @import "lib.less";\n  .x { color: @c; }\n}\n');
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(result.css).toBe('@media screen {\n  .x {\n    color: blue;\n  }\n}\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('IMPORTS increment 4: the SAME file imported twice at root EMITS ONCE via the spine (`once` dedup, no derive)', async () => {
    // Less `once` (default): a file imported at several positions emits its content at
    // the FIRST and is scope-only at the rest. The wire pass records each resolved path
    // (`spineEmittedImportPaths`); the second import of the same path is `dedupe`
    // (emits nothing). Folds through the spine, no eval two-walk.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc4-once-'));
    fs.writeFileSync(path.join(dir, 'imp.less'), '.imported {\n  color: green;\n}\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "imp.less";\n.a { color: red; }\n@import "imp.less";\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      // `.imported` emitted ONCE (the second `@import` is deduped, scope-only).
      expect(result.css).toBe('.imported {\n  color: green;\n}\n.a {\n  color: red;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 4: `@import (multiple)` opts back into RE-EMIT at each position', async () => {
    // `multiple` is the authored opt-out of `once`: it re-emits at every position and is
    // never recorded as the once-owner. Folds through the spine.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc4-multi-'));
    fs.writeFileSync(path.join(dir, 'imp.less'), '.imported {\n  color: green;\n}\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "imp.less";\n@import (multiple) "imp.less";\n');
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    // Emitted TWICE — `multiple` bypasses the once ledger.
    expect(result.css).toBe('.imported {\n  color: green;\n}\n.imported {\n  color: green;\n}\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('IMPORTS increment 4: `strict-imports` (dedup across root/@media/ruleset) folds byte-identically', async () => {
    // The corpus dedup fixture: `imported.less` imported at root + inside `@media` +
    // inside `.container`. Emit at root, scope-only at the nested positions. Byte-
    // identical to the Less golden `.css`.
    const compiler = makeCompiler();
    const lessPath = path.join(testDataRoot, 'tests-config/strict-imports/strict-imports.less');
    const expected = readFileSync(path.join(testDataRoot, 'tests-config/strict-imports/strict-imports.css'), 'utf8');
    const result = await compiler.renderToResult(lessPath, {});
    expect(result.css).toBe(expected);
  });

  it('IMPORTS increment 4: `import-once` corpus fixture folds via the spine, byte-identical (once + multiple + transitive dedup, no derive)', async () => {
    // The corpus once/multiple fixture: the same file imported 3× via different
    // specifiers (once → one `#import`), a transitive re-import nested inside another
    // imported file (dedups against the root one via the shared ledger), and a
    // `(multiple)` import twice (re-emits, and its NESTED `once` import re-emits too via
    // the multiple scope). Folds through the spine, byte-identical, no eval two-walk.
    const compiler = makeCompiler();
    const lessPath = path.join(testDataRoot, 'tests-unit/import/import-once.less');
    const expected = readFileSync(path.join(testDataRoot, 'tests-unit/import/import-once.css'), 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      expect(result.css).toBe(expected);
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('IMPORTS increment 4: a hoisting `@media` block followed by a root sibling now FOLDS correctly (hoist-frame reset)', async () => {
    // The hoist-frame reset landed (`finishBody` pops `frameHeaders` in lockstep with
    // `lastRenderedFrames`): a `@media {…}` that hoists and is FOLLOWED by a root
    // sibling now renders the sibling at ROOT, not wrapped in the `@media`. The former
    // `rootHasHoistingAtRuleBeforeSibling` eval-gate is REMOVED, so this folds.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc4-hoist-'));
    fs.writeFileSync(path.join(dir, 'imp.less'), '@c: blue;\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "imp.less";\n@media screen {\n  .m { color: @c; }\n}\n.after { color: black; }\n');
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (gate removed)
    expect(result.css).toBe('@media screen {\n  .m {\n    color: blue;\n  }\n}\n.after {\n  color: black;\n}\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('IMPORTS increment 1: the import-work gate is ZERO-cost when the tree has no imports', async () => {
    // A no-import render must never touch import machinery — `engageImportLayer` is
    // false, so the spine stays a pure streaming descent. (Proven indirectly: the
    // render routes via the spine and produces correct output with no import work.)
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString('.a { color: red; }', { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.a {\n  color: red;\n}\n');
  });

  // ── HOIST-FRAME RESET (spine correctness, import-independent) ───────────────
  // A root conditional-group at-rule (`@media`/`@supports`/`@container`/
  // `@starting-style`) hoists to root; after its body the spine must RESET the
  // rendered-frame stack (pop `frameHeaders` in lockstep with `lastRenderedFrames`)
  // so a FOLLOWING root child renders at root — not wrapped in the at-rule, and not
  // reusing the at-rule's cached header. This was a pre-existing spine bug (repro'd
  // with zero imports at the base tip): a second `@media` rendered under the first's
  // query. These lock the fix through the Compiler spine (derive=0).

  it('HOIST-FRAME: two `@media` blocks each render under THEIR OWN query (no derive)', async () => {
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(
        '@media screen {\n  .a { color: red; }\n}\n@media print {\n  .b { color: blue; }\n}\n',
        { language: 'less' }
      );
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      // The SECOND block is `@media print` — NOT the first block's `@media screen`.
      expect(css).toBe('@media screen {\n  .a {\n    color: red;\n  }\n}\n@media print {\n  .b {\n    color: blue;\n  }\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('HOIST-FRAME: `@media` then a root ruleset — the ruleset renders at ROOT, not under `@media`', async () => {
    const compiler = makeCompiler();
    const css = await compiler.renderString(
      '@media screen {\n  .a { color: red; }\n}\n.after { color: black; }\n',
      { language: 'less' }
    );
    expect(css).toBe('@media screen {\n  .a {\n    color: red;\n  }\n}\n.after {\n  color: black;\n}\n');
  });

  it('HOIST-FRAME: `@media` then `@media` then a root ruleset (three-way reset)', async () => {
    const compiler = makeCompiler();
    const css = await compiler.renderString(
      '@media screen {\n  .a { c: 1; }\n}\n@media print {\n  .b { c: 2; }\n}\n.c { c: 3; }\n',
      { language: 'less' }
    );
    expect(css).toBe('@media screen {\n  .a {\n    c: 1;\n  }\n}\n@media print {\n  .b {\n    c: 2;\n  }\n}\n.c {\n  c: 3;\n}\n');
  });

  it('HOIST-FRAME: `@supports` / `@container` variants reset the frame for a following sibling', async () => {
    const compiler = makeCompiler();
    const supportsCss = await compiler.renderString(
      '@supports (display: grid) {\n  .a { color: red; }\n}\n.after { color: black; }\n',
      { language: 'less' }
    );
    expect(supportsCss).toBe('@supports (display: grid) {\n  .a {\n    color: red;\n  }\n}\n.after {\n  color: black;\n}\n');
    const containerCss = await compiler.renderString(
      '@container (min-width: 1px) {\n  .a { color: red; }\n}\n.after { color: black; }\n',
      { language: 'less' }
    );
    expect(containerCss).toBe('@container (min-width: 1px) {\n  .a {\n    color: red;\n  }\n}\n.after {\n  color: black;\n}\n');
  });

  // ── IMPORTS increment 5: `(reference)` mode ────────────────────────────────
  // A `@import (reference) "lib"` REGISTERS its scope + is extend-reachable, but its
  // body emits NO output unless something extends into it. The fold descends the
  // placement as a child `Rules` carrying `referenceMode`, so the container
  // serializer suppresses plain output while a consumer (var/mixin) still resolves
  // against the registered scope.

  it('IMPORTS increment 5: a `(reference)` import REGISTERS scope but EMITS NOTHING (no derive)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc5-ref-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '.a { color: red; }\n@v: 10px;\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import (reference) "lib.less";\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      expect(result.css).toBe(''); // reference body suppressed — nothing emitted
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 5: a later rule RESOLVES a `(reference)`-imported var + mixin (scope visible, suppressed output)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc5-scope-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '@v: 10px;\n.m() { color: teal; }\n.unused { display: none; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import (reference) "lib.less";\n.x {\n  width: @v;\n  .m();\n}\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      // `@v` + `.m()` resolved against the registered reference scope; `.unused`
      // (a plain reference-body ruleset) emits nothing.
      expect(result.css).toBe('.x {\n  width: 10px;\n  color: teal;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 5: an `:extend` reaching a `(reference)`-imported selector SPECULATIVELY enters the spine then ABORTS to eval (byte-identical)', async () => {
    // IMPORT-SPEC ROUTING. An `:extend` whose TARGET lives inside an imported body is now
    // SPECULATIVELY admitted to the spine (the sync gate can't see the imported subject).
    // The post-wire re-gate resolves the placements; a `(reference)` body is NOT collected
    // as a foldable subject (reference-mode output is suppressed under different rules), so
    // the re-gate rejects and ABORTS to eval — byte-identical: the extender `.x` gains the
    // reference selector's declarations while the reference `.a` itself stays suppressed.
    // (A PLAIN, non-reference import of the same shape FOLDS through the spine — the
    // extend-through-import fold. Reference-mode reachability stays a REQUIRED P4 item.)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc5-ext-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '.a { color: red; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import (reference) "lib.less";\n.x:extend(.a) {}\n');
    const compiler = makeCompiler();
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    // Speculative entry + clean abort: output equals the eval path exactly (no double-emit).
    expect(result.css).toBe('.x {\n  color: red;\n}\n'); // extend reached the suppressed `.a`
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('IMPORT-SPEC: extend-through-import FOLDS via the spine — an `:extend` whose target is a PLAIN-imported subject (no derive)', async () => {
    // The extend-through-import fold (import-spec routing). `.x:extend(.a)` where `.a` lives in a
    // PLAIN (non-reference) imported file. The sync gate speculatively admits; the post-wire re-gate
    // collects the resolved imported ROOT-LEVEL subject `.a`, proves the topology foldable, and
    // `wireSpineExtends` descends the imported body so `.a`'s Ruleset gets the composed header
    // override `.a, .x`. Folds through the spine byte-identical to eval (no output-tree derive).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-spec-ext-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '.a {\n  color: red;\n}\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "lib.less";\n.x:extend(.a) {\n  font-size: 12px;\n}\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // routed via spine
      expect(deriveCalls).toBe(0); // true fold — no eval output tree
      expect(result.css).toBe('.a,\n.x {\n  color: red;\n}\n.x {\n  font-size: 12px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORT-SPEC: a NON-foldable extend target through an import ABORTS to eval (byte-identical, no double-emit)', async () => {
    // The clean-abort guardrail. `.x:extend(.nonexistent)` — the speculatively-admitted tree resolves
    // its imports, the re-gate finds NO subject (imported or local) the target maps to, and ABORTS to
    // eval. The abort is pre-first-byte, so the output equals eval exactly — crucially, the imported
    // `.a` and the extender `.x` each emit EXACTLY ONCE (a double-write regression would emit both twice).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-spec-abort-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '.a {\n  color: red;\n}\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "lib.less";\n.x:extend(.nonexistent) {\n  font-size: 12px;\n}\n');
    const compiler = makeCompiler();
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    expect(result.css).toBe('.a {\n  color: red;\n}\n.x {\n  font-size: 12px;\n}\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('IMPORTS increment 5: a `(reference)` import INSIDE a ruleset suppresses output but the ruleset consumes its scope', async () => {
    // Nested reference: the placement descends as a child `Rules` carrying
    // `referenceMode` inside the container body, so a reference-body ruleset (`.dead`)
    // emits nothing while the enclosing `.card` resolves the imported `@v`.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc5-nested-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '@v: 5px;\n.dead { x: 1; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '.card {\n  @import (reference) "lib.less";\n  width: @v;\n}\n');
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(result.css).toBe('.card {\n  width: 5px;\n}\n'); // `.dead` suppressed, `@v` resolved
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── IMPORTS increment 6: `optional` + `postlude` ───────────────────────────

  it('IMPORTS increment 6: a MISSING `(optional)` import folds to nothing (no error), siblings emit (no derive)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc6-opt-'));
    fs.writeFileSync(path.join(dir, 'main.less'), '@import (optional) "nope.less";\n.a { color: red; }\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      expect(result.css).toBe('.a {\n  color: red;\n}\n'); // missing optional import silently skipped
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 6: a PRESENT `(optional)` import folds normally', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc6-optp-'));
    fs.writeFileSync(path.join(dir, 'ok.less'), '.b { color: blue; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import (optional) "ok.less";\n');
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(result.css).toBe('.b {\n  color: blue;\n}\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('IMPORTS increment 6: a `postlude` wraps the folded body in `@media` (no derive)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc6-post-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '.a { color: red; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "lib.less" (min-width: 600px);\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      expect(result.css).toBe('@media (min-width: 600px) {\n  .a {\n    color: red;\n  }\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 7: `(inline)` emits the file RAW verbatim via the spine (no parse/scope/descent, no derive)', async () => {
    // `(inline)` builds the eval path's inline-source placement (an `Any` node holding
    // the raw bytes) and the spine descends that leaf — the file's text emits UNCHANGED
    // (uppercase `RED`, original spacing preserved), no reformatting. Folds, derive=0.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc7-inline-'));
    fs.writeFileSync(path.join(dir, 'x.css'), '.raw { color: RED; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import (inline) "x.css";\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      expect(result.css).toBe('.raw { color: RED; }\n'); // raw text verbatim
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 7: `(inline)` with a postlude wraps the RAW text in `@media`; a following sibling emits at root', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc7-inlinepost-'));
    fs.writeFileSync(path.join(dir, 'x.css'), '.raw { color: RED; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import (inline) "x.css" (min-width: 600px);\n.after { b: 2; }\n');
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(result.css).toBe('@media (min-width: 600px) {\n  .raw { color: RED; }\n\n}\n.after {\n  b: 2;\n}\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('IMPORTS increment 7: `import-inline` corpus fixture folds via the spine, byte-identical (no derive)', async () => {
    const compiler = makeCompiler();
    const lessPath = path.join(testDataRoot, 'tests-unit/import/import-inline.less');
    const expected = readFileSync(path.join(testDataRoot, 'tests-unit/import/import-inline.css'), 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      expect(result.css).toBe(expected);
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('IMPORT-SPEC: a FORWARD-dependent interpolated-path import (case B) SPECULATIVELY enters the spine then ABORTS to eval', async () => {
    // Interpolated-path case (B), import-spec routing. `@import "theme-@{t}.less"` where `@t` is bound
    // by a LATER import — a FORWARD dependency. The gate admits interpolated paths speculatively; the
    // wire pass attempts path eval against the live frame, `@t` is not yet bound, so `_preparePathIdentity`
    // throws `_isPathResolutionError`. The wire pass catches it and ABORTS to eval (pre-first-byte), where
    // the `_isPathResolutionError` RETRY lane reorders + resolves it. Byte-identical (eval owns the retry).
    // DEFERRED (Tier-B, sequenced): a strictly-downward spine retry/defer-and-resume for case B.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc6-interp-'));
    fs.writeFileSync(path.join(dir, 'vars.less'), '@t: "a";\n');
    fs.writeFileSync(path.join(dir, 'theme-a.less'), '.x { color: red; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "theme-@{t}.less";\n@import "vars.less";\n');
    const compiler = makeCompiler();
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    // Clean abort → byte-identical to eval (the forward-dependent path resolved via the retry lane).
    expect(result.css).toBe('.x {\n  color: red;\n}\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('IMPORT-SPEC: a DOWNWARD-resolvable interpolated-path import (case A) FOLDS via the spine (no derive)', async () => {
    // Interpolated-path case (A), import-spec routing. `@import "theme-@{t}.less"` where `@t` is bound
    // EARLIER in document order. The wire pass resolves `@{t}` against the live root frame (populated at
    // wire time), so the import FOLDS through the spine byte-identical to eval — no output-tree derive.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-spec-interpA-'));
    fs.writeFileSync(path.join(dir, 'theme-dark.less'), '.dark {\n  color: black;\n}\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@t: dark;\n@import "theme-@{t}.less";\n.main {\n  padding: 1px;\n}\n');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // routed via spine
      expect(deriveCalls).toBe(0); // true fold — no eval output tree
      expect(result.css).toBe('.dark {\n  color: black;\n}\n.main {\n  padding: 1px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('COMBINATOR SUBJECT: a `>`/`+` subject partially extended folds through the spine (in-place `:is`-wrap)', async () => {
    // EMIT header-composition for a combinator subject: a partial extend of a compound WITHIN a
    // combinator subject wraps it IN PLACE preserving the combinator (`.p > :is(.base, .ext)`),
    // installed as a SINGLE-branch header override (the no-change guard, not a branch-count guard,
    // gates the install — a single-branch in-place wrap still differs from the authored header).
    // Matcher was already oracle-identical; the gap was the EMIT install + the gate admission.
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const child = await compiler.renderString(`.p > .base {\n  color: red;\n}\n.ext:extend(.base all) {\n  x: 1;\n}`, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      expect(child).toBe('.p > :is(.base, .ext) {\n  color: red;\n}\n.ext {\n  x: 1;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('COMBINATOR TARGET: `:extend(.a + .b all)` on a combinator subject folds through the spine (append)', async () => {
    // A combinator-TARGET find (`.a + .b`) matched WHOLE against a combinator subject appends the
    // extender as a sibling branch (`.a + .b, .z`), oracle-identical. `extendTargetIsSimple` now
    // admits combinators; the subject-correspondence (root-level combinator selector) admits it.
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(`.a + .b {\n  color: red;\n}\n.z:extend(.a + .b all) {\n  x: 1;\n}`, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.a + .b,\n.z {\n  color: red;\n}\n.z {\n  x: 1;\n}\n');
  });

  it('MIXED root-compound + combinator subject: one target extends both (separate headers)', async () => {
    // The `extend.css` shape: a plain target (`.base all`) reaches BOTH a root-compound subject
    // (`div.base` → `div:is(.base, .ext)`) AND a combinator subject (`.p > .base` →
    // `.p > :is(.base, .ext)`), each installed as its own in-place-wrap header.
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(`div.base {\n  c: 1;\n}\n.p > .base {\n  c: 2;\n}\n.ext:extend(.base all) {\n  x: 1;\n}`, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('div:is(.base, .ext) {\n  c: 1;\n}\n.p > :is(.base, .ext) {\n  c: 2;\n}\n.ext {\n  x: 1;\n}\n');
  });

  it('PARTIAL SELECTOR-LIST target: `:extend(.dd, .bb all)` splits per-branch through the spine', async () => {
    // A multi-target extend — the extender extends EACH branch independently. `decodeInstructions`
    // splits only NON-partial lists; the spine gather (`pushExtendInstructions`) splits BOTH, so a
    // PARTIAL list target folds — each branch is the plain per-target extend the pipeline builds.
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(`.dd {\n  c: 1;\n}\n.bb {\n  c: 2;\n}\n.ff:extend(.dd, .bb all) {\n  x: 1;\n}`, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.dd,\n.ff {\n  c: 1;\n}\n.bb,\n.ff {\n  c: 2;\n}\n.ff {\n  x: 1;\n}\n');
  });

  it('PARTIAL WRAP of a TRAILING compound in a root-level descendant subject folds through the spine', async () => {
    // `.foo .bar` extended partially by `.ext3` on the TRAILING compound `.bar` wraps it in place
    // (`.foo :is(.bar, .ext3)`), generalizing the leading/root-single compound clauses to any level.
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(`.foo .bar {\n  display: none;\n}\n.ext3:extend(.bar all) {\n  x: 1;\n}`, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.foo :is(.bar, .ext3) {\n  display: none;\n}\n.ext3 {\n  x: 1;\n}\n');
  });

  // M8 (interpolated-selector callable). An interpolated-SELECTOR ruleset
  // (`.@{name} {}`) used as a mixin CALL target (`.foo()`). Its callable identity
  // is resolved by an eval-pass side effect (`Ruleset.prepareRegistration` →
  // `selector.eval` → `ownSelector`, which `collectCallablesFor` keys) that the
  // spine used to skip — so the tree was gated to eval. `renderRootViaSpine` now
  // replicates that registration at root-enter (`wireSpineInterpolatedSelectorCallables`,
  // gated on the shape), so the call resolves and the whole root folds. These
  // ratchet the FOLD (spine ran, byte-identical) so re-deferring to eval trips RED.
  it('M8: interpolated-selector ruleset called as a mixin folds through the spine', async () => {
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(`@name: foo;\n.@{name} { color: red; }\n.a { .foo(); }`, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    // the interpolated ruleset resolves to `.foo` (emits standalone) AND the call
    // resolves against the same registered name (folds its body at the call site).
    expect(css).toBe('.foo {\n  color: red;\n}\n.a {\n  color: red;\n}\n');
  });

  it('M8: mid-string interpolation (`.foo-@{n}`) folds through the spine', async () => {
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(`@n: bar;\n.foo-@{n} { color: red; }\n.a { .foo-bar(); }`, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.foo-bar {\n  color: red;\n}\n.a {\n  color: red;\n}\n');
  });

  it('M8: interpolated-selector ruleset with NO call still folds (registration is inert)', async () => {
    // The wiring resolves the identity even without a call — the shape-gated
    // registration must not error or change the standalone emission.
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(`@name: foo;\n.@{name} { color: red; }`, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.foo {\n  color: red;\n}\n');
  });
});
