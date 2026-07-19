import { describe, it, expect } from 'vitest';
import { renderLessViaAst } from '../index.js';

/**
 * [calc] A variable holding a preserved-division slash group (`@var: 50vh/2`,
 * represented by the canonical AST as a `SpacedValue [50vh, '/', 2]`) that is spliced into
 * a `calc(…)` must COMPUTE the division — inside calc, `/` is math, not a list
 * separator. Once the division folds to a single dimension (`25vh`), the outer
 * calc operation keeps the parens around the simplified operand
 * (`calc(50% + (25vh - 20px))`), matching Less 4.x and the v5 `calc.css` golden.
 *
 * An inline `50vh/2` written directly inside calc already parses as an
 * `Operation`; this guards the variable-REFERENCE form folding identically.
 */
function render(src: string): string {
  const result = renderLessViaAst(src, { collapseNesting: true });
  if (result.threw) {
    throw result.threw;
  }
  if (result.css === undefined) {
    throw new Error('Less AST render returned no CSS');
  }
  return result.css;
}

const cases: Array<[name: string, src: string, css: string]> = [
  [
    'slash-group var simplifies + keeps parens inside calc',
    '@var: 50vh/2;\n.a { width: calc(50% + (@var - 20px)); }\n',
    '.a {\n  width: calc(50% + (25vh - 20px));\n}\n'
  ],
  [
    'double-paren collapses to one around the simplified operand',
    '@var: 50vh/2;\n.a { height: calc(50% + ((@var - 20px))); }\n',
    '.a {\n  height: calc(50% + (25vh - 20px));\n}\n'
  ],
  [
    // fully-computed same-unit operand collapses to a single dimension, so the
    // now-redundant parens are stripped (matches Less: `calc(10% + 23px)`).
    'same-unit slash-group var fully computes inside calc',
    '@var: 100px/4;\n.a { width: calc(10% + (@var - 2px)); }\n',
    '.a {\n  width: calc(10% + 23px);\n}\n'
  ],
  [
    'inline division parses as Operation and folds the same',
    '.a { width: calc(50% + (50vh/2 - 20px)); }\n',
    '.a {\n  width: calc(50% + (25vh - 20px));\n}\n'
  ]
];

describe('[calc] variable-held division simplifies inside calc()', () => {
  for (const [name, src, css] of cases) {
    it(name, () => {
      expect(render(src)).toBe(css);
    });
  }
});
