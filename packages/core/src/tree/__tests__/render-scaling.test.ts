import { describe, it, expect, beforeEach } from 'vitest';
import { rules, ruleset, sel, el, decl, any } from '../index.js';
import { setSourceSpan, setFieldSpans } from '../util/provenance.js';
import { Context } from '../../context.js';
import { renderNodeToString } from '../util/render-buffer.js';
import {
  createTriviaMap,
  makeTrivia,
  getCommentRunVisits,
  resetCommentRunVisits
} from '../util/trivia.js';
import {
  getExtendMatchWork,
  resetExtendMatchWork
} from '../util/extend-walk.js';
import { Parser } from '../../../../less-parser/src/index.js';
import type { RenderBufferNode } from '../util/render-buffer.js';
import type { TriviaMap, Trivia } from '../../types/index.js';

/**
 * Standing scaling guardrail. A serialize quadratic (`commentRunsWithinSpan`
 * re-scanning the whole comment map per node — O(nodes × comments)) once slipped
 * through every gate because they were all complexity-BLIND (byte-identical +
 * suite-green + memory-win all passed). These tests render the SAME content at
 * increasing node counts and assert the WORK scales ~LINEARLY, not
 * quadratically, using a DETERMINISTIC counter rather than a wall clock.
 *
 * The counter (`getCommentRunVisits`) lives in `trivia.ts` and counts every
 * comment-run visited across all `commentRunsWithinSpan` calls in a render. A
 * per-node full-map scan makes this total ~N²; the binary-search window query
 * keeps it ~N·log N. `4N` is the strongest signal: quadratic ⇒ ~16× the `N`
 * total, linear ⇒ ~4×. We bound the ratio well below the quadratic prediction.
 */

/**
 * Build a comment-heavy sheet: `blocks` declarations, each carrying a block
 * comment in its `name → value` gap, all sharing ONE TriviaMap. Every
 * declaration's serialization triggers a `commentRunsWithinSpan` query, so the
 * per-render comment work scales with the block count.
 *
 * Layout per block (widths fixed so offsets are trivially computed):
 *   name `color` (5), a 5-char block comment, `:`, value `red`, `;`.
 * The comment run sits in the name-to-value gap `[nameEnd, valueStart)`.
 */
function buildCommentHeavySheet(blocks: number): { node: ReturnType<typeof rules>; trivia: TriviaMap } {
  const NAME = 'color';
  const COMMENT = '/*c*/';
  const VALUE = 'red';
  // One authored block: `color/*c*/:red;` — reconstruct offsets from widths.
  const blockText = `${NAME}${COMMENT}:${VALUE};`;
  const src = blockText.repeat(blocks);

  const before = new Map<number, Trivia>();
  const after = new Map<number, Trivia>();
  const decls = [];

  for (let i = 0; i < blocks; i++) {
    const base = i * blockText.length;
    const nameEnd = base + NAME.length;            // end of `color`
    const valueStart = nameEnd + COMMENT.length + 1; // after `/*c*/:` → value start
    const declEnd = base + blockText.length;         // past `;`

    const run = makeTrivia(src, nameEnd, nameEnd + COMMENT.length);
    // Keyed both ways like a real trivia map; `commentRuns()` dedupes by identity.
    after.set(nameEnd, run);
    before.set(valueStart - 1, run);

    const d = decl({ name: NAME, value: any(VALUE) });
    // Declaration span covers the whole block; the value field pins value start
    // so the name→value gap is `[base, valueStart)`, containing the comment.
    setSourceSpan(d, { start: base, end: declEnd });
    // Declaration.childKeys = ['name', 'value', 'important']; value is slot 1.
    setFieldSpans(d, [undefined, { start: valueStart, end: valueStart + VALUE.length }, undefined]);
    decls.push(d);
  }

  const trivia = createTriviaMap({ before, after }) satisfies TriviaMap;
  const node = rules([
    ruleset({ selector: sel([el('.a')]), rules: decls })
  ]);
  return { node, trivia };
}

/** Build a plain (comment-free) sheet of `blocks` simple rulesets. */
function buildPlainSheet(blocks: number): ReturnType<typeof rules> {
  const rulesets = [];
  for (let i = 0; i < blocks; i++) {
    rulesets.push(
      ruleset({
        selector: sel([el(`.c${i}`)]),
        rules: [decl({ name: 'color', value: any('red') })]
      })
    );
  }
  return rules(rulesets);
}

/** Total comment-run visits incurred by one render of `node` with `trivia`. */
async function commentWorkForRender(
  node: ReturnType<typeof rules>,
  trivia: TriviaMap | undefined,
  context: Context
): Promise<{ css: string; visits: number }> {
  resetCommentRunVisits();
  const css = await renderNodeToString(node, context, trivia ? { trivia, context } : { context });
  return { css, visits: getCommentRunVisits() };
}

describe('render scaling guardrail', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('comment-scan work scales ~linearly, not quadratically, with node count', async () => {
    const N = 40;

    const sheetN = buildCommentHeavySheet(N);
    const sheet2N = buildCommentHeavySheet(2 * N);
    const sheet4N = buildCommentHeavySheet(4 * N);

    const rN = await commentWorkForRender(sheetN.node, sheetN.trivia, new Context());
    const r2N = await commentWorkForRender(sheet2N.node, sheet2N.trivia, new Context());
    const r4N = await commentWorkForRender(sheet4N.node, sheet4N.trivia, new Context());

    // Sanity: every block's comment actually round-trips (path is exercised).
    expect(rN.css).toContain('/*c*/');
    expect(rN.visits).toBeGreaterThan(0);

    // Quadratic would give visits(4N)/visits(N) ≈ 16; linear ≈ 4, and the
    // log factor keeps N·log N well under a quadratic. A generous 8× bound
    // fails LOUDLY on the O(nodes × comments) regression (~16×) while leaving
    // comfortable headroom for the log term and small-N constants.
    const ratio = r4N.visits / rN.visits;
    expect(ratio).toBeLessThan(8);

    // Doubling steps must not blow up either (quadratic ⇒ ~4× per doubling).
    expect(r2N.visits / rN.visits).toBeLessThan(4);
    expect(r4N.visits / r2N.visits).toBeLessThan(4);
  });

  it('general render/serialize stays linear on a plain (comment-free) sheet', async () => {
    const N = 60;

    const rN = await commentWorkForRender(buildPlainSheet(N), undefined, new Context());
    const r4N = await commentWorkForRender(buildPlainSheet(4 * N), undefined, new Context());

    // No trivia map ⇒ no comment-run work at all; this catches a regression
    // that reintroduces whole-collection scanning on the plain-render path.
    expect(rN.visits).toBe(0);
    expect(r4N.visits).toBe(0);

    // Output must scale linearly in size (4N sheet ~4× the N sheet), a coarse
    // guard that per-node serialization did not start doing super-linear work.
    const sizeN = rN.css.length;
    const size4N = r4N.css.length;
    expect(size4N / sizeN).toBeGreaterThan(3.5);
    expect(size4N / sizeN).toBeLessThan(4.5);
  });

  /**
   * Extend-matcher scaling guardrail. The chained-extend discovery
   * (`findChainedExtendsWithSkips`) once re-scanned the ENTIRE extend list for
   * every applied extend and re-ran `wouldExtendChange` (a full selector-matcher
   * descent) from scratch on every pair — O(I²) matcher descents in the number
   * of extend instructions. It slipped every prior gate (byte-identical +
   * suite-green) because those are complexity-blind.
   *
   * `getExtendMatchWork()` counts every FULL (cache-missing) `wouldExtendChange`
   * descent across a render. The pass-scoped memo turns repeat probes into Map
   * hits and the target-value index stops the whole-list rescan, so the total
   * scales ~linearly with instruction count. Rendering the SAME shape at
   * increasing extend counts and asserting the WORK grows ~linearly (via a
   * DETERMINISTIC counter, not a wall clock) fails LOUDLY if either the memo or
   * the index regresses back to the quadratic.
   */
  function buildExtendHeavySheet(components: number): string {
    // Each component contributes a local 3-link chain
    // (.a-i → .b-i:extend(.a-i) → .c-i:extend(.b-i)) plus a hook that extends
    // one of a few shared bases. Every applied extend triggers chained
    // discovery, which (pre-fix) rescans ALL components' extends.
    let src = '';
    for (let i = 0; i < 4; i++) {
      src += `.base-${i} { color: rgb(${i}, ${i}, ${i}); }\n`;
    }
    for (let c = 0; c < components; c++) {
      src += `.a-${c} { color: red; }\n`;
      src += `.b-${c}:extend(.a-${c}) { margin: 1px; }\n`;
      src += `.c-${c}:extend(.b-${c}) { padding: 1px; }\n`;
      src += `.hook-${c} { &:extend(.base-${c % 4}); width: ${c}px; }\n`;
    }
    return src;
  }

  async function extendWorkForRender(source: string): Promise<{ css: string; work: number }> {
    const parser = new Parser();
    const { tree } = parser.parse(source);
    resetExtendMatchWork();
    const css = await renderNodeToString(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      tree as unknown as RenderBufferNode,
      new Context(),
      { context: new Context() }
    );
    return { css, work: getExtendMatchWork() };
  }

  it('extend-matcher work scales ~linearly, not quadratically, with extend count', async () => {
    const N = 25;

    const rN = await extendWorkForRender(buildExtendHeavySheet(N));
    const r2N = await extendWorkForRender(buildExtendHeavySheet(2 * N));
    const r4N = await extendWorkForRender(buildExtendHeavySheet(4 * N));

    // Sanity: the chained extends actually fire (matcher work is exercised and
    // the chain resolves — .b-0 gained .a-0, etc.).
    expect(rN.work).toBeGreaterThan(0);
    expect(rN.css).toContain('.a-0');

    // Quadratic ⇒ work(4N)/work(N) ≈ 16; linear ≈ 4. A generous 8× bound fails
    // loudly on the O(I²) rescan (~16×) with headroom for constants and the
    // per-candidate index-lookup term.
    const ratio = r4N.work / rN.work;
    expect(ratio).toBeLessThan(8);

    // Each doubling must stay well under the quadratic ~4×.
    expect(r2N.work / rN.work).toBeLessThan(3.5);
    expect(r4N.work / r2N.work).toBeLessThan(3.5);
  });
});
