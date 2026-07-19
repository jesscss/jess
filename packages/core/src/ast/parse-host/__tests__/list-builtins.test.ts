import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * List-consuming builtins (`length`/`extract`) + the `~( … )` escaped list.
 *
 * A variable-bound SPACE list (`@v: a b c`) and a COMMA list (`@v: a, b, c`) both
 * reach the value layer as a STRUCTURED list (never a flat `Any` the fn re-splits
 * on bytes), so `length` counts and `extract` indexes the real items — item refs
 * resolve, and the inter-item spacing normalizes (`a  b  c` → `a b c`). An escaped
 * paren `~(1, 2, 3)` / `~(1 2 3)` UNWRAPS to its evaluable list (the raw list Less
 * produces), so downstream `length`/`extract`/`each` see its items.
 */
const ev = buildEvaluator(makeBuiltinRegistry());
const render = (src: string): string | undefined => renderAstDoc(src, { evaluator: ev }).css;

describe('list builtins consume the structured list (space + comma)', () => {
  const cases: Array<[name: string, src: string, css: string]> = [
    [
      'length/extract on a variable SPACE list',
      '@v: a b c d;\n.a { l: length(@v); e: extract(@v, 2); }\n',
      '.a {\n  l: 4;\n  e: b;\n}\n',
    ],
    [
      'a double-space space list normalizes on out-of-range verbatim re-emit',
      '@v: a  b  c;\n.a { e: extract(@v, 5); }\n',
      '.a {\n  e: extract(a b c, 5);\n}\n',
    ],
    [
      'length/extract on a variable COMMA list',
      '@v: a, b, c;\n.a { l: length(@v); e: extract(@v, 3); }\n',
      '.a {\n  l: 3;\n  e: c;\n}\n',
    ],
    [
      'a space list of comma-list refs indexes the top-level space items (refs resolve)',
      '@a: a, b, c;\n@b: 1, 2, 3;\n@c: x, y, z;\n@v: @a @b @c;\n'
        + '.a { l: length(@v); e: extract(@v, 2); }\n',
      '.a {\n  l: 3;\n  e: 1, 2, 3;\n}\n',
    ],
  ];
  it.each(cases)('%s', (_name, src, css) => {
    expect(render(src)).toBe(css);
  });
});

describe('~( … ) escaped list is evaluable', () => {
  const cases: Array<[name: string, src: string, css: string]> = [
    [
      'a comma escaped list emits without parens and is length/extract-able',
      '@l: ~(1, 2, 3);\n.a { list: @l; len: length(@l); e: extract(@l, 3); }\n',
      '.a {\n  list: 1, 2, 3;\n  len: 3;\n  e: 3;\n}\n',
    ],
    [
      'a space escaped list is length/extract-able',
      '@l: ~(1 2 3);\n.a { len: length(@l); e: extract(@l, 2); }\n',
      '.a {\n  len: 3;\n  e: 2;\n}\n',
    ],
    [
      'each() iterates an escaped list',
      '.a {\n  each(~(1 2 3), {\n    item-@{value}: @value;\n  });\n}\n',
      '.a {\n  item-1: 1;\n  item-2: 2;\n  item-3: 3;\n}\n',
    ],
  ];
  it.each(cases)('%s', (_name, src, css) => {
    expect(render(src)).toBe(css);
  });
});
