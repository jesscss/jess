/**
 * MEMO CORRECTNESS DIFFERENTIAL (extend-matcher pass-scoped memoization)
 *
 * The chained-extend matcher memoizes `wouldExtendChange` / `decomposeFind` for
 * the duration of one `processExtends` pass, keyed on
 *   `${partial} ${target.valueOf()} ${find.valueOf()} ${extendWith.valueOf()} ${parentSelector.valueOf()}`
 * (installed by `beginExtendMatchPass`, added in commit b09439775).
 *
 * RISK the memo could UNDER-KEY: `wouldExtendChange`'s result is computed by
 * `wouldMatchNode`, which reads STRUCTURAL properties of `target`
 * (isNode(...ComplexSelector/CompoundSelector/Ampersand/PseudoSelector...),
 * `.value`, `hasFlag(F_AMPERSAND)`, `getStoredSelector()`) — not just its
 * `valueOf()`. A string-backed selector leaf (emitted by the LESS parser per the
 * strings-not-nodes model) can share a `valueOf()` with a materialized node but
 * descend differently. If both reach the memo as `target` in one pass, a stale
 * cache entry would silently drop/add an extend.
 *
 * This test renders extend-heavy sheets with the memo ON vs OFF (via the
 * test-only `setExtendMatchMemoEnabled` hatch — with the memo OFF,
 * `beginExtendMatchPass` installs no caches, so every probe recomputes) and
 * asserts BYTE-IDENTICAL CSS. Any divergence => an under-keying bug in the
 * shipped memo. All sources go through the real LESS parser so string-backed
 * leaves are exercised.
 */
import { describe, it, expect } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { setExtendMatchMemoEnabled } from '../util/extend-walk.js';
import { isSpineEligibleRoot } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';

async function renderLess(source: string, collapseNesting: boolean): Promise<string> {
  const context = new Context({ output: { collapseNesting }, leakyScope: true });
  const parser = new Parser();
  const { tree } = parser.parse(source);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const root = tree as unknown as Rules;
  // D-EVAL FLIP: the spine owns the TOP-LEVEL render for a spine-eligible root; a
  // non-eligible extend root renders through the RETAINED eval + serialize path via a
  // no-op `preSerializeRoot` visitor — byte-identical to the pre-flip top-level render.
  const eligible = isSpineEligibleRoot(root, context, collapseNesting);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return (await renderNodeToString(root as unknown as RenderBufferNode, context, eligible ? { context } : { context, preSerializeRoot: r => r })).trim();
}

/** Render the same source with the memo ON and OFF; return both outputs. */
async function renderBothModes(
  source: string,
  collapseNesting: boolean
): Promise<{ on: string; off: string }> {
  setExtendMatchMemoEnabled(true);
  let on: string;
  try {
    on = await renderLess(source, collapseNesting);
  } finally {
    setExtendMatchMemoEnabled(true);
  }
  setExtendMatchMemoEnabled(false);
  let off: string;
  try {
    off = await renderLess(source, collapseNesting);
  } finally {
    setExtendMatchMemoEnabled(true);
  }
  return { on, off };
}

/**
 * Adversarial extend sheets. Each is designed to stress a distinct dimension of
 * the memo key. If the memo under-keys, memo-ON output diverges from memo-OFF.
 */
const CASES: Array<{ name: string; source: string; collapse: boolean }> = [
  {
    // Multiple distinct extendWith values against the SAME (target, find, partial).
    // Under-keying on extendWith would collapse these to one answer.
    name: 'same target/find/partial, different extendWith (chained)',
    collapse: true,
    source: `
.base { color: red; }
.a:extend(.base) { a: 1; }
.b:extend(.base) { b: 2; }
.c:extend(.base) { c: 3; }
.chain1:extend(.a) { x: 1; }
.chain2:extend(.b) { y: 2; }
.chain3:extend(.c) { z: 3; }
`
  },
  {
    // Partial vs whole (all) against the same target — `partial` is in the key.
    name: 'partial and whole extends of the same target',
    collapse: true,
    source: `
.thing { color: red; }
.whole:extend(.thing) { w: 1; }
.partial:extend(.thing all) { p: 1; }
.wrap {
  .thing.other { color: blue; }
}
`
  },
  {
    // :is()/compound/complex targets under one pass — structural descent differs
    // per shape but valueOf may coincide between authored and generated forms.
    name: 'compound + complex + is() targets mixed',
    collapse: true,
    source: `
.x.y { color: red; }
.p .q { color: green; }
.a:extend(.x all) { a: 1; }
.b:extend(.y all) { b: 2; }
.c:extend(.q all) { c: 3; }
.d:extend(.p all) { d: 4; }
`
  },
  {
    // Cross-@media boundary: extends must not leak across media, and the
    // extend-not-accessible probe (05a144c71) materializes string-backed targets.
    name: 'cross-@media extends (accessibility probe)',
    collapse: true,
    source: `
.base { color: red; }
@media screen {
  .base { color: blue; }
  .m:extend(.base) { m: 1; }
}
.top:extend(.base) { t: 1; }
`
  },
  {
    // Parser-shaped complex string leaves: ComplexSelector(['.foo',' ','.bar'])
    // as target vs a simple `.bar` find — the string-leaf vs materialized concern
    // (c64321e81, df4a9e653) at the top-level target position.
    name: 'string-leaf complex target vs simple find',
    collapse: false,
    source: `
.foo .bar { color: red; }
.bar { color: green; }
.consumer:extend(.bar all) { c: 1; }
.other:extend(.foo all) { o: 1; }
`
  },
  {
    // Multi-same-target: many selectors extend the identical target; the memo
    // must return the SAME per-source-selector result (target differs each call).
    name: 'multi same-target extends',
    collapse: true,
    source: `
.hub { color: red; }
.n1:extend(.hub) {}
.n2:extend(.hub) {}
.n3:extend(.hub) {}
.n4:extend(.hub) {}
.hub.k1 { a: 1; }
.hub.k2 { b: 2; }
`
  },
  {
    // & / parentSelector-sensitive: exact extends under a parent go through the
    // composeSelector + recursive wouldExtendChange probe (parentSelector in key).
    name: 'parent-selector ampersand exact extends',
    collapse: false,
    source: `
.parent {
  &.child { color: red; }
  .inner:extend(.parent.child all) { i: 1; }
}
.sibling:extend(.parent.child all) { s: 1; }
`
  },
  {
    // Chained multi-hop: A extends B extends C — each hop is a distinct
    // (target,find,extendWith) but shares sub-values, maximizing key pressure.
    name: 'multi-hop chained extends',
    collapse: true,
    source: `
.c { color: red; }
.b:extend(.c) { b: 1; }
.a:extend(.b) { a: 1; }
.z:extend(.a) { z: 1; }
.c.tag { t: 1; }
`
  },
  {
    // @layer boundary variant of the cross-scope probe.
    name: 'cross-@layer extends',
    collapse: true,
    source: `
.base { color: red; }
@layer comps {
  .base { color: blue; }
  .l:extend(.base) { l: 1; }
}
.top:extend(.base) { t: 1; }
`
  },
  {
    // Selector-list target: extend(.a, .b) style — list decomposition per item.
    name: 'selector-list producing extends',
    collapse: true,
    source: `
.a, .b { color: red; }
.x:extend(.a all) { x: 1; }
.y:extend(.b all) { y: 1; }
.a.b { ab: 1; }
`
  }
];

describe('extend-matcher memo differential (memo ON === memo OFF)', () => {
  for (const c of CASES) {
    it(`byte-identical: ${c.name}`, async () => {
      const { on, off } = await renderBothModes(c.source, c.collapse);
      // The load-bearing assertion: memoized output must equal unmemoized output.
      expect(on).toBe(off);
      // Guard against a degenerate empty render masking a difference.
      expect(off.length).toBeGreaterThan(0);
    });
  }
});
