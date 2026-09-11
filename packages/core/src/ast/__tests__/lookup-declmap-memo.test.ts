import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';

/**
 * [lookup-memo] Regression lock for the member-lookup DeclMap memo
 * (`MIXIN-SCOPING-AND-LOOKUP-MEMO.md` §4). Repeated `BASE[member]` reads on a pure
 * base (detached ruleset / collection / namespace selector) must return the correct
 * member every time — the memo caches the INDEX, member values still resolve live —
 * and output must be byte-identical whether the memo is on or off. If a future change
 * lets the memo return a stale/wrong map, or breaks its transparency, this fails.
 *
 * The on/off transparency is asserted here structurally by pinning the output; the
 * env knob `JESS_NO_DECLMAP_MEMO=1` reproduces the un-memoized path for a manual
 * differential (the const is read at module load, so a same-process toggle is not
 * meaningful — the pinned output below is the committed lock).
 */
const evaluator = buildEvaluator(makeLessRegistry());
const render = (src: string): string =>
  serialize(parseLess(src), { evaluator, collapseNesting: true }).css ?? '';

describe('member-lookup DeclMap memo (correctness lock)', () => {
  it('repeated reads of a detached-ruleset member resolve correctly each time', () => {
    const src = '@m: { one: 1; two: 2; three: 3; };\n'
      + '.a { a: @m[one]; b: @m[two]; c: @m[one]; d: @m[three]; e: @m[two]; }\n';
    expect(render(src)).toBe('.a {\n  a: 1;\n  b: 2;\n  c: 1;\n  d: 3;\n  e: 2;\n}\n');
  });

  it('repeated reads through a chained accessor share the resolved base', () => {
    // `@a: @m` then `@a[x]` and `@m[x]` resolve to the same pure base.
    const src = '@m: { k: red; };\n@a: @m;\n.x { one: @a[k]; two: @m[k]; three: @a[k]; }\n';
    expect(render(src)).toBe('.x {\n  one: red;\n  two: red;\n  three: red;\n}\n');
  });

  it('a member whose value references a sibling member still resolves live per read', () => {
    // Guards that the memo caches the index, not evaluated values: `two` depends on `one`.
    const src = '@m: { one: 2px; two: (@m[one] * 2); };\n'
      + '.a { x: @m[two]; y: @m[one]; z: @m[two]; }\n';
    expect(render(src)).toBe('.a {\n  x: 4px;\n  y: 2px;\n  z: 4px;\n}\n');
  });
});
