import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst, UnsupportedShape } from './bridge.js';
import { buildEvaluator } from '../../evaluator.js';
import { renderRealOracleNested } from './oracle.js';

/**
 * R0 — `collapseNesting:false` NESTED output (the Less v5 default) proven
 * BYTE-IDENTICAL against the REAL oracle rendered in nested form. Covers the
 * features tree2 already supports, in the nested emit shape: plain rules,
 * nesting & `&`, declarations/values/variables, mixin placement, at-rules /
 * @media, guards.
 *
 * The concrete nested shape is SOURCED from the oracle (v5 proxy), not assumed:
 *   - each nested rule emits its OWN local selector verbatim (`&:hover`, `> .b`,
 *     `.b &`, `.b, .c` stay literal — never composed with the parent);
 *   - a placed mixin body splices inline under the call site (its nested rules
 *     nest there, keeping their own selectors);
 *   - `@media` bodies keep their inner rules nested (no bubbling, no merge);
 *   - a rule/at-rule whose body is empty is dropped.
 */
const inputs: Array<[string, string]> = [
  // plain rules + declarations
  ['plain', '.a { color: red; }\n'],
  ['two-decls', '.a { color: red; font-size: 12px; }\n'],
  // nesting + &
  ['nest', '.a { color: red; .b { color: blue; } }\n'],
  ['amp-hover', '.a { color: red; &:hover { color: blue; } }\n'],
  ['amp-class', '.a { &.b { color: blue; } }\n'],
  ['deep', '.a { .b { .c { color: red; } } }\n'],
  ['list-parent', '.a, .b { .c { color: red; } }\n'],
  ['nested-child-list', '.a { .b, .c { color: red; } }\n'],
  ['child-comb-nested', '.a { & > .b { color: red; } }\n'],
  ['amp-descendant', '.a { .b & { color: red; } }\n'],
  // decl / nested-rule ordering (source order preserved, no flush-split)
  ['decl-nest-decl', '.a { color: red; .b { x: 1; } y: 2; }\n'],
  ['nest-decl-nest', '.a { .b { x: 1; } m: 1; .c { y: 2; } }\n'],
  ['two-siblings', '.a { .b { x: 1; } .c { y: 2; } }\n'],
  // variables
  ['var-in-nested', '@c: red; .a { .b { color: @c; } }\n'],
  ['var-shadow', '@c: red; .a { @c: blue; .b { color: @c; } }\n'],
  // mixin placement (splice inline under call site)
  ['mixin-decls', '.m() { color: red; } .a { .m(); border: 1px; }\n'],
  ['mixin-nested-rule', '.m() { color: red; .inner { x: 1; } } .a { .m(); }\n'],
  ['mixin-param', '.m(@c) { color: @c; } .a { .m(green); }\n'],
  ['mixin-at-root', '.m() { .inner { x: 1; } } .m();\n'],
  // guards / overloaded dispatch, nested body
  ['guard-nested', '.m(@x) when (@x > 0) { .b { color: blue; } } .c { .m(1); }\n'],
  // at-rules / @media
  ['media-top', '@media screen { .a { color: red; } }\n'],
  ['media-nest-rule', '@media screen { .a { .b { color: red; } } }\n'],
  ['media-decl', '@media screen { color: blue; }\n'],
  ['media-two', '@media print { .a { color: red; } }\n@media print { .b { color: blue; } }\n'],
  ['namespace-stmt', '@namespace svg "http://example.com/svg";\n.a { color: red; }\n'],
  ['keyframes', '@keyframes slidein { from { margin-left: 100%; } to { margin-left: 0%; } }\n'],
  ['font-face', "@font-face { font-family: xecret; src: url('a.ttf'); }\n"],
  ['supports-nested', '@supports (display: grid) { .a { .b { color: red; } } }\n'],
  // empty-block elision
  ['empty-rule', '.a { }\n.b { color: red; }\n'],
  ['def-only-parent', '.a { .m() { color: red; } }\n.b { color: red; }\n'],
];

describe('R0 — nested (collapseNesting:false) byte-identity (vs REAL nested oracle)', () => {
  for (const [name, src] of inputs) {
    it(name, async () => {
      const parsed = parseLessFn(src);
      let bridged;
      try {
        bridged = bridgeToAst(parsed.tree, src);
      } catch (e) {
        if (e instanceof UnsupportedShape)
          throw new Error(`UNSUPPORTED ${e.feature} (${e.detail}) for: ${src.trim()}`);
        throw e;
      }
      const evaluator = buildEvaluator();
      const t2css = (await serialize(bridged, { evaluator, collapseNesting: false })).css;
      const oracle = await renderRealOracleNested(parseLessFn(src).tree);
      if (t2css !== oracle) {
        console.log(
          `\n--- ${name} ---\nSRC: ${JSON.stringify(src)}\nT2 : ${JSON.stringify(t2css)}\nORC: ${JSON.stringify(oracle)}`,
        );
      }
      expect(t2css).toBe(oracle);
    });
  }
});
