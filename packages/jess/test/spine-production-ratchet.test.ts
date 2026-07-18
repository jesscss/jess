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

  it('EXTEND HARD-TAIL: a NESTED-scope `:extend` (exact, no match) FOLDS through the spine byte-identically', async () => {
    // RECLAIMED (extend hard-tail fold). An extend nested inside a ruleset (not a root-direct child)
    // now routes through the spine: the collapse-mode gate admits a nested-subject target
    // (`isPartialWrapOfNestedLevel`) and `composeSpineSubjectHeaders` builds the nested-child fold +
    // graft. Here `.derived:extend(.base)` is EXACT and the nested `.wrap .base` is NOT exactly `.base`,
    // so the extend fires nothing — byte-identical to less@4 (which warns `extend '.base' has no
    // matches` and emits `.wrap .base` + `.wrap .derived` as separate blocks). No eval two-walk.
    const compiler = makeCompiler();
    const src = `.wrap {\n  .base {\n    color: red;\n  }\n  .derived:extend(.base) {\n    font-weight: bold;\n  }\n}`;
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (nested extend folded)
      expect(deriveCalls).toBe(0); // no eval two-walk
      // Exact `.base` matches nothing (nested `.wrap .base` ≠ `.base`) — both blocks stay separate.
      expect(css).toMatch(/\.wrap \.base \{\n\s*color: red;\n\s*\}/);
      expect(css).toMatch(/\.wrap \.derived \{\n\s*font-weight: bold;\n\s*\}/);
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('EXTEND HARD-TAIL: `extend.less` full multi-branch/nested/append-list cluster FOLDS byte-identically (collapse mode)', async () => {
    // The full extend.less hard-tail cluster (multi-branch selector-LIST subjects `.foo .bar, .foo
    // .baz`; nested-ruleset-subject targets `.dd`/`.ee`/`.ff`; `&`-composed subject `.ext8.ext9` as an
    // extend target; combinator list branches `.ext8 + .ext9`) folds on the spine, byte-identical to
    // the eval oracle (all-less 105/0 owner-maintained expectation) with NO eval two-walk.
    const compiler = makeCompiler();
    const src = [
      '.foo .bar, .foo .baz { display: none; }',
      '.ext3, .ext4 { &:extend(.foo all); &:extend(.bar all); }',
      '.aa { color: black; .dd { background: red; } }',
      '.bb { background: red; }',
      '.ee:extend(.dd all, .bb) {}',
      '.ff:extend(.dd, .bb all) {}'
    ].join('\n');
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
      // Multi-branch descendant-list subject gains the `.ext3`/`.ext4` grafts in each position.
      expect(css).toContain(':is(.foo, .ext3, .ext4) :is(.bar, .ext3, .ext4)');
      // Nested `.dd` (`all`-extended by `.ee`) gains the `.ee` sibling child branch.
      expect(css).toMatch(/\.aa \.dd,\n\.ee \{/);
      // `.bb all` grafts `.ff` (and `.ee`'s exact `.bb` also joins the `.bb` block).
      expect(css).toMatch(/\.bb,\n\.ee,\n\.ff \{/);
    } finally {
      Rules.prototype.derive = originalDerive;
    }
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

  it('CHARSET: the FULL `charsets` fixture FOLDS through the spine, hoisting the root `@charset` to document top (mid-body + import-imported charset)', async () => {
    // `charsets.less` = `@charset "UTF-8"; @import "import/import-charset-test";` where the
    // imported file carries `@charset "ISO-8859-1"`. A root `@charset` (role-'charset' Any)
    // used to make the whole root INELIGIBLE (`isSimpleSpineLeaf` rejected it). It now folds:
    // `wireSpineCharset` pins the root's OWN first charset (source order — UTF-8) BEFORE
    // imports are wired, the emit skips it inline (`Rules._emitRulesBody` /
    // `processNodeInner`), and `renderRootViaSpine` prepends it as the document prelude
    // (`@charset` FIRST). The imported ISO charset does NOT win (the `??=` keeps the root's).
    // Byte-identical to the expected `charsets.css` (`@charset "UTF-8";`), `Rules.derive`
    // UNCALLED. A regression that drops the charset, emits it mid-body, or lets the imported
    // charset win trips this.
    const src = path.join(testDataRoot, 'tests-unit/charsets/charsets.less');
    const expected = readFileSync(path.join(testDataRoot, 'tests-unit/charsets/charsets.css'), 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = (await makeCompiler().renderToResult(src)).css;
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk
      expect(css.trim()).toBe(expected.trim()); // byte-identical: @charset "UTF-8"; hoisted first
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

  it('EXTEND HARD-TAIL (EXPANDED MODE): `extend.less` folds byte-identically via the spine (`collapseNesting:false`, no eval two-walk)', async () => {
    // The `5c6875538` fold landed the expanded-mode nested-target collapse-relocation
    // (`composeSpineSubjectHeaders`'s `isNested && !collapseNesting` full-composed-path + `ampComposed`
    // relocations) so the WHOLE `extend.less` cluster folds under `collapseNesting:false` too — NOT just
    // the collapse-mode lock above. It landed WITHOUT a `deriveCalls===0` ratchet, so a silent
    // regression-to-eval (all-less checks BYTES, not fold-status) would go uncaught. This locks it: the
    // full fixture folds via the spine, byte-identical to the ratified expanded-mode `.css`, with the
    // eval two-walk (`Rules.derive` / `processExtends`) UNCALLED.
    const compiler = new Compiler({
      output: { collapseNesting: false },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });
    const src = readFileSync(path.join(testDataRoot, 'tests-unit/extend/extend.less'), 'utf8');
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
      expect(deriveCalls).toBe(0); // no eval two-walk → the expanded-mode fold, not a silent eval fallback
      // Expanded-mode nested-target relocation: `.ext8 { .ext9 {…} }` extended → `.ext8 .ext9, .buu` at root.
      expect(css).toContain('.buu');
      expect(css).toContain('.fuu');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('EXTEND @MEDIA-SCOPE: `extend-media.less` folds byte-identically via the spine (scoped gather + cross-media `all`-propagation, no eval two-walk)', async () => {
    // @MEDIA-GATHER FOLD (this increment). An `:extend(.ext1 all)` declared inside `@media (tv)`
    // (`.tv-lowres`) / a nested `@media (hires)` (`.tv-hires`) / at root (`.all`) is scoped by the
    // wire gather's per-conditional-at-rule scope chain + the pipeline's `scopeReaches` prefix filter
    // (eval oracle §A5/A2): a media-scoped extend reaches subjects in the same or a NESTED conditional
    // body, never outside; a root extend reaches all. Byte-identical to the ratified expanded-mode
    // `extend-media.css`, folded via the spine with the eval two-walk UNCALLED. Locks the fold so a
    // regression-to-eval (all-less checks bytes, not routing) is caught.
    const compiler = new Compiler({
      output: { collapseNesting: false },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });
    const src = readFileSync(path.join(testDataRoot, 'tests-unit/extend-media/extend-media.less'), 'utf8');
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
      expect(deriveCalls).toBe(0); // no eval two-walk → the @media-scope fold, not a silent eval fallback
      // Root-scope `.all` reaches every `.ext1`; media-scope `.tv-lowres`/`.tv-hires` reach only their
      // own + nested media bodies (NOT the root `.ext2`).
      expect(css).toContain(':is(.ext1, .all) .ext2');
      expect(css).toContain(':is(.ext1, .tv-lowres, .all) .ext3');
      expect(css).toContain(':is(.ext1, .tv-lowres, .tv-hires, .all) .ext4');
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

  it('folds `@page` MARGIN-BOX at-rules through the spine (in-place wrap+emit child of `@page`, no derive)', async () => {
    // PAGE MARGIN-BOX FOLD. A margin-box at-rule (`@top-left`/`@top-center`/… — the 16
    // CSS Paged-Media §5 boxes) is a declaration-bodied, non-hoisting child of `@page`;
    // it emits IN PLACE inside the `@page` block. Before this fold the margin-box NAME
    // was rejected by `isSpineEligibleAtRule` (not in any eligible set) — the whole
    // `@page` root dropped to the eval two-walk. Now the shape folds byte-identical to
    // the eval oracle. Covers: flat `@page` + one box; `@page :first` (prelude) + box;
    // media-nested `@page` + several boxes (the media.less shape). A regression trips
    // the counter (no move) or `Rules.derive` (fires) RED.
    const cases: Array<{ src: string; out: string }> = [
      {
        src: '@page { margin: 2cm; @top-left { content: "Page " counter(page); } }',
        out: '@page {\n  margin: 2cm;\n  @top-left {\n    content: "Page " counter(page);\n  }\n}\n'
      },
      {
        src: '@page :first { margin: 3cm; @top-center { content: "First Page"; } }',
        out: '@page :first {\n  margin: 3cm;\n  @top-center {\n    content: "First Page";\n  }\n}\n'
      },
      {
        src: '@media print {\n  @page :first {\n    size: 8.5in 11in;\n    @top-left { margin: 1cm; }\n    @bottom-right-corner { margin: 1cm; }\n    @left-middle { margin: 1cm; }\n  }\n}',
        out: '@media print {\n  @page :first {\n    size: 8.5in 11in;\n    @top-left {\n      margin: 1cm;\n    }\n    @bottom-right-corner {\n      margin: 1cm;\n    }\n    @left-middle {\n      margin: 1cm;\n    }\n  }\n}\n'
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

  it('AT-RULE `&`-THROUGH-HOIST: a bare-`&` child ruleset in a nested `@media` re-wraps the ancestor selector on hoist (folds, byte-identical)', async () => {
    // `.a { color: black; @media screen { & { color: red; } &:hover { color: blue; } } }` —
    // the `@media` hoists to root and each `&`-bearing child re-materializes the ancestor
    // `.a` around its body (`@media { .a { color: red } .a:hover { color: blue } }`). On the
    // spine `getHoistedParent` recovers the enclosing ruleset frame from
    // `context.rulesetFrames` (no `.parent` back-pointer) and the composed parent selector
    // from `composedSelectorStack`, emitting the hoisted wrapper header. Byte-identical to
    // eval AND less@4. A re-deferral to eval trips the counter (no move) RED.
    const compiler = makeCompiler();
    const src = `.a {\n  color: black;\n  @media screen {\n    & { color: red; }\n    &:hover { color: blue; }\n  }\n}`;
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
      expect(css).toBe('.a {\n  color: black;\n}\n@media screen {\n  .a {\n    color: red;\n  }\n  .a:hover {\n    color: blue;\n  }\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('AT-RULE DIRECT-DECL THROUGH HOIST: a direct declaration in a nested `@supports` re-wraps the ancestor selector (folds, byte-identical)', async () => {
    // `html { @supports (display: grid) { display: grid; } }` — a DIRECT declaration inside
    // a hoisting at-rule. On hoist the ancestor `html` must wrap the decl
    // (`@supports { html { display: grid } }`). The spine's `getHoistedParent` frame-stack
    // recovery supplies the `html` wrapper header. Byte-identical to eval AND less@4.
    const compiler = makeCompiler();
    const src = `html {\n  @supports (display: grid) {\n    display: grid;\n  }\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('@supports (display: grid) {\n  html {\n    display: grid;\n  }\n}\n');
  });

  it('AT-RULE `&`-THROUGH-HOIST: an `&`-collapsing ancestor (`.inside &`) composes correctly through a nested `@supports` (folds)', async () => {
    // `.top { .inside & { @supports (x: y) { & { color: red; } } } }` — the inner `&` resolves
    // against the COMPOSED `.inside .top`, and the hoisted `@supports` wraps it
    // (`@supports { .inside .top { color: red } }`). Byte-identical to eval AND less@4.
    const compiler = makeCompiler();
    const src = `.top {\n  .inside & {\n    @supports (x: y) {\n      & { color: red; }\n    }\n  }\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('@supports (x: y) {\n  .inside .top {\n    color: red;\n  }\n}\n');
  });

  it('AT-RULE `&`-THROUGH-HOIST: a MIXED body (bare-`&` + plain-selector child + `&:hover`) composes each child on hoist (folds)', async () => {
    // `.card { @media screen { & {…} .inner {…} &:hover {…} } }` — bare-`&`→`.card`, plain
    // `.inner`→`.card .inner`, `&:hover`→`.card:hover`, all inside the hoisted `@media`.
    // Byte-identical to eval AND less@4.
    const compiler = makeCompiler();
    const src = `.card {\n  @media screen {\n    & { color: red; }\n    .inner { color: green; }\n    &:hover { color: blue; }\n  }\n}`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('@media screen {\n  .card {\n    color: red;\n  }\n  .card .inner {\n    color: green;\n  }\n  .card:hover {\n    color: blue;\n  }\n}\n');
  });

  it('MIXIN-SURFACE AT-RULE THROUGH HOIST: a DIRECT decl in a nested `@media` re-wraps the CALL-SITE selector on hoist (folds, byte-identical)', async () => {
    // `.mix() { color: red; @media screen { color: green } }` called at `.class` — the
    // `@media` hoists to root and the CALL-SITE `.class` re-wraps the direct decl
    // (`@media { .class { color: green } }`). This is the mixin-surface analogue of the
    // authored at-rule-&-through-hoist fold: the surface's at-rule child is spliced at
    // the call site, so `getHoistedParent` recovers `.class` from `context.rulesetFrames`
    // exactly as the authored path does — no call-site-specific machinery needed. Byte-
    // identical to eval AND less@4. A re-deferral to eval trips the counter RED.
    const compiler = makeCompiler();
    const src = `.mix() { color: red; @media screen { color: green; } }\n.class { .mix(); }`;
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
      expect(css).toBe('.class {\n  color: red;\n}\n@media screen {\n  .class {\n    color: green;\n  }\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('MIXIN-SURFACE AT-RULE THROUGH HOIST: a bare-`&` / `&:hover` child in a nested `@media` re-wraps the call site (folds, byte-identical)', async () => {
    // `.mix() { @media screen { & {…} &:hover {…} } }` at `.class` — each `&`-bearing
    // child re-materializes the call-site `.class` around its body inside the hoisted
    // `@media`. Byte-identical to eval AND less@4.
    const compiler = makeCompiler();
    const src = `.mix() { @media screen { & { color: red; } &:hover { color: blue; } } }\n.class { .mix(); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('@media screen {\n  .class {\n    color: red;\n  }\n  .class:hover {\n    color: blue;\n  }\n}\n');
  });

  it('MIXIN-SURFACE AT-RULE THROUGH HOIST: a mixed body (bare-`&` + plain child + `&:hover`) composes each child on hoist (folds)', async () => {
    // `.mix() { @media screen { & {…} .inner {…} &:hover {…} } }` at `.class`.
    const compiler = makeCompiler();
    const src = `.mix() { @media screen { & { color: red; } .inner { color: green; } &:hover { color: blue; } } }\n.class { .mix(); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('@media screen {\n  .class {\n    color: red;\n  }\n  .class .inner {\n    color: green;\n  }\n  .class:hover {\n    color: blue;\n  }\n}\n');
  });

  it('MIXIN-SURFACE AT-RULE ISOLATION: a param-dependent at-rule body/prelude re-resolves per call site (folds, no cross-call leak)', async () => {
    // `.emit(@m) { @media @m { value: @m } }` called at `.one` (screen) and `.two`
    // (print). The at-rule NODE is SHARED across both call-site splices; its
    // memoized `_scopeFrame` must be RE-POINTED to each call's surface frame on
    // descent (`serializeSpineFrameAtRule` per-call re-point, mirroring the container
    // path) so the body `@m` resolves to the CURRENT call's param, not the first
    // call's. A leak (`value: screen` in `.two`) trips this RED. Byte-identical to
    // eval AND less@4 (two distinct `@media` blocks, no merge).
    const compiler = makeCompiler();
    const src = `.emit(@m) { @media @m { value: @m; } }\n.one { .emit(screen); }\n.two { .emit(print); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('@media screen {\n  .one {\n    value: screen;\n  }\n}\n@media print {\n  .two {\n    value: print;\n  }\n}\n');
  });

  it('MIXIN-SURFACE ROOT-ONLY AT-RULE BUBBLE: a `@font-face` in a mixin body bubbles to root, dropping the call-site selector (folds, byte-identical)', async () => {
    // `.mix() { @font-face { font-family: x } }` at `.class` — a root-only "wrap+emit"
    // at-rule (NOT a conditional group) bubbles to root and does NOT wrap the call-site
    // selector. `AtRule.isHoisted`'s `hasRulesetAncestor` check now consults
    // `context.rulesetFrames` (a PARSED tree has no `.parent`), so the bubble fires on
    // the spine exactly as eval. Byte-identical to eval AND less@4.
    const compiler = makeCompiler();
    const src = `.mix() { @font-face { font-family: x; } }\n.class { .mix(); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('@font-face {\n  font-family: x;\n}\n');
  });

  it('DEFERRED (residual/IOU): a mixin body containing a nested Mixin DEFINITION stays on eval (byte-identical)', async () => {
    // `.mix() { … .inner() { … } .inner() }` — a nested mixin DEFINITION in a mixin
    // body. The SIMPLE shape (nested def called only WITHIN the same body) folds
    // byte-identically, but the fold cannot be lifted wholesale: a nested def can be a
    // DYNAMICALLY-CREATED callable resolved by a LATER path-call
    // (`.Person(@n) { .@{n} { .sayGender() {} } }` then `.person.sayGender()` — jess-
    // eval supports this via a `mixin-ruleset` lookup, see `mixin.test.ts` "keeps param
    // vars preferred over outer same-name vars in lazy nested mixin lookups"). Folding
    // the def away emits it inline instead of REGISTERING it, so the later lookup throws
    // `No matching mixins found`. Registering a dynamically-created nested callable
    // through the spine is a SEPARATE surface (callable registration in the fold).
    // Kept on eval, byte-identical, until that lands. REQUIRED P4 item / IOU.
    const compiler = makeCompiler();
    const src = `.mix() { color: red; .inner() { color: blue; } .inner(); }\n.class { .mix(); }`;
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBe(before); // eval path
    expect(css).toBe('.class {\n  color: red;\n  color: blue;\n}\n');
  });

  it('FOLD (§7 frame-threaded arg rung): a FLAT self-recursive mixin folds through the spine (no derive)', async () => {
    // `.mixin-recursive(@n) when (@n>0) { level: @n; .mixin-recursive(@n-1) }` — a
    // name-cycle whose body is declarations + the recursive call with a frame-dependent
    // arg. Each level's freshly-bound param frame is threaded through the recursive
    // call's arg-binding eval AND the spliced body decls' dedup-key + emit resolution
    // (`computeDeclKey` / `processNode` push the entry's `spineFrame`), so `@n - 1`
    // resolves against level N's `@n`. Byte-identical to eval / less@4, no output tree.
    const compiler = makeCompiler();
    const src = `.mixin-recursive(@n) when (@n > 0) {\n  level: @n;\n  .mixin-recursive(@n - 1);\n}\n.mixin-recursive(@n) when (@n <= 0) {\n  done: true;\n}\n.test-recursive {\n  .mixin-recursive(3);\n}`;
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
      expect(deriveCalls).toBe(0); // no output tree materialized
      expect(css).toBe('.test-recursive {\n  level: 3;\n  level: 2;\n  level: 1;\n  done: true;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('FOLD (STRIPE): a recursive mixin with a NESTED CONTAINER folds via distinct-per-level surfaces (no derive)', async () => {
    // `.stripe(@n) when (@n>0) { a { … } .stripe(@n-1) }` — recursion via a name-cycle
    // AND a nested container SHARED across levels. The re-entrant splice used to re-use
    // the same canonical `a { … }` child per level, collapsing two levels' blocks into
    // one. `distinctFoldChild` (`serialize-helper.ts`) now splices a distinct per-level
    // copy (reusing scalar leaves) on the container's 2nd+ occurrence within one
    // expansion pass — mirroring the loop fold's per-iteration `copyWithReusableLeaves` —
    // so each level emits its own `.wrap a { … }` block, byte-identical to eval / less@4
    // AND folds through the spine (no eval two-walk → `Rules.derive` = 0).
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const src = `.stripe(@n) when (@n > 0) {\n  a { border-width: @n; }\n  .stripe(@n - 1);\n}\n.wrap { .stripe(2); }`;
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk → the distinct-per-level fold, not a fallback
      // two distinct blocks (byte-identical to eval / less@4)
      expect(css).toBe('.wrap a {\n  border-width: 2;\n}\n.wrap a {\n  border-width: 1;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('FOLD (STRIPE ≥3 levels + mutual cycle): distinct-per-level container blocks (no derive)', async () => {
    // Coverage: ≥3 self-recursion levels (three distinct `.wrap a{…}` blocks with
    // color 3/2/1) and a MUTUAL cycle (`.ping`↔`.pong`, each with its own container).
    const cases: Array<{ src: string; expected: string }> = [
      {
        src: `.stripe(@n) when (@n > 0) {\n  a { color: @n; }\n  .stripe(@n - 1);\n}\n.wrap { .stripe(3); }`,
        expected: '.wrap a {\n  color: 3;\n}\n.wrap a {\n  color: 2;\n}\n.wrap a {\n  color: 1;\n}\n'
      },
      {
        src: `.ping(@n) when (@n > 0) { a { color: @n; } .pong(@n - 1); }\n.pong(@n) when (@n > 0) { b { color: @n; } .ping(@n - 1); }\n.wrap { .ping(3); }`,
        expected: '.wrap a {\n  color: 3;\n}\n.wrap b {\n  color: 2;\n}\n.wrap a {\n  color: 1;\n}\n'
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
        expect(spineRenderCounter.rootRenders, `routed: ${c.src}`).toBeGreaterThan(before);
        expect(deriveCalls, `no derive: ${c.src}`).toBe(0);
        expect(css, `output: ${c.src}`).toBe(c.expected);
      } finally {
        Rules.prototype.derive = originalDerive;
      }
    }
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

  it('IMPORTS increment 2: a NAMESPACE-PATH call over an imported namespace FOLDS via the spine (gate 12)', async () => {
    // `namespacing-2.less`: a LOCAL `#library` (overriding `.sizes`, → 800px) plus the
    // imported `#library` (defining `.add-one`), consumed by both `#library.sizes[@width]`
    // (resolves locally) and `#library.add-one(1px)[@return]` (a member ONLY the imported
    // `#library` defines). This is NOT a same-named-merge case: the local head HITS first,
    // its remainder MISSES `.add-one`, and the shared namespace-path lookup
    // (`Rules.findMixinPath`) formerly never re-tried the import `fallbackFrame` — so it
    // threw "No matching mixins for '#library.add-one'". The fix drains the fallback-frame
    // chain AFTER the primary walk misses (mirrors the plain-var `findMixin` drain), so an
    // imported namespace member resolves while a local hit still wins. The tree now FOLDS
    // through the spine, byte-identical to eval (and to less@4's `namespacing-2.css`).
    const compiler = makeCompiler();
    const lessPath = path.join(testDataRoot, 'tests-config/namespacing/namespacing-2.less');
    const before = spineRenderCounter.rootRenders;
    const result = await compiler.renderToResult(lessPath, {});
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (gate 12 folds)
    // Byte-identical to less@4 `namespacing-2.css`: local `.sizes` override (800px) + the
    // imported `.add-one` member (2px, resolved through the fallback-frame drain).
    expect(result.css).toBe(
      '.bar {\n  width: 800px;\n  height: 2px;\n}\n.foo {\n  width: 800px;\n}\n.lunch {\n  treat: ice cream;\n}\n'
    );
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

  it('IMPORTS placement POC: closed static literal `(multiple)` imports re-emit byte-identically', async () => {
    const compiler = makeCompiler();
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../benchmark/import-placement-multiple');
    for (const count of [1, 2, 4, 8]) {
      const before = spineRenderCounter.rootRenders;
      const file = path.join(root, `main-${count}x.less`);
      const result = await compiler.renderToResult(file, {});
      const less = await import('less');
      const lessResult = await less.render(fs.readFileSync(file, 'utf8'), {
        filename: file
      });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before);
      expect(result.css).toBe(lessResult.css);
    }
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

  it('IMPORTS increment 5: an `:extend` reaching a `(reference)`-imported selector FOLDS through the spine (no derive, byte-identical)', async () => {
    // REFERENCE-EXTEND FOLD (import-spec routing). An `:extend` whose TARGET lives inside a
    // `@import (reference)` body is SPECULATIVELY admitted (the sync gate can't see the imported
    // subject). The post-wire re-gate now COLLECTS the reference-body subject (`.a`) and marks it
    // `reference` in `wireSpineExtends`; its header projection DROPS the own form (branch 0 —
    // the eval-path `F_EXTEND_TARGET` reference-filter), installing the extender-only header (`.x`).
    // The container serializer render-enables the reference ruleset because it carries a spine
    // extend header (the reference-unlock signal), so it emits its declarations under `.x` — the
    // reference `.a` never surfaces on its own. Byte-identical to eval, no eval two-walk.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc5-ext-'));
    fs.writeFileSync(path.join(dir, 'lib.less'), '.a { color: red; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import (reference) "lib.less";\n.x:extend(.a) {}\n');
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
      expect(result.css).toBe('.x {\n  color: red;\n}\n'); // extend reached the suppressed `.a`
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORTS increment 5: an `:extend(.a all)` reaching a `(reference)` subject folds; the reference target stays suppressed (no derive)', async () => {
    // The `all`-partial variant + a following own-body extender block (the `ref-main` corpus shape).
    // `.ext:extend(.target all) { background: blue; }` against a reference `.target { color: red }`.
    // The reference `.target` is dropped from the header (own-form suppressed); its `color: red`
    // emits under `.ext`, then `.ext`'s own `background: blue` emits separately — byte-identical to
    // eval, no derive.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc5-refall-'));
    fs.writeFileSync(path.join(dir, 'ref-base.less'), '.target { color: red; }\n');
    fs.writeFileSync(
      path.join(dir, 'main.less'),
      '@import (reference) "ref-base.less";\n.ext:extend(.target all) { background: blue; }\n'
    );
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(deriveCalls).toBe(0); // true fold — no eval output tree
      expect(result.css).not.toContain('.target'); // reference target never surfaces on its own
      expect(result.css).toBe('.ext {\n  color: red;\n}\n.ext {\n  background: blue;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

  it('IMPORT-SPEC: TRANSITIVE extend-through-import FOLDS via the spine — the imported body carries its OWN `:extend` (`.c ← .b ← .a`, no derive)', async () => {
    // The transitive cross-import closure. `.b:extend(.c)` lives in the imported file and
    // `.a:extend(.b)` in the main file. The SOLVE fixpoint runs over the union of local +
    // imported instructions: `.c`→`.c,.b` then `.a` matches the now-present `.b`→`.c,.b,.a`.
    // The key fold (extend-through-import): an imported body carrying its OWN `:extend` is now
    // spine-foldable when the extend layer is engaged (`isSpineFoldableImportBody(body, true)`),
    // so `wireSpineExtends` descends the SAME imported Ruleset node instances the emit fold emits
    // — the composed header override (`.c`→`.c,.b,.a`, `.b`→`.b,.a`) lands via
    // `effectiveHeaderSelector`. Previously the extend-bearing imported body fell to the eval
    // terminal (fresh nodes → override missed → NO cross-import extend). Byte-identical to less@4,
    // no eval output-tree derive.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-spec-ext-transitive-'));
    fs.writeFileSync(path.join(dir, 'base.less'), '.c { color: red; }\n.b:extend(.c) { background: blue; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "base.less";\n.a:extend(.b) { font-weight: bold; }\n');
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
      expect(result.css).toBe(
        '.c,\n.b,\n.a {\n  color: red;\n}\n.b,\n.a {\n  background: blue;\n}\n.a {\n  font-weight: bold;\n}\n'
      );
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

  it('IMPORT-SPEC: a FORWARD-dependent interpolated-path import (case B) FOLDS via the spine (defer + retry, no derive)', async () => {
    // Interpolated-path case (B), import-spec routing. `@import "theme-@{t}.less"` where `@t` is bound
    // by a LATER import — a FORWARD dependency. The gate admits interpolated paths speculatively; the
    // wire pass attempts path eval against the live frame, `@t` is not yet bound, so `_preparePathIdentity`
    // throws `_isPathResolutionError`. The wire pass DEFERS the failing import (mirroring the eval loop's
    // `pendingImports` reorder), wires the rest — `vars.less` binds `@t` into the live frame — then RETRIES
    // the deferred import, which now resolves `theme-@{t}` → `theme-a.less` and FOLDS through the spine.
    // Byte-identical to eval, no output-tree derive. (Only a GENUINELY unresolvable path — the var never
    // binds — still aborts to eval on the final drain.)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc6-interp-'));
    fs.writeFileSync(path.join(dir, 'vars.less'), '@t: "a";\n');
    fs.writeFileSync(path.join(dir, 'theme-a.less'), '.x { color: red; }\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "theme-@{t}.less";\n@import "vars.less";\n');
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
      expect(deriveCalls).toBe(0); // true fold — no eval two-walk
      expect(result.css).toBe('.x {\n  color: red;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORT-SPEC: a case-B interpolated-path import with an `(inline)` sub-import FOLDS byte-identically', async () => {
    // The deferred import is retried after `vars.less` binds `@t`; its inline child
    // emits from a nested import-fold closure. The writer-level boundary bit carries
    // that inline-source fact to the following `.k` block, preserving eval's blank line
    // without falling back to the two-walk derive path.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc6-interp-inline-'));
    fs.writeFileSync(path.join(dir, 'vars.less'), '@t: "x";\n');
    fs.writeFileSync(path.join(dir, 'raw.less'), '#logo {\n  w: 1px;\n}\n');
    fs.writeFileSync(path.join(dir, 'theme-x.less'), '@import (inline) "raw.less";\n.k {\n  c: 1;\n}\n');
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "theme-@{t}.less";\n@import "vars.less";\n');
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
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before);
      expect(deriveCalls).toBe(0);
      expect(result.css).toBe('#logo {\n  w: 1px;\n}\n\n.k {\n  c: 1;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IMPORT-SPEC: a GENUINELY-unresolvable interpolated-path import stays byte-identical to eval (final-drain abort)', async () => {
    // RESIDUAL of the case-B defer/retry fold. `@import "theme-@{nope}.less"` where `@nope` is NEVER
    // bound (no later import supplies it). The wire pass defers the failing import, drains the rest
    // (nothing binds `@nope`), then RE-THROWS `_isPathResolutionError` on the final non-retry drain —
    // exactly as eval's `drainPendingImports(false)` does. The re-thrown error surfaces at `onWireError`
    // and aborts to eval (pre-first-byte), so the output equals eval by construction. Locks the abort
    // lane: a genuinely-unresolvable path is NOT silently folded to empty by the spine — eval owns it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-inc6-unresolvable-'));
    fs.writeFileSync(path.join(dir, 'main.less'), '@import "theme-@{nope}.less";\n.y {\n  a: 1;\n}\n');
    const compiler = makeCompiler();
    const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
    // Eval oracle: an unbound interpolation var in a path drops the whole render to empty (unchanged
    // from the base tip — established eval behavior, not a spine artifact).
    expect(result.css).toBe('');
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

  // v5 extend-`all` sub-span `:is()` wrapping (task #30). `:extend(TARGET all)`
  // matches TARGET by COMPOUND-SUBSET against existing selectors (each TARGET
  // compound ⊆ the aligned selector compound, combinators aligned) and unions the
  // extending selector with the matched span: WHOLE-selector match → comma-append;
  // MID-complex sub-span → `:is(<span>, <ext>)` in place, surrounding combinator
  // context preserved verbatim on BOTH sides. Supersedes 4.x, which refuses a
  // complex-selector subset match (`WARNING: extend '.a > .c' has no matches`).
  // (Task prose writes `.a > .c { &:extend(.x all); }`; that transposes `&`/arg —
  // in standard Less it searches `.x` and finds nothing. The coherent direction,
  // required by `.zoo`/`.zap` too, searches TARGET and unions the extender.)
  // These lock the rendered OUTPUT (behavior ratchet), not the internal path: a
  // compound-SUBSET complex extend is conservatively routed to eval by the spine
  // work-gate (byte-correct either way), so — unlike the whole-EXACT case below,
  // which folds on the spine — they do not assert `rootRenders`.
  it('SUB-SPAN #30: whole-selector compound-subset match comma-appends', async () => {
    // `.a > .c` compound-subset-matches the ENTIRE `.a.b > .c.d` → plain sibling.
    const css = await makeCompiler().renderString(`.a.b > .c.d {\n  color: red;\n}\n.x:extend(.a > .c all) {}`, { language: 'less' });
    expect(css).toBe('.a.b > .c.d,\n.x {\n  color: red;\n}\n');
  });

  it('SUB-SPAN #30: mid-complex sub-span wraps `:is()` in place, BOTH-sides context preserved', async () => {
    // Matched span `.a.b > .c.d` sits between `div +` and `~ .child`; only the span
    // is replaced by `:is(span, .x)`, both sides verbatim.
    const css = await makeCompiler().renderString(`div + .a.b > .c.d ~ .child {\n  color: red;\n}\n.x:extend(.a > .c all) {}`, { language: 'less' });
    expect(css).toBe('div + :is(.a.b > .c.d, .x) ~ .child {\n  color: red;\n}\n');
  });

  it('SUB-SPAN #30: whole-selector EXACT combinator match comma-appends via the spine (no `:is()`)', async () => {
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(`.a > .c {\n  color: red;\n}\n.x:extend(.a > .c all) {}`, { language: 'less' });
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.a > .c,\n.x {\n  color: red;\n}\n');
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

  // MIXIN-AS-VALUE / detached-ruleset argument (FOLDED). A mixin call passing a
  // detached ruleset — by REFERENCE (`.wrap(@ruleset)`) or as a NAMED block arg
  // (`.wrap(@r: { … })`) — used to silently MIS-FOLD to EMPTY output: the outer
  // call passed the static gate, its non-simple surface was rejected to the eval
  // terminal, but the still-live surface sink intercepted the NESTED `@r()`
  // detached-call resolution and dropped its output. The sink is now SUSPENDED
  // across a rejected candidate's `rules.eval` fall-back (callable-candidate-output.ts),
  // so the nested detached-ruleset call materializes its own output. The root folds
  // through the spine; the detached-ruleset-arg call takes the eval-fallback rung
  // (byte-identical to the pure-eval oracle). A regression re-corrupting the nested
  // call (empty output) trips these RED.
  it('MIXIN-AS-VALUE: detached-ruleset by REFERENCE folds through the spine (no empty-output mis-fold)', async () => {
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(
      `@ruleset: {\n  color: black;\n}\n.wrap(@r) {\n  @r();\n}\n.a {\n  .wrap(@ruleset);\n}`,
      { language: 'less' }
    );
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.a {\n  color: black;\n}\n');
  });

  it('MIXIN-AS-VALUE: detached-ruleset as a NAMED block arg folds through the spine', async () => {
    const compiler = makeCompiler();
    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(
      `.wrap(@r) {\n  @r();\n}\n.a {\n  .wrap(@r: {\n    color: red;\n  });\n}`,
      { language: 'less' }
    );
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
    expect(css).toBe('.a {\n  color: red;\n}\n');
  });

  // Property-MERGE fold: BOTH comma (`+:`) and space (`+_:`) same-body merge chains
  // coalesce on the single pass (no eval two-walk), byte-identical to the eval
  // oracle. Before this, only space folded — the raw comma assign `+,:` was missing
  // from the spine's `MERGE_ASSIGNS` (emit-walk) and the `spine-merge` recognizer, so
  // a comma-merge body silently routed to eval. A regression re-dropping `+,:` from
  // either set trips this RED (derive != 0).
  it('PROPERTY-MERGE: comma `+:` folds through the spine (Rules.derive uncalled)', async () => {
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
        `.r {\n  transform+: a;\n  transform+: b;\n}`,
        { language: 'less', suppressWarnings: true }
      );
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // folded — no eval two-walk
      expect(css).toBe('.r {\n  transform: a, b;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('PROPERTY-MERGE: space `+_:` folds through the spine (Rules.derive uncalled)', async () => {
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
        `.r {\n  transform+_: a;\n  transform+_: b;\n}`,
        { language: 'less', suppressWarnings: true }
      );
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // folded — no eval two-walk
      expect(css).toBe('.r {\n  transform: a b;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  // A `$prop` read of a merged property, resolved MID-emit on the spine, must see the
  // coalesced value (the anchor's combined chain), not the last merge sibling's own
  // truncated value. Folds (derive=0); a regression on the context merge-plan hookup
  // trips this RED (`foo` reads `b` / `a` only).
  it('PROPERTY-MERGE: a $ref reads the coalesced merged value on the spine (space + comma)', async () => {
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const space = await compiler.renderString(
        `.r {\n  transform+_: a;\n  transform+_: b;\n  foo: $transform;\n}`,
        { language: 'less', suppressWarnings: true }
      );
      const comma = await compiler.renderString(
        `.s {\n  transform+: a;\n  transform+: b;\n  foo: $transform;\n}`,
        { language: 'less', suppressWarnings: true }
      );
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // folded — no eval two-walk
      expect(space).toBe('.r {\n  transform: a b;\n  foo: a b;\n}\n');
      expect(comma).toBe('.s {\n  transform: a, b;\n  foo: a, b;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  // LEAKY forward-propagation FOLD (gate 9 lifted). In leaky Less mode a mixin
  // body's plain `@x: …` VarDeclaration leaks into the CALLER scope; a same-scope
  // consumer reads it. The spine now folds this (caller-frame binding injection),
  // byte-identical to less@4. A regression that drops the injection trips these RED.
  it('LEAKY: a mixin-body var leaks into the caller ruleset (later consumer folds via the spine)', async () => {
    const compiler = makeCompiler();
    const css = await compiler.renderString(
      `.m() {\n  @x: 10px;\n}\n.a {\n  .m();\n  width: @x;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    // eval + less@4 oracle: `.a { width: 10px; }`.
    expect(css).toBe('.a {\n  width: 10px;\n}\n');
  });

  it('LEAKY: a leaked var is visible to an EARLIER caller sibling (Less lazy scope, not source-order gated)', async () => {
    const compiler = makeCompiler();
    const css = await compiler.renderString(
      `.m() {\n  @x: 10px;\n}\n.a {\n  width: @x;\n  .m();\n}`,
      { language: 'less', suppressWarnings: true }
    );
    // less@4: the whole scope resolves `@x` last-wins → `10px`.
    expect(css).toBe('.a {\n  width: 10px;\n}\n');
  });

  it('LEAKY: a PARAM-dependent leak (`@x: @a`) reads the bound param through the fold', async () => {
    const compiler = makeCompiler();
    const css = await compiler.renderString(
      `.m(@a) {\n  @x: @a;\n}\n.a {\n  .m(20px);\n  width: @x;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    // less@4: `.a { width: 20px; }`.
    expect(css).toBe('.a {\n  width: 20px;\n}\n');
  });

  it('LEAKY: a ROOT-level mixin call leaks into a later root SIBLING ruleset', async () => {
    const compiler = makeCompiler();
    const css = await compiler.renderString(
      `.setH() {\n  @height: 1024px;\n}\n.setH();\n.heightIsSet {\n  height: @height;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    // less@4: `.heightIsSet { height: 1024px; }` (the mixin def + call emit nothing).
    expect(css).toBe('.heightIsSet {\n  height: 1024px;\n}\n');
  });

  it('LEAKY: the leak is SCOPED to the calling ruleset (a later out-of-scope sibling sees the outer binding)', async () => {
    const compiler = makeCompiler();
    const css = await compiler.renderString(
      `@x: 1px;\n.a {\n  width: @x;\n}\n.m() {\n  @x: 10px;\n}\n.b {\n  .m();\n  width: @x;\n}\n.c {\n  width: @x;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    // less@4: `.b` sees the leak (`10px`); `.a`/`.c` see the outer `@x` (`1px`).
    expect(css).toBe('.a {\n  width: 1px;\n}\n.b {\n  width: 10px;\n}\n.c {\n  width: 1px;\n}\n');
  });

  it('LEAKY: a folded leak does NOT enter the eval two-walk (Rules.derive uncalled for the container-body shape)', async () => {
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
        `.m() {\n  @x: 10px;\n}\n.a {\n  .m();\n  width: @x;\n}`,
        { language: 'less', suppressWarnings: true }
      );
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // true fold — no eval output tree
      expect(css).toBe('.a {\n  width: 10px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('NON-LEAKY (strict scope): a mixin-body var does NOT leak — the consumer is unresolved', async () => {
    const strictCompiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin({ leakyScope: false }), lessCompatPlugin({})] }
    });
    await expect(
      strictCompiler.renderString(
        `.m() {\n  @x: 10px;\n}\n.a {\n  .m();\n  width: @x;\n}`,
        { language: 'less', suppressWarnings: true }
      )
    ).rejects.toThrow(/not defined/);
  });

  it('GUARD-FOLD: the FULL `namespacing-7` fixture (bare-`&` `when` ruleset guards) FOLDS byte-identically (derive=0)', async () => {
    // `namespacing-7.less`: root-level `& when (#ns.options[option])` / `& when (@ns[@options][option])`
    // guarded rulesets (both static-namespace `#ns` and detached-ruleset `@ns` lookups), including
    // `= true` (pass) and `= false` (fail → NO output) branches. The guard is evaluated at DESCENT
    // against the enclosing frame — exactly as `Ruleset.evalNode`'s definition-time guard eval
    // (`Condition.evaluateBoolean` / `resultPasses`) — so a failing branch (`.no-reach`/`.dr-no-reach`)
    // emits nothing and a passing one descends its body, byte-identical to eval / less@4's
    // `namespacing-7.css`, with NO eval two-walk.
    const compiler = makeCompiler();
    const lessPath = path.join(testDataRoot, 'tests-config/namespacing/namespacing-7.less');
    const expected = readFileSync(path.join(testDataRoot, 'tests-config/namespacing/namespacing-7.css'), 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (guard fold)
      expect(deriveCalls).toBe(0); // no eval two-walk → the guard-fold, not a silent eval fallback
      expect(result.css).toBe(expected); // byte-identical: `= false` branches suppressed
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('GUARD-FOLD: ruleset-level `when` PASS/FAIL + NESTED guarded rulesets FOLD byte-identically (derive=0)', async () => {
    // A `when`-guarded ruleset folds on the spine: PASS descends the body, FAIL emits nothing —
    // at root AND nested, byte-identical to the eval path. The guard eval mirrors
    // `Ruleset.evalNode` exactly (`Condition.evaluateBoolean`), so no eval output-tree is
    // materialized (`derive` uncalled). A NAMED guarded ruleset (`.wrap when`) and a bare-`&`
    // guarded ruleset both fold.
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const src = [
        '@opt: true;',
        '@off: false;',
        '.pass when (@opt) { color: red; }',        // PASS at root
        '.fail when (@off) { color: blue; }',        // FAIL at root → no output
        '.a {',
        '  .nested-pass when (@opt) { c: d; }',      // PASS nested
        '  .nested-fail when (@off) { c: e; }',      // FAIL nested → no output
        '  e: f;',
        '}'
      ].join('\n');
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less', suppressWarnings: true });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // true fold — no eval output tree
      expect(css).toBe('.pass {\n  color: red;\n}\n.a .nested-pass {\n  c: d;\n}\n.a {\n  e: f;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('NESTED-DEF (keystone 6b): `namespacing-4` (static namespace-path nested def `#library.core.colors`) FOLDS byte-identically (derive=0)', async () => {
    // `namespacing-4.less`: `#library { .core() { .colors() { … } } }` — a mixin DEFINITION
    // nested inside `.core()`, reached ONLY through the STATIC authored-namespace path
    // `#library.core.colors()`. `findMixinPath` resolves the path by walking authored
    // container scopes (the gate-12 fallback drain) with NO dynamic per-scope registration,
    // so the call resolves during the fold. `treeHasUnfoldableContainerBodyMixin` no longer
    // defers a nested def whose only reachable calls are clean authored-namespace paths.
    const compiler = makeCompiler();
    const lessPath = path.join(testDataRoot, 'tests-config/namespacing/namespacing-4.less');
    const expected = readFileSync(path.join(testDataRoot, 'tests-config/namespacing/namespacing-4.css'), 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (nested-def fold)
      expect(deriveCalls).toBe(0); // no eval two-walk → true fold, not a silent eval fallback
      expect(result.css).toBe(expected); // byte-identical to eval / less@4
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('NESTED-DEF (keystone 6b): `namespacing-3` (namespaced nested `.mixin` + detached-ruleset maps) FOLDS byte-identically (derive=0)', async () => {
    // `namespacing-3.less`: `#ns { .mixin() { @height: 200px } }` consumed by a map-lookup
    // (`#ns.mixin[@height]`), plus detached-ruleset maps (`@map: { … @colors: { … } }`) — the
    // nested `@colors` is a NAMELESS Mixin (a map-lookup value), NOT a callable needing
    // registration, so it no longer forces eval. All nested-def reachability is via static
    // namespace-path / map-lookup, so the tree folds on the spine.
    const compiler = makeCompiler();
    const lessPath = path.join(testDataRoot, 'tests-config/namespacing/namespacing-3.less');
    const expected = readFileSync(path.join(testDataRoot, 'tests-config/namespacing/namespacing-3.css'), 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (nested-def fold)
      expect(deriveCalls).toBe(0); // no eval two-walk → true fold
      expect(result.css).toBe(expected); // byte-identical to eval / less@4
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('NESTED-DEF RESIDUAL (keystone 6b boundary): a LEAKY bare-name nested-def call stays on eval (byte-identical)', async () => {
    // The residual boundary: a nested def reached by a BARE (single-segment) re-registered
    // name (`.lock-mixin(1)` leaks `.inner-locked-mixin` into the caller scope, then a sibling
    // `.inner-locked-mixin()` resolves it) needs DYNAMIC per-scope registration the spine
    // surface descent does not perform. `treeHasUnfoldableContainerBodyMixin` keeps such a
    // tree on eval — byte-identical, NOT a silent fold. `derive` fires (the eval two-walk ran).
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const src = [
        '.lock-mixin(@a) {',
        '  .inner-locked-mixin(@x: @a) when (@a = 1) { a: @a; x: @x; }',
        '}',
        '.call-lock-mixin {',
        '  .lock-mixin(1);',
        '  .call-inner-lock-mixin { .inner-locked-mixin(); }',
        '}'
      ].join('\n');
      const css = await compiler.renderString(src, { language: 'less', suppressWarnings: true });
      expect(deriveCalls).toBeGreaterThan(0); // eval two-walk ran — residual, not a fold
      expect(css).toContain('a: 1');
      expect(css).toContain('x: 1');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('RUNG-1 (detached-ruleset call): a bound-mixin-call `@alias()` FOLDS byte-identically (derive=0)', async () => {
    // The mixin-as-value fold (`528d465fc`) left the detached-ruleset CALL itself eval-routed.
    // `@alias: .something(foo); @alias();` — the variable resolves to a detached-ruleset value
    // (here a bound mixin-call surface), then `@alias()` calls it. The Less parser shapes the
    // call as an `Expression` wrapping a `variable`-Reference `Call`; the spine now unwraps it
    // (`unwrapDetachedRulesetCall`), gates the inner call as a mixin call, and drives it through
    // the SAME `resolveSpineMixinCall` sink — the resolved surface folds inline, no output tree.
    const compiler = makeCompiler();
    const src = [
      '.something(foo) { width: 10px; }',
      '.rule-1 {',
      '  @alias: .something(foo);',
      '  @alias();',
      '}'
    ].join('\n');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (DR-call fold)
      expect(deriveCalls).toBe(0); // no eval two-walk → true fold
      expect(css).toBe('.rule-1 {\n  width: 10px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('RUNG-1 (detached-ruleset call): a literal detached-ruleset `@r()` FOLDS byte-identically (derive=0)', async () => {
    // The functions-corpus shape: `@r: { c: 3 }; @r();` — a LITERAL detached ruleset bound to a
    // variable then called. Resolves to a `Rules` surface routed through the callable
    // special-case "detached ruleset called from a variable" arm, which now hands the wired
    // surface to the spine sink instead of eval-materializing it.
    const compiler = makeCompiler();
    const src = [
      '.host {',
      '  @r: { c: 3; };',
      '  @r();',
      '}'
    ].join('\n');
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
      expect(deriveCalls).toBe(0); // literal detached-ruleset call folds through the sink
      expect(css).toBe('.host {\n  c: 3;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('DRARG-1 (detached ruleset passed as a mixin ARG): a variable-aliased DR arg FOLDS byte-identically (derive=0)', async () => {
    // `namespacing-6` rule-2: a detached-ruleset value passed AS a mixin arg
    // (`.wrapper(@alias)`, where `@alias: .something(foo)`). Arg-binding used to CLONE
    // the bound `Rules` value (`cloneDefinedBoundValue` → `cloneBoundValue` → `Rules.clone`
    // → derive) and the param-var reference READ cloned it again (`evaluateReferenceValueNode`
    // → `cloneForPlacement` → derive) — two eval-route clones. The DR closes over the surface
    // where it was WRITTEN (`_closureScope`, captured at arg-binding), so neither clone added
    // isolation the call path needs. `cloneBoundValue` now binds the Rules surface directly and
    // the param-var read routes through the shared-children preserved surface, folding onto the
    // spine (`derive === 0`).
    const compiler = makeCompiler();
    const src = [
      '.wrapper(@another-mixin) { @another-mixin(); }',
      '.something(foo) { width: 10px; }',
      '.rule-2 {',
      '  @alias: .something(foo);',
      '  .wrapper(@alias);',
      '}'
    ].join('\n');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const css = await compiler.renderString(src, { language: 'less' });
      expect(deriveCalls).toBe(0); // DR-arg binding + read fold onto the spine
      expect(css).toBe('.rule-2 {\n  width: 10px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('DRARG-1 (inline DR-call as a mixin ARG): a literal `.mixin(.dr())` arg FOLDS byte-identically (derive=0)', async () => {
    // `namespacing-6` rule-3: the detached-ruleset value is produced INLINE at the call site
    // (`.wrapper(.something(foo))` / `.wrapper(.output-height())`) rather than aliased through a
    // variable — the arg is the evaluated DR-call result, bound to the callee's param and called.
    // Same fold: no bind-time clone, param-var read through the preserved surface (`derive === 0`).
    const compiler = makeCompiler();
    const src = [
      '.wrapper(@another-mixin) { @another-mixin(); }',
      '.something(foo) { width: 10px; }',
      '.output-height() { height: 10px; }',
      '.rule-3 {',
      '  .wrapper(.something(foo));',
      '  .wrapper(.output-height());',
      '}'
    ].join('\n');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const css = await compiler.renderString(src, { language: 'less' });
      expect(deriveCalls).toBe(0); // both inline DR-call args fold onto the spine
      expect(css).toBe('.rule-3 {\n  width: 10px;\n  height: 10px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('LOOP-1 (each/$for): a container-nested `each(list, {…})` loop FOLDS byte-identically (derive=0)', async () => {
    // `each(list, {…})` and `$for` both parse to a `For` node. A loop nested in a
    // ruleset/at-rule now folds on the spine: `runSpineForExpansion` produces one
    // bound-body surface per iteration (`For.spineIterationSurfaces`) and splices its
    // children with the `@value`/`@key`/counter frame, so the loop-variable-bound
    // decls resolve in-pass — no eval two-walk (`Rules.derive` = 0). An INTERPOLATED
    // decl name (`item-@{value}`) resolves via the surface's registration prep.
    const compiler = makeCompiler();
    const src = '.paren-escapes {\n  each(~(1 2 3); {\n    item-@{value}: @value + 3;\n  })\n}';
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (loop fold)
      expect(deriveCalls).toBe(0); // loop iterations spliced on the spine, no output tree
      expect(css).toBe('.paren-escapes {\n  item-1: 4;\n  item-2: 5;\n  item-3: 6;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('LOOP-1 (merge across iterations): an `each(list, {p+_: …})` loop coalesces to ONE property, folded (derive=0)', async () => {
    // The `starting-style` shape: each iteration emits a space-merge decl (`padding+_:`)
    // and all iterations coalesce into a single property (eval flattens all iteration
    // outputs into one body). The loop fold gives every iteration surface the SAME
    // `mergeOwner` (the `For` node), so the post-expansion merge re-plan
    // (`replanMergesIfExpanded`) coalesces the spliced merge decls exactly like a merge
    // across the eval-flattened outputs.
    const compiler = makeCompiler();
    const src = '@supports (display: grid) {\n  each(1 2 3 4, {\n    padding+_: (@value * 10px);\n  });\n}';
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (loop + merge fold)
      expect(deriveCalls).toBe(0); // merge-across-iterations coalesced in-pass
      expect(css).toBe('@supports (display: grid) {\n  padding: 10px 20px 30px 40px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('LOOP-1 RESIDUAL (root-direct loop): a ROOT-DIRECT `each(…)` stays on eval (byte-identical, distinct increment)', async () => {
    // A loop DIRECTLY at document root renders through `Rules._emitRulesBody` (a distinct
    // root emitter from the container serializer that owns `runSpineForExpansion`), which
    // treats a `For` as a transparent child-Rules and emits its unexpanded body. So a
    // root-direct loop stays on eval — byte-identical, a sequenced increment (the container-
    // nested loop above folds). NOT a silent fold: `derive` fires.
    const compiler = makeCompiler();
    const src = 'each(1 2 3, {\n  .item-@{value} { width: (@value * 1px); }\n})';
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const css = await compiler.renderString(src, { language: 'less' });
      expect(deriveCalls).toBeGreaterThan(0); // root-direct loop → eval, residual not a fold
      expect(css).toBe('.item-1 {\n  width: 1px;\n}\n.item-2 {\n  width: 2px;\n}\n.item-3 {\n  width: 3px;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('MIXVAL-1 (mixin-as-value / map-lookup): `@p: .mk-map(); …@p[key]` FOLDS byte-identically (derive=0)', async () => {
    // A mixin DEFINITION bound to a variable (`@p: .mk-map()`) then map-subscripted
    // (`@p[text]`) folds on the spine WITHOUT dedicated machinery: the var cell binds
    // at scope-enter and `@p[key]` resolves via the KEPT `Reference.eval` against the
    // live value-frame (`emitLeaf` → `node.eval`), exactly like the eval path. Was a
    // first-reject (`bodyHasMixinDefinition && bodyHasCallInVarValue`); that gate was
    // conservative and is removed. Byte-identical to eval + less@4.
    const compiler = makeCompiler();
    const src = '.mk-map() {\n  text: red;\n}\n@p: .mk-map();\n.x {\n  color: @p[text];\n}';
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (mixin-as-value fold)
      expect(deriveCalls).toBe(0); // map-lookup resolved in-pass, no output tree
      expect(css).toBe('.x {\n  color: red;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('MIXVAL-1 (nested container): a nested mixin-def + `@p: .mk-map()` + `@p[key]` FOLDS byte-identically (derive=0)', async () => {
    // The same mixin-as-value/map-lookup shape nested one level under a container
    // ruleset (d=3). The container descent threads the value-frame the same way, so
    // the nested `@p[text]` resolves in-pass. Byte-identical to eval + less@4.
    const compiler = makeCompiler();
    const src = '.outer {\n  .mk-map() {\n    text: red;\n  }\n  @p: .mk-map();\n  .x {\n    color: @p[text];\n  }\n}';
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
      expect(deriveCalls).toBe(0);
      expect(css).toBe('.outer .x {\n  color: red;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('CHAIN-1 (transitive extend): the FULL `extend-chaining` corpus fixture FOLDS byte-identically (derive=0)', async () => {
    // Single-file TRANSITIVE extend: `.a{…} .b:extend(.a){} .c:extend(.b){}` — `.c` picks up `.a`
    // through the chain. Also exercises reverse-order chains, `all`-partial chains
    // (`.g.h ← .i.j:extend(.g all) ← .k:extend(.i all)` → nested `:is(.g, :is(.i, .k).j).h`),
    // 8-link multi-chains, self-reference (`.w:extend(.w)`), classic circular refs
    // (`.x ← .y ← .z ← .x`), `&:extend` inside a ruleset, and the `@media (tv)`/`(plasma)`
    // scoped block. SOLVE's document-level fixpoint drains every closure through the SHARED
    // target index (`solve.ts`), so the whole file folds on the spine with NO eval two-walk.
    // Was the `container:notRuleset [Extend]` first-reject → the chaining gate clauses in
    // `isSpineExtendTopology` (`chainsIntoExtender` + the trailing `extenderSelectors.has(target)`
    // reject) were removed; both were conservative once SOLVE handled the transitive closure.
    const lessPath = path.join(testDataRoot, 'tests-unit/extend-chaining/extend-chaining.less');
    const cssPath = lessPath.replace(/\.less$/, '.css');
    const expected = readFileSync(cssPath, 'utf8');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, { outputFile: cssPath });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (transitive-extend fold)
      expect(deriveCalls).toBe(0); // no eval two-walk → the fixpoint drained on the spine
      expect(result.css).toBe(expected); // byte-identical to the owner-maintained expectation
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('ATSTMT-1 (bodyless CSS `@import` statement): `at-rules-keyword-comments` FOLDS byte-identically (derive=0)', async () => {
    // A bodyless CSS `@import "x.css" screen /* c */, print;` statement parses as an
    // `AtRuleStatement` (not a `StyleImport`) whose MULTI-item prelude (path + media/comment
    // tail) the builder now wraps in an `Any` (F_STATIC) — so the spine admits it as a leaf
    // and HOISTS it to the top-of-doc emitter via `queueTopImport` (eval parity), rather than
    // emitting it at its authored source position (after the `@media` block). Was the
    // `atRule:notAtRuleWithBody [@import]` first-reject (string prelude never F_STATIC).
    const lessPath = path.join(testDataRoot, 'tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.less');
    const cssPath = lessPath.replace(/\.less$/, '.css');
    const expected = readFileSync(cssPath, 'utf8');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, { outputFile: cssPath });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk → the CSS-import statement folded + hoisted
      expect(result.css).toBe(expected); // byte-identical (import prepended before the @media block)
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('ATSTMT-2 (`@import`-in-`@layer` + bodyless `@layer` statement): `layer` FOLDS byte-identically (derive=0)', async () => {
    // The full `layer` fixture: top-level CSS `@import url(...) layer(foo);` statements (multi-item
    // static prelude → `Any` F_STATIC, hoisted), a bodyless `@layer reset, base, …;` and `@layer
    // theme;` LAYER-ORDER statement (emitted INLINE at position via `isSpineFoldableStatementAtRule`),
    // block `@layer name { … }` (incl. interpolated `@layer @layer-name`), a Less `@import` inside
    // `@layer legacy { … }`, and deep nesting. Was the stacked `atRule:notAtRuleWithBody [AtRuleStatement
    // @import]` / `[@layer]` first-rejects; folds byte-identically to the owner-maintained expectation.
    const lessPath = path.join(testDataRoot, 'tests-unit/layer/layer.less');
    const cssPath = lessPath.replace(/\.less$/, '.css');
    const expected = readFileSync(cssPath, 'utf8');
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, { outputFile: cssPath });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // no eval two-walk → the whole layer file folded
      expect(result.css).toBe(expected); // byte-identical to the owner-maintained expectation
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('STMTCALL void: a nested bare statement-position VOID function call folds (derive=0, emits nothing)', async () => {
    // The `functions` fixture's `if((false), {g: 7});` shape — a `Call` whose name is a
    // `function`-type Reference (NOT a mixin / DR call), condition false + no else branch → the
    // eval call-lane resolves it to a VOID `Anonymous` that serializes empty, emitting nothing. It
    // was the first-reject that forced its `#if` block off the spine (`isSimpleSpineLeaf` rejected
    // any non-declaration/comment leaf). Now it folds inline (`resolveSpineStatementCallText`), the
    // surrounding `/* void */` trivia preserved, byte-identical to eval + less@4 (which likewise
    // emits nothing for the false-no-else `if` statement). A regression re-arming the leaf reject
    // trips this RED.
    const compiler = makeCompiler();
    const src = `#if {\n  a: 1;\n  if((false), {g: 7}); /* void */\n  b: 2;\n}`;
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
      expect(deriveCalls).toBe(0); // no eval two-walk → the statement-call fold
      // The void call emits NO statement line (and no stray `;`); the comment survives.
      expect(css).toBe('#if {\n  a: 1;\n  /* void */\n  b: 2;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('STMTCALL value: a nested bare statement-position VALUE function call folds (derive=0, emits its value, no `;`)', async () => {
    // The `css-escapes` fixture's `e('…')` shape nested in a ruleset — a value-returning statement
    // call (`e()` unquotes to raw text). The eval call-lane emits the resolved value as its own line
    // with the source `;` DROPPED; the spine fold reproduces that exactly. A ROOT-DIRECT statement
    // call stays on eval (the root emitter `_emitRulesBody` would append the `;`) — see
    // `isSpineEligibleRoot`'s root-direct statement-call exclusion; this test covers the NESTED fold.
    const compiler = makeCompiler();
    const src = `.a { e('/* raw */'); color: red; }`;
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
      expect(deriveCalls).toBe(0); // no eval two-walk → the statement-call fold
      expect(css).toBe('.a {\n  /* raw */\n  color: red;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('STMTCALL (FOLDED): a DR-call + function-valued-decl tree FOLDS byte-identically (derive=0)', async () => {
    // Was the `functions` fixture's stacked reject (`treeHasDetachedCallWithFunctionValueDecl`,
    // now DELETED). ROOT CAUSE: on the spine there is no `Rules.eval` frame for the real root on
    // `rulesEvalStack`, so a detached-ruleset body (`@r()`) evaluated inside the fold reached
    // `_evalPreparedRules` as the FIRST `Rules.evalNode` — its `rulesEvalStack.length === 1`
    // "am I the outermost root?" heuristic fired and REASSIGNED `context.root` to that nested
    // body, clobbering the real root's built-in function registry. `findFunction`'s dead-end
    // fallback then missed, so a downstream `length(@list)` emitted RAW. FIX: the spine sets
    // `context.spineOwnsRoot`, and `_evalPreparedRules` skips the outermost-root reassignment
    // under it — the registry stays reachable and the function computes. Folds through the spine,
    // byte-identical to eval; also covers the mixin-body function-value surface (`replace(...)`).
    const compiler = makeCompiler();
    const src = `#i { @r: { c: 3; }; @r(); }\n#l { @list: a 1, b 2; length: length(@list); }`;
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (DR-call + function-decl fold)
      expect(deriveCalls).toBe(0); // no eval two-walk → the registry-reachability fix, not an eval fallback
      expect(css).toBe('#i {\n  c: 3;\n}\n#l {\n  length: 2;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('WHOLE-FIXTURE lock: `functions.less` FOLDS byte-identically (derive=0)', async () => {
    // The stacked-head endgame for the `functions` corpus fixture: after the statement-call fold
    // and the DR-call + function-value-decl registry-reachability fix (`spineOwnsRoot`), the entire
    // fixture renders through the single spine pass with NO eval two-walk. A regression that re-arms
    // an eval fallback (or reintroduces the root-clobber) trips this RED. Byte-identity is also
    // asserted by all-less; this locks the FOLD (derive=0) so a silent eval fallback can't hide.
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });
    const lessPath = path.join(testDataRoot, 'tests-unit/functions/functions.less');
    const cssPath = lessPath.replace(/\.less$/, '.css');
    const expected = readFileSync(cssPath, 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, { outputFile: cssPath });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // whole fixture folds — no eval two-walk
      expect(result.css).toBe(expected);
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('ROOTCALL: a document-ROOT-level mixin call FOLDS (derive=0), parity with a nested call', async () => {
    // The residual structural gap between a ROOT-direct mixin call and a CONTAINER-nested
    // one: the container descent (`serializeRulesContainer` → `runSpineMixinExpansion`)
    // folds a call via `resolveSpineMixinCall`, but the ROOT body emitter (`_emitRulesBody`)
    // used to emit a root call via the eval-based `Call.render` (a `Rules.derive` two-walk).
    // The root emitter now folds through the SAME sink — a nested-container surface body and
    // a leaf both resolve against the mixin's param frame. A regression re-arming the root
    // `n.render` eval terminal for a foldable call trips this RED. Guard has no bearing (any
    // root call folded; the guard resolves inside the same drive).
    const compiler = makeCompiler();
    const src = `.m(@a: white) when (@a = white) {\n  .test { color: @a; }\n}\n.m();`;
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
      expect(deriveCalls).toBe(0); // no eval two-walk → the root call folded
      expect(css).toBe('.test {\n  color: white;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('WHOLE-FIXTURE lock: `comments.less` FOLDS byte-identically (derive=0)', async () => {
    // The `comments` corpus fixture's last residual: a ROOT-level guarded mixin call
    // (`.mixin_def_with_colors() when (@a = white)`) alongside a comment-prelude keyframes
    // (`@-webkit-keyframes /* Safari */ hover`). The keyframes already folded; the root mixin
    // call was the only eval two-walk left (it emitted a `.test-rule` output tree via
    // `Call.render`). With the root-level mixin-call fold the whole fixture renders through
    // the single spine pass. A regression re-arming an eval fallback trips this RED; byte-
    // identity is also asserted by all-less, this locks the FOLD (derive=0).
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });
    const lessPath = path.join(testDataRoot, 'tests-unit/comments/comments.less');
    const cssPath = lessPath.replace(/\.less$/, '.css');
    const expected = readFileSync(cssPath, 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, { outputFile: cssPath });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // whole fixture folds — no eval two-walk
      expect(result.css).toBe(expected);
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('WHOLE-FIXTURE lock: `css-escapes.less` FOLDS byte-identically (derive=0)', async () => {
    // The `css-escapes` corpus fixture's last residual was a document-ROOT-direct bare
    // statement-position function call (`e('/* anything to unquote */');`). It folded
    // nested in a container but a root-direct statement call renders through the root
    // emitter (`_emitRulesBody`), which used to emit the call's resolved text PLUS the
    // source `requiredSemi` `;` — so the whole tree was routed to eval. The root emitter
    // grew the same resolve-inline-and-drop-`;` branch (`resolveSpineStatementCallText`,
    // void → suppressed) the container leaf tail uses, so the fixture — including the
    // escaped-selector nested mixin call `.mixin\\!tUp()` inside `.\\34 04 strong` — now
    // renders through the single spine pass. A regression re-arming an eval fallback for a
    // root-direct statement call trips this RED; byte-identity is also asserted by all-less.
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });
    const lessPath = path.join(testDataRoot, 'tests-unit/css-escapes/css-escapes.less');
    const cssPath = lessPath.replace(/\.less$/, '.css');
    const expected = readFileSync(cssPath, 'utf8');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(lessPath, { outputFile: cssPath });
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path
      expect(deriveCalls).toBe(0); // whole fixture folds — no eval two-walk
      expect(result.css).toBe(expected);
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('APPEND×EXTEND (precise gate): appends + UNRELATED extends FOLD (derive=0), gate no longer over-rejects', async () => {
    // Regression lock for the append+extend gate refinement. The former gate rejected ANY tree
    // that BOTH appended (`&-modifier`) AND `:extend`ed — even when no extend targets an
    // append-generated selector — which pinned `benchmark.less` (whose `.component-*` appends are
    // never extend targets). `treeHasExtendTargetableAppend` now rejects ONLY the genuine
    // collision, so this shape folds. A regression restoring the whole-tree reject trips this RED.
    const compiler = makeCompiler();
    const src = [
      '.base { color: red; }',
      '.ext:extend(.base) { margin: 1px; }',
      '.component {',
      '  display: block;',
      '  &-inner { padding: 8px; }',
      '  &-body { margin: 4px; &--large { padding: 24px; } }',
      '}'
    ].join('\n');
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
      expect(deriveCalls).toBe(0); // folds — gate admits (no collision)
      expect(css).toBe(
        '.base,\n.ext {\n  color: red;\n}\n.ext {\n  margin: 1px;\n}\n'
        + '.component {\n  display: block;\n}\n.component-inner {\n  padding: 8px;\n}\n'
        + '.component-body {\n  margin: 4px;\n}\n.component-body--large {\n  padding: 24px;\n}\n'
      );
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('APPEND×EXTEND (precise gate): an extend of an APPEND-GENERATED selector STAYS on eval (byte-identical)', async () => {
    // The genuine hazard the gate must still catch: `:extend(.component-inner)` targets a selector
    // that exists only AFTER `&-inner` resolves, which the static gather misses. This shape MUST
    // remain eval-owned (byte-identical). `treeHasExtendTargetableAppend` detects the collision
    // (`.component` + `-inner` = `.component-inner` = the target atom) → eval. A regression that
    // folds it (silently dropping the extend contribution) trips this RED.
    const compiler = makeCompiler();
    const src = [
      '.component { display: block; &-inner { padding: 8px; } }',
      '.thing:extend(.component-inner) { color: blue; }'
    ].join('\n');
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const css = await compiler.renderString(src, { language: 'less' });
      expect(deriveCalls).toBeGreaterThan(0); // stays on eval (collision hazard)
      // Eval oracle: the append-generated `.component-inner` gains the `.component .thing` branch.
      expect(css).toBe(
        '.component {\n  display: block;\n}\n.component-inner,\n.component .thing {\n  padding: 8px;\n}\n'
        + '.thing {\n  color: blue;\n}\n'
      );
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  });

  it('REFERENCE-EXTEND (unmapped target): `:extend` of an absent reference-import selector FOLDS as a no-op (derive=0)', async () => {
    // Regression lock for the reference-extend unmapped-target fold. `@import (reference) "…"` whose
    // body does NOT define the extend target (`.ref-button`) formerly ABORTED the spine to eval
    // (the strict topology re-gate rejected the unmapped target). In the re-gate the imported
    // subjects are RESOLVED, so an unmapped simple target is provably INERT (a no-op extend, the
    // extender renders alone) — byte-identical to eval / less@4. It now folds without abort. A
    // regression re-arming the abort trips this RED.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-ref-extend-unmapped-'));
    fs.writeFileSync(path.join(dir, 'empty.less'), '');
    fs.writeFileSync(
      path.join(dir, 'main.less'),
      '@import (reference) "empty.less";\n.my-button:extend(.ref-button) {}\n.my-alert:extend(.ref-alert all) {}\n'
    );
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
      expect(deriveCalls).toBe(0); // folds — no abort to eval
      expect(result.css).toBe(''); // empty-body extenders of an absent target emit nothing
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REFERENCE-EXTEND (unmapped target, COMPLEX doc): inert fold survives combinator + interpolation subjects (derive=0)', async () => {
    // Robust-inertness lock. An unmapped reference-import target (`.ref-missing`) is proven INERT by a
    // structural occurrence scan over the document's subjects. That scan formerly BAILED conservatively
    // (→ "possible match" → abort to eval) whenever ANY subject bore a child/sibling combinator
    // (`div.foo > ul`) or a whole/leading interpolation (`.@{p}-1`) — which is precisely the benchmark
    // shape (its `div.browse > ul` combinator + `.@{icon-prefix}-@{i}` icon selector defeated the proof).
    // The scan now (a) reasons per-compound-level across every combinator, (b) keeps `:pseudo(...)`/`[…]`
    // opaque, and (c) resolves a leading interpolation against root-var literals (`@p: "icon"` →
    // `.icon-1`, fixed prefix). So a genuinely-unmatched plain target is inert even here: the whole root
    // FOLDS spine-only (derive=0), the empty extender emits nothing, byte-identical to eval.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-ref-extend-complex-'));
    fs.writeFileSync(path.join(dir, 'empty.less'), '');
    fs.writeFileSync(
      path.join(dir, 'main.less'),
      '@import (reference) "empty.less";\n@p: "icon";\n.@{p}-1 { color: red; }\ndiv.foo > ul { color: blue; }\n.x:extend(.ref-missing) {}\n'
    );
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const result = await compiler.renderToResult(path.join(dir, 'main.less'), {});
      expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine path (no abort)
      expect(deriveCalls).toBe(0); // folds — the inert proof held despite combinator/interp subjects
      // `.@{p}-1` resolved to `.icon-1`; the combinator subject is unchanged; the `.x` extender of the
      // absent `.ref-missing` emits nothing.
      expect(result.css).toBe('.icon-1 {\n  color: red;\n}\ndiv.foo > ul {\n  color: blue;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REFERENCE-EXTEND (present target): `:extend` of a PRESENT reference selector still folds (derive=0)', async () => {
    // Companion to the unmapped case: when the reference body DOES define the target, the fold must
    // still work (the re-gate relaxation must not disturb the mapped path). `.ref-button` is pulled
    // in reference-mode (own form dropped) and the extender inherits it — byte-identical to eval.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-ref-extend-present-'));
    fs.writeFileSync(path.join(dir, 'ref.less'), '.ref-button { color: green; }\n');
    fs.writeFileSync(
      path.join(dir, 'main.less'),
      '@import (reference) "ref.less";\n.my-button:extend(.ref-button) { font-weight: bold; }\n'
    );
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
      expect(deriveCalls).toBe(0); // folds
      expect(result.css).toBe('.my-button {\n  color: green;\n}\n.my-button {\n  font-weight: bold;\n}\n');
    } finally {
      Rules.prototype.derive = originalDerive;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('BENCHMARK: `benchmark.less` is spine-ENGAGED and byte-identical to the eval baseline (merge-alongside-mixin gate lifted + charset-on-abort fixed)', async () => {
    // The merge-alongside-mixin cutover lock. `benchmark.less` was kept OFF the spine by
    // the `bodyHasMixinCall && bodyHasDirectMergeDecl` reject on its 3 merge-alongside-mixin
    // rulesets (`.shadow-elevated`/`.shadow-floating`/`.transform-combo`). That reject is
    // LIFTED (the common no-`!important` shape folds; the `!important` sub-case defers via
    // `treeHasImportantMergeAlongsideMixin`), so the root is now SPINE-ELIGIBLE and the render
    // ENGAGES the spine (`spineRenderCounter` moves).
    //
    // benchmark's extend topology over its `@import (reference)` bodies is NOT yet
    // spine-foldable, so the pass ABORTS to eval at the post-import topology re-gate
    // (`isSpineExtendTopology`) — a CLEAN pre-first-byte fallback. This test therefore locks
    // BYTE-IDENTITY of that spine-attempt-then-abort path (NOT a full fold): in particular the
    // charset-on-abort fix — benchmark's 3 mid-body root `@charset "utf-8";` HOIST to a single
    // document-top `@charset`, which the abort path formerly DROPPED (the eval re-render sees the
    // registration-prepared `Nil` charset placeholders and `currentCharset` had been rolled back).
    // A regression that re-drops the charset, or diverges the abort output from eval, trips this.
    // (A future extend-over-reference-import fold would flip this from abort to a true fold; the
    // byte-identity assertion still holds.)
    const benchFile = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../benchmark/benchmark.less');
    const source = readFileSync(benchFile, 'utf8');
    // The forced-eval baseline registers a NO-OP pre-render visitor plugin: the Compiler sets
    // `preSerializeRoot` only when a visitor exists, and the spine gate requires `!preSerializeRoot`
    // — so this render never engages the spine, yielding the pure eval output for the byte compare.
    const makeConfig = (forceEval: boolean) => ({
      compile: {
        mathMode: 'always',
        searchPaths: [path.dirname(benchFile)],
        plugins: forceEval
          ? [lessPlugin(), lessCompatPlugin({}), { name: 'force-eval-visitor', preRenderVisitor: {} }]
          : [lessPlugin(), lessCompatPlugin({})]
      },
      output: {},
      language: {}
    });
    const render = async (forceEval: boolean): Promise<string> => {
      const config = makeConfig(forceEval);
      return (await new Compiler(config).renderToResult(
        { source, filePath: benchFile, language: 'less', extension: '.less' },
        config
      )).css;
    };

    // 1) Production render — the spine ENGAGES (eligible root reaches `renderRootViaSpine`).
    const before = spineRenderCounter.rootRenders;
    const spineCss = await render(false);
    expect(spineRenderCounter.rootRenders).toBeGreaterThan(before); // spine engaged

    // 2) Pure eval baseline (spine gate disabled by the no-op visitor).
    const beforeEval = spineRenderCounter.rootRenders;
    const evalCss = await render(true);
    expect(spineRenderCounter.rootRenders).toBe(beforeEval); // spine did NOT engage → true eval

    // 3) Byte-identity: the spine-attempt output equals the pure eval output exactly.
    // NOTE (re-anchor): this locks the ABORT PATH's byte-identity, NOT a Less-4.x-correct golden.
    // The full benchmark still ABORTS to eval at the post-import `isSpineExtendTopology` re-gate
    // because of the `@import (reference)` `all`-extend topology over EMPTY reference bodies
    // (`.my-primary-button:extend(.ref-button all)` etc., benchmark.less ~4039-4042) — a shape
    // beyond the two extend bugs fixed here (cases 3 & 5). So its rendered output is the eval
    // output, which still carries the eval path's documented nested-extender bare-fragment limit
    // (`.prose p` bare `p`, case 1; the `.prose h1`/`.prose h2` self-extend drop, case 3). The
    // Less-4.x-CORRECT golden for benchmark's extend shapes — which the spine now produces once it
    // FOLDS — is asserted spine-only in the `BENCHMARK EXTEND GOLDEN` block below. See
    // docs/future/core-architecture/BENCHMARK-EXTEND-EVIDENCE.md.
    expect(spineCss).toBe(evalCss);
    // 4) The hoisted charset survived (the charset-on-abort regression guard).
    expect(spineCss.startsWith('@charset "utf-8";\n')).toBe(true);
    expect(spineCss.indexOf('@charset')).toBe(spineCss.lastIndexOf('@charset')); // exactly one, hoisted
  });
});

/**
 * BENCHMARK EXTEND GOLDEN (Less-4.x-grounded) — the re-anchored gate.
 *
 * `packages/jess/benchmark/benchmark.css` is a 2-line stub and both `@import` targets are EMPTY
 * files, so there is no committed golden to defend, and the full benchmark aborts to eval (see the
 * abort-lock test above). These tests re-anchor the benchmark's extend contract to the CORRECT
 * output derived from real Less 4.6.7 (adjudicated in
 * docs/future/core-architecture/BENCHMARK-EXTEND-EVIDENCE.md), rendered SPINE-ONLY
 * (production path, no eval two-walk — `Rules.derive` UNCALLED). The inputs are the report's
 * faithful reductions of benchmark.less's extend sections (~4045-4069, ~4369-4388): they FOLD on
 * the spine and the spine now produces the Less-4.x-correct result. This replaces defending the
 * buggy eval output with defending the Less-4.x-grounded golden.
 *
 * Case 1 (nested extender) and case 5 (`.panel all`-extend across scattered `div.panel…`) carry the
 * report's corrected golden verbatim; case 3 (nested element/class self-extend `h1:extend(h1)`) has
 * no report golden (Less 4.x sided with NEITHER jess path — a pure code fix), so its golden here is
 * the Less-4.x-correct output shown in the report's case-3 table. `:is()` compaction is the
 * evidence-validated ship form (semantically identical to Less 4.x's expansion for same-specificity
 * class args; eval-flat + nested-spine already emit it).
 */
describe('BENCHMARK EXTEND GOLDEN (Less-4.x-grounded, spine-only)', () => {
  const makeCompiler = () =>
    new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({})] }
    });

  const renderSpineOnly = async (src: string): Promise<{ css: string; derive: number; engaged: boolean }> => {
    const compiler = makeCompiler();
    const originalDerive = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return originalDerive.apply(this, args);
    } as Rules['derive'];
    try {
      const before = spineRenderCounter.rootRenders;
      const css = await compiler.renderString(src, { language: 'less' });
      return { css, derive: deriveCalls, engaged: spineRenderCounter.rootRenders > before };
    } finally {
      Rules.prototype.derive = originalDerive;
    }
  };

  it('CASE 1 (nested extender) folds spine-only, byte-identical to the Less-4.x golden', async () => {
    const src = `.typography-base {\n  font-family: sans-serif;\n  line-height: 1.6;\n}\n.prose {\n  p:extend(.typography-base) {\n    margin-bottom: 1em;\n  }\n}`;
    const { css, derive, engaged } = await renderSpineOnly(src);
    expect(engaged).toBe(true); // spine folded (no abort)
    expect(derive).toBe(0); // no eval two-walk
    // Less 4.6.7: the nested extender composes to `.prose p` (NOT the eval-path bare `p`).
    expect(css).toBe(
      '.typography-base,\n.prose p {\n  font-family: sans-serif;\n  line-height: 1.6;\n}\n.prose p {\n  margin-bottom: 1em;\n}\n'
    );
  });

  it('CASE 3 (nested element/class self-extend) folds spine-only, adding `.prose h1`/`.prose h2` per Less 4.x', async () => {
    const src = `.typography-base { font-family: sans-serif; line-height: 1.6; }\n.heading-base:extend(.typography-base) { font-weight: bold; margin-bottom: 0.5em; }\nh1:extend(.heading-base) { font-size: 2.5em; }\nh2:extend(.heading-base) { font-size: 2em; }\n.prose {\n  h1:extend(h1) {}\n  h2:extend(h2) {}\n}`;
    const { css, derive, engaged } = await renderSpineOnly(src);
    expect(engaged).toBe(true);
    expect(derive).toBe(0);
    // Less 4.6.7: `.prose h1`/`.prose h2` are added to every group matching `h1`/`h2`
    // (the nested self-extend). Both jess paths formerly DROPPED this; the spine now applies it.
    expect(css).toBe(
      '.typography-base,\n.heading-base,\nh1,\nh2,\n.prose h1,\n.prose h2 {\n  font-family: sans-serif;\n  line-height: 1.6;\n}\n'
      + '.heading-base,\nh1,\nh2,\n.prose h1,\n.prose h2 {\n  font-weight: bold;\n  margin-bottom: 0.5em;\n}\n'
      + 'h1,\n.prose h1 {\n  font-size: 2.5em;\n}\n'
      + 'h2,\n.prose h2 {\n  font-size: 2em;\n}\n'
    );
  });

  it('CASE 5 (`.panel all`-extend across scattered `div.panel…`) folds spine-only in FLAT mode, byte-identical to the Less-4.x golden', async () => {
    const src = `.panel {\n  border: 1px solid #ddd;\n  border-radius: 4px;\n  .panel-heading { padding: 10px 15px; background: #f5f5f5; border-bottom: 1px solid #ddd; }\n  .panel-body { padding: 15px; }\n  .panel-footer { padding: 10px 15px; background: #f5f5f5; border-top: 1px solid #ddd; }\n}\n`
      + `div.panel {\n  margin: 0 0 20px;\n  > div.header  { padding: 5px; }\n  > div.content { padding: 10px; }\n  > div.footer  { padding: 4px; }\n}\n`
      + `div.panel.no_footer div.content { border-bottom-left-radius: 3px; }\n`
      + `div.panel.no_header div.content { border-top-left-radius: 3px; }\n`
      + `div.panel.collapsable { div.header { cursor: pointer; } }\n`
      + `div.panel.collapsed  { div.content, div.footer { display: none; } }\n`
      + `.card   { &:extend(.panel all); box-shadow: 0 2px 4px rgba(0,0,0,0.1); }\n`
      + `.widget { &:extend(.panel all); margin-bottom: 20px; }`;
    const { css, derive, engaged } = await renderSpineOnly(src);
    expect(engaged).toBe(true);
    expect(derive).toBe(0);
    // Less 4.6.7 (via the evidence-validated `:is()` compaction): every extended nested child
    // keeps its `div` prefix + combinator context — NOT the former bare `.card`/`.widget` fragments.
    expect(css).toBe(
      '.panel,\n.card,\n.widget {\n  border: 1px solid #ddd;\n  border-radius: 4px;\n}\n'
      + ':is(.panel, .card, .widget) .panel-heading {\n  padding: 10px 15px;\n  background: #f5f5f5;\n  border-bottom: 1px solid #ddd;\n}\n'
      + ':is(.panel, .card, .widget) .panel-body {\n  padding: 15px;\n}\n'
      + ':is(.panel, .card, .widget) .panel-footer {\n  padding: 10px 15px;\n  background: #f5f5f5;\n  border-top: 1px solid #ddd;\n}\n'
      + 'div:is(.panel, .card, .widget) {\n  margin: 0 0 20px;\n}\n'
      + 'div:is(.panel, .card, .widget) > div.header {\n  padding: 5px;\n}\n'
      + 'div:is(.panel, .card, .widget) > div.content {\n  padding: 10px;\n}\n'
      + 'div:is(.panel, .card, .widget) > div.footer {\n  padding: 4px;\n}\n'
      + 'div:is(.panel, .card, .widget).no_footer div.content {\n  border-bottom-left-radius: 3px;\n}\n'
      + 'div:is(.panel, .card, .widget).no_header div.content {\n  border-top-left-radius: 3px;\n}\n'
      + 'div:is(.panel, .card, .widget).collapsable div.header {\n  cursor: pointer;\n}\n'
      + 'div:is(.panel, .card, .widget).collapsed div.content,\ndiv:is(.panel, .card, .widget).collapsed div.footer {\n  display: none;\n}\n'
      + '.card {\n  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);\n}\n'
      + '.widget {\n  margin-bottom: 20px;\n}\n'
    );
  });
});
