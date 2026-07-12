/**
 * spine-wire-selector-shapes.test.ts — RATCHET for the extend-selector P4 shapes wired into the
 * `wireSpineExtends` gather/compose (the shapes that flip `extend-selector.less`).
 * ====================================================================================================
 *
 * These pin the PIPELINE-LEVEL output (`wireSpineExtends` header overrides) for the shapes landed in
 * the extend-selector P4 cluster, BYPASSING the gate (which admits the whole fixture only once every
 * shape — incl. the two prototype-first residuals #4/#5 — folds). Each expected header is pinned from
 * the ratified v5 alpha `extend-selector.css` (normalized to the internal `valueOf` form: comma-joined,
 * no post-comma space — the CSS writer's `, ` spacing is a serialization concern above this layer).
 *
 *   #1 STANDALONE `Rules`-wrapped extend (`.should-not-exist-in-output, .ext7:extend(.ext5 all) {}`
 *      parses as a bare `Rules` node, its extender own is the `Extend` node's branch selector `.ext7`):
 *      subject `div.ext5, .ext6 > .ext5` gains `.ext7` per branch → `div:is(.ext5,.ext7),
 *      .ext6>:is(.ext5,.ext7)` (extend-selector.css:5-6). Child combinator handled by the matcher.
 *   #2 EXPANDED-MODE NESTED in-place rewrite: a nested subject's BARE local rewritten by SOLVE
 *      (`[data="test"]` → `[data="test"],.attribute-test`, css:32-33; inner `.replace,.c` →
 *      `.replace,.c,.rep_ace`, css:25-27).
 *   #3 `.replace` outer (root-level, `+`-sibling): `:is(.replace,.rep_ace):is(.replace,.rep_ace),
 *      .c:is(.replace,.rep_ace)+:is(.replace,.rep_ace)` (css:23-24) — via the fire-once-per-instruction
 *      SOLVE fix (the round-2 self-re-match `.replace` inside its own `:is(.replace,.rep_ace)` graft is
 *      retired instead of tripping the is-graft-target UNSUPPORTED trap).
 *
 * @see extend-selector.css (ratified oracle), UNIFIED-EVAL-EMIT-DESIGN.md §4.3.
 */
import { describe, it, expect } from 'vitest';
import { Parser } from '../../../../../less-parser/src/index.js';
import { Context } from '../../../context.js';
import { wireSpineExtends } from '../spine-extend.js';

function headersFor(src: string, collapseNesting: boolean): Map<string, string> {
  const parser = new Parser();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const { tree } = parser.parse(src) as { tree: Parameters<typeof wireSpineExtends>[0] };
  const context = new Context({ output: { collapseNesting }, leakyScope: true });
  const { headers } = wireSpineExtends(tree, context, collapseNesting);
  const out = new Map<string, string>();
  for (const [ruleset, selector] of headers) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const key = String((ruleset as unknown as { selector?: { valueOf(): unknown } }).selector?.valueOf() ?? '');
    out.set(key, String(selector.valueOf()));
  }
  return out;
}

describe('spine wire-in — extend-selector P4 shapes (gate-bypassed, pipeline output pinned to alpha .css)', () => {
  const EXT5 = `.ext5-x { }\ndiv.ext5, .ext6 > .ext5 { width: 100px; }\n.should-not-exist-in-output, .ext7:extend(.ext5 all) {}`;
  it('#1 standalone Rules-wrapped extend: subject gains the branch extender across a `>` combinator', () => {
    const headers = headersFor(EXT5, false);
    expect(headers.get('div.ext5,.ext6 > .ext5')).toBe('div:is(.ext5,.ext7),.ext6>:is(.ext5,.ext7)');
  });

  const ATTR = `.attributes {\n  [data="test"] { extend: attributes; }\n  .attribute-test { &:extend([data="test"] all); }\n  [data] { extend: attributes2; }\n  .attribute-test2 { &:extend([data] all); }\n}`;
  it('#2 expanded-mode nested in-place: an attribute-target subject gains the sibling extender (bare)', () => {
    const headers = headersFor(ATTR, false);
    expect(headers.get('[data="test"]')).toBe('[data="test"],.attribute-test');
    expect(headers.get('[data]')).toBe('[data],.attribute-test2');
  });

  const REPLACE = `.replace.replace, .c.replace + .replace {\n  .replace, .c { prop: copy-paste-replace; }\n}\n.rep_ace:extend(.replace all) {}`;
  it('#2/#3 `.replace`: inner bare in-place rewrite + outer `+`-sibling root rewrite (fire-once)', () => {
    const headers = headersFor(REPLACE, false);
    // inner nested block: bare in-place
    expect(headers.get('.replace,.c')).toBe('.replace,.c,.rep_ace');
    // outer root-level: the `+`-combinator in-place `:is`-wrap, no round-2 UNSUPPORTED self-re-match
    expect(headers.get('.replace.replace,.c.replace + .replace'))
      .toBe(':is(.replace,.rep_ace):is(.replace,.rep_ace),.c:is(.replace,.rep_ace)+:is(.replace,.rep_ace)');
  });
});
