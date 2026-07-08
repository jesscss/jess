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

  it('does NOT route an EXTEND-bearing root through the spine (stays on the eval path — extend is P3)', async () => {
    // `:extend` in a selector makes the root spine-INELIGIBLE (extend application
    // is not wired into the spine yet). It must render on the eval path — the
    // spine counter must NOT move for it, and the extend must still apply.
    const compiler = makeCompiler();
    const src = `.base {\n  color: red;\n}\n.derived:extend(.base) {\n  font-weight: bold;\n}`;

    const before = spineRenderCounter.rootRenders;
    const css = await compiler.renderString(src, { language: 'less' });

    expect(spineRenderCounter.rootRenders).toBe(before); // eval path, not spine
    // Extend applied correctly on the eval path.
    expect(css).toContain('.base');
    expect(css).toContain('.derived');
    expect(css).toContain('font-weight: bold');
  });
});
