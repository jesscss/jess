import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * E1 — the Less `each(<iterable>, <callback>)` loop, expanded by the ast/ engine
 * as a statement-emitting control-flow node (`For`). The grammar lowers `each(...)`
 * to a `For` node and the serializer (`expandFor`) emits the callback body once per
 * iterable item, binding `@value`/`@key`/`@index` (or the anonymous-mixin param
 * names) per iteration — matching less.js 4.x `each` semantics for lists, maps,
 * ranges, and nested loops.
 *
 * Oracle: less.js 4.x `each` output, EXCEPT where v5 diverges by design — the
 * `+:`/`+_:` merge anchors at the LAST occurrence (intended v5), so a per-iteration
 * merge (`index+: @index`) lands at its last placement, not 4.x's first. The cases
 * here avoid that ordering-only divergence so they assert byte-exact v5 output.
 */
const ev = buildEvaluator(makeBuiltinRegistry());
const render = (src: string): string | undefined => renderAstDoc(src, { evaluator: ev }).css;

const cases: Array<[name: string, src: string, css: string]> = [
  [
    'list merge into a comma value',
    '.foo { each(1 2 3, { c+: @value; }); }\n',
    '.foo {\n  c: 1, 2, 3;\n}\n',
  ],
  [
    'comma-list var → nested selector per item',
    '@selectors: blue, green, red;\neach(@selectors, {\n  .sel-@{value} { a: b; }\n});\n',
    '.sel-blue {\n  a: b;\n}\n.sel-green {\n  a: b;\n}\n.sel-red {\n  a: b;\n}\n',
  ],
  [
    'space-list var → index + value bindings',
    '@list: a b c d;\n.each { each(@list, { item@{index}: @value; }); }\n',
    '.each {\n  item1: a;\n  item2: b;\n  item3: c;\n  item4: d;\n}\n',
  ],
  [
    'range() iterable (typed List items)',
    '.col { each(range(3), { w-@{value}: @value; }); }\n',
    '.col {\n  w-1: 1;\n  w-2: 2;\n  w-3: 3;\n}\n',
  ],
  [
    'map iterable → @key / @value',
    '@set: {\n  one: blue;\n  two: green;\n  three: red;\n}\n.set { each(@set, { @{key}: @value; }); }\n',
    '.set {\n  one: blue;\n  two: green;\n  three: red;\n}\n',
  ],
  [
    'typed @value in arithmetic (vector merge)',
    '.single { each(1 2 3 4, { padding+_: (@value * 10px); }); }\n',
    '.single {\n  padding: 10px 20px 30px 40px;\n}\n',
  ],
  [
    'anonymous-mixin callback names the loop vars',
    '.anon { each(a b, .(@v, @i) { nn-@{i}: @v; }); }\n',
    '.anon {\n  nn-1: a;\n  nn-2: b;\n}\n',
  ],
  [
    'single scalar iterable → one item',
    '.single { each(true, { val: @value; }); }\n',
    '.single {\n  val: true;\n}\n',
  ],
  [
    'escaped string is one item (not byte-split)',
    '.a { @list: e("90 100 110"); each(@list, { .w-@{key} { width: @value; } }); }\n',
    '.a .w-1 {\n  width: 90 100 110;\n}\n',
  ],
  [
    'nested each over a comma-list-of-space-lists',
    '.n { each(10px 15px, 20px 25px; { each(@value; #(@v, @k, @i) { r-@{i}: @v @k; }); }); }\n',
    '.n {\n  r-1: 10px 1;\n  r-2: 15px 2;\n  r-1: 20px 1;\n  r-2: 25px 2;\n}\n',
  ],
];

describe('each() statement emission (E1)', () => {
  for (const [name, src, css] of cases) {
    it(name, () => {
      expect(render(src)).toBe(css);
    });
  }
});
