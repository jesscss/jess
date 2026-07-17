import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * v5 extend-`all` sub-span `:is()` wrapping (task #30).
 *
 * `:extend(TARGET all)` treats TARGET as a PATTERN matched by COMPOUND-SUBSET
 * against every existing selector (each TARGET compound must be a subset of the
 * aligned selector compound, combinators aligned — so `.a > .c` matches
 * `.a.b > .c.d`). The extending rule's own selector is UNIONED with the matched
 * span:
 *
 *   - WHOLE-selector match  → plain comma-append (no `:is()`).
 *   - MID-complex sub-span  → `:is(<matched-span>, <extender>)` IN PLACE, with the
 *     surrounding combinator context preserved verbatim on BOTH sides.
 *
 * This SUPERSEDES Less 4.x's positional string-replace: 4.x refuses a
 * complex-selector subset match outright (`WARNING: extend '.a > .c' has no
 * matches`), verified directly against less.js `alpha`. The v5 design fills that
 * gap consistently.
 *
 * NOTE on the design spec's two examples (EXTEND-REDESIGN / task #30): they are
 * written as `.a > .c { &:extend(.x all); }`, which in standard Less/`alpha`
 * semantics searches for the ARGUMENT (`.x`) and adds the rule's own selector —
 * i.e. `&`/argument roles are transposed in the prose, so the literal input
 * produces no match (`WARNING: extend ' .x' has no matches` under `alpha`). The
 * intended END output — `.a.b > .c.d, .x` and `div + :is(.a.b > .c.d, .x) ~
 * .child` — is reproduced EXACTLY by the coherent direction (search the extend
 * TARGET, union the extending selector), gated below. The `.zoo`/`.zap` corpus
 * cases require this same direction, so it is the only self-consistent reading.
 */

const render = async (src: string): Promise<string> => {
  const root = bridgeToAst(parseLessFn(src).tree, src);
  const evaluator = buildEvaluator(makeBuiltinRegistry());
  return (await serialize(root, { evaluator, collapseNesting: true })).css;
};

describe('ast/ extend — `all` sub-span `:is()` wrapping (task #30)', () => {
  it('Ex1: whole-selector compound-subset match degenerates to a comma-append', async () => {
    // `.a > .c` compound-subset-matches the ENTIRE `.a.b > .c.d` selector
    // (`.a`⊆`.a.b`, `>`=`>`, `.c`⊆`.c.d`) → the extender is a plain sibling.
    const css = await render(`.a.b > .c.d {\n  color: red;\n}\n.x:extend(.a > .c all) {}`);
    expect(css).toBe('.a.b > .c.d,\n.x {\n  color: red;\n}\n');
  });

  it('Ex2: mid-complex sub-span wraps `:is()` in place, context preserved on BOTH sides', async () => {
    // The matched span `.a.b > .c.d` sits between `div +` (left) and `~ .child`
    // (right); only the span is replaced by `:is(span, .x)`, both sides verbatim.
    const css = await render(`div + .a.b > .c.d ~ .child {\n  color: red;\n}\n.x:extend(.a > .c all) {}`);
    expect(css).toBe('div + :is(.a.b > .c.d, .x) ~ .child {\n  color: red;\n}\n');
  });

  it('whole-selector EXACT combinator match also comma-appends (no `:is()`)', async () => {
    const css = await render(`.a > .c {\n  color: red;\n}\n.x:extend(.a > .c all) {}`);
    expect(css).toBe('.a > .c,\n.x {\n  color: red;\n}\n');
  });

  it('both-sides context with a MULTI-atom compound match stays a mid-span wrap', async () => {
    // A second both-sides case with richer compounds, guarding the invariant that
    // everything before/after the matched span is preserved untouched.
    const css = await render(
      `.head ~ .a.b.c > .d.e + .tail {\n  color: red;\n}\n.z:extend(.a.b > .d all) {}`,
    );
    expect(css).toBe('.head ~ :is(.a.b.c > .d.e, .z) + .tail {\n  color: red;\n}\n');
  });
});
