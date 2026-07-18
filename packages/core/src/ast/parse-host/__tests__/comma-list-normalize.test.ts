import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * v5 comma value-list separator NORMALIZATION.
 *
 * A structured comma `List` value serializes its inter-item separator by the v5
 * convention, NOT by echoing the authored source bytes: any inline spacing around
 * a comma collapses to the canonical `, ` (so `a,b`, `a ,  b`, and `a, b` all emit
 * `a, b`). This is pinned by the `.css` acceptance goldens — e.g. css-escapes turns
 * a source `'a','b', c` into `'a', 'b', c`.
 *
 * A separator that carries a NEWLINE keeps the authored multi-line layout (the
 * newline + following indentation), so a wrapped comma list such as a multi-line
 * `box-shadow` stays wrapped (css-3.css). "Verbatim values" (a literal token keeps
 * its source bytes) governs the ITEM tokens only, never the separator spacing.
 */
const ev = buildEvaluator(makeBuiltinRegistry());
const render = (src: string): string | undefined => renderAstDoc(src, { evaluator: ev }).css;

const cases: Array<[name: string, src: string, css: string]> = [
  [
    'no space after comma → normalized to ", "',
    '.a { font-family: Arial,sans-serif; }\n',
    '.a {\n  font-family: Arial, sans-serif;\n}\n',
  ],
  [
    'ragged inline spacing → all normalized to ", "',
    ".a { font-family: 'x','y', z; }\n",
    ".a {\n  font-family: 'x', 'y', z;\n}\n",
  ],
  [
    'space before comma → normalized to ", "',
    '.a { grid: a ,  b ,c; }\n',
    '.a {\n  grid: a, b, c;\n}\n',
  ],
  [
    'already-canonical stays canonical',
    '.a { font-family: Arial, sans-serif; }\n',
    '.a {\n  font-family: Arial, sans-serif;\n}\n',
  ],
  [
    'variable comma-list normalizes',
    '@v: a,b,c;\n.a { grid: @v; }\n',
    '.a {\n  grid: a, b, c;\n}\n',
  ],
  [
    'multi-line separator keeps its newline + indentation',
    '.a {\n  box-shadow: 0 1px 3px red,\n    0 4px 6px blue;\n}\n',
    '.a {\n  box-shadow: 0 1px 3px red,\n    0 4px 6px blue;\n}\n',
  ],
];

describe('comma value-list separator normalization (v5)', () => {
  for (const [name, src, css] of cases) {
    it(name, () => {
      expect(render(src)).toBe(css);
    });
  }
});
