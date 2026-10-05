/**
 * Public direct-AST extend contracts.
 *
 * These are deliberately Compiler source-route tests: they assert rendered CSS,
 * never legacy Rules state, spine admission, or plan/solve implementation
 * details. Cross-import closure and reference-import visibility already live in
 * `extend-cross-import.test.ts` with real files and Less 4 output oracles.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

async function render(source: string, collapseNesting = true): Promise<string> {
  return new Compiler({ output: { collapseNesting } }).renderString(source, {
    language: 'less',
    filePath: '/virtual/extend-contract.less'
  });
}

describe('public direct-AST extend contracts', () => {
  it('contains an extend inside its @media scope without changing a root subject', async () => {
    const css = await render([
      '@media screen {',
      '  .a { color: red; }',
      '  .b:extend(.a) {}',
      '}',
      '.a { color: blue; }'
    ].join('\n'));

    expect(css).toBe([
      '@media screen {',
      '  .a,',
      '  .b {',
      '    color: red;',
      '  }',
      '}',
      '.a {',
      '  color: blue;',
      '}',
      ''
    ].join('\n'));
  });

  it('emits a nested extender as its composed selector path', async () => {
    const css = await render([
      '.sidebar { color: red; }',
      '.type1 {',
      '  .sidebar3 { &:extend(.sidebar all); color: green; }',
      '}'
    ].join('\n'));

    expect(css).toBe([
      '.sidebar,',
      '.type1 .sidebar3 {',
      '  color: red;',
      '}',
      '.type1 .sidebar3 {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });

  it('adds a local extender to its matched subject and keeps the extender body', async () => {
    const css = await render('.target { color: red; }\n.ext:extend(.target) { background: blue; }');

    expect(css).toBe([
      '.target,',
      '.ext {',
      '  color: red;',
      '}',
      '.ext {',
      '  background: blue;',
      '}',
      ''
    ].join('\n'));
  });

  it('resolves a typed interpolated extend target through the public compiler route', async () => {
    const css = await render('@name: target; .target { color: red; } .replacement:extend(.@{name}) { color: blue; }');

    expect(css).toBe([
      '.target,',
      '.replacement {',
      '  color: red;',
      '}',
      '.replacement {',
      '  color: blue;',
      '}',
      ''
    ].join('\n'));
  });

  /*
   * The parser-side pin for this lives in less-parser's `ast-grammar.test.ts`
   * and asserts only that a body extend carries no `subject`. That alone would
   * stay green if `plan.ts` inverted its subject ternary, so the rendered
   * consequence is pinned here: absent subject MUST extend every branch, and an
   * inline extend MUST still bind to its own branch alone.
   */
  it('extends every branch of a comma-list rule from a body-form extend', async () => {
    const css = await render([
      '.foo { color: red; }',
      '.ext3, .ext4 { &:extend(.foo all); }'
    ].join('\n'));

    expect(css).toBe([
      '.foo,',
      '.ext3,',
      '.ext4 {',
      '  color: red;',
      '}',
      ''
    ].join('\n'));
  });

  it('binds an inline extend to its own branch, not its comma-siblings', async () => {
    const css = await render([
      '.foo { color: red; }',
      '.ext3:extend(.foo all), .ext4 { border: 0; }'
    ].join('\n'));

    expect(css).toBe([
      '.foo,',
      '.ext3 {',
      '  color: red;',
      '}',
      '.ext3,',
      '.ext4 {',
      '  border: 0;',
      '}',
      ''
    ].join('\n'));
  });

  /*
   * An attribute selector keeps its authored whitespace (ledger O7), but the
   * whitespace is not part of which selector it is: `[ b ]` and `[b]` match
   * each other, while `[a=y i]` (a value and its flag) is not `[a=yi]`.
   */
  it.each([
    ['[ b ] { c: d; }\n.x:extend([b]) {}', '[ b ],\n.x {\n  c: d;\n}\n'],
    ['[b] { c: d; }\n.x:extend([ b ]) {}', '[b],\n.x {\n  c: d;\n}\n'],
    ['a[href="x" i] { c: d; }\n.x:extend(a[href="x"i]) {}', 'a[href="x" i],\n.x {\n  c: d;\n}\n'],
    ['[ b ].k { c: d; }\n.x:extend([b] all) {}', ':is([ b ], .x).k {\n  c: d;\n}\n'],
    ['[a=y i] { c: d; }\n.x:extend([a=yi]) {}', '[a=y i] {\n  c: d;\n}\n']
  ])('matches an attribute selector whatever its authored whitespace: %j', async (source, expected) => {
    expect(await render(source)).toBe(expected);
  });

  /*
   * A rule reached through a mixin call extends and is extended where it lands: inside
   * the `@media` the call lands in (EXTEND-SEMANTICS §8, jess#360), and as its composed
   * selector parts, so a compound target can meet it (jess#361). That holds for a ruleset
   * called as a mixin and for a detached ruleset's call too (EXTEND-SEMANTICS §6).
   */
  it.each([
    [
      '.sm { b: 2; }\n@media print {\n  .m() { .x { &:extend(.sm); } }\n  .m();\n}',
      '.sm {\n  b: 2;\n}\n'
    ],
    [
      '.m() { .x { &:extend(.sm); } }\n.sm { b: 2; }\n@media print {\n  .sm { c: 3; }\n  .m();\n}',
      '.sm {\n  b: 2;\n}\n@media print {\n  .sm,\n  .x {\n    c: 3;\n  }\n}\n'
    ],
    [
      '.m() { .p { &.q, &.r { a: 1; } } }\n.m();\n.x:extend(.p.q) {}',
      '.p.q,\n.p.r,\n.x {\n  a: 1;\n}\n'
    ],
    [
      '.b { .m(); }\n.m() { .p { .q { a: 1; } } }\n.x:extend(.b .p .q) {}',
      '.b .p .q,\n.x {\n  a: 1;\n}\n'
    ],
    [
      '.a { .p { a: 1; } }\n.z { .a(); }\n.x:extend(.z .p) {}',
      '.a .p {\n  a: 1;\n}\n.z .p,\n.x {\n  a: 1;\n}\n'
    ],
    [
      '@dr: { .p { a: 1; } };\n.w { @dr(); }\n.x:extend(.w .p) {}',
      '.w .p,\n.x {\n  a: 1;\n}\n'
    ]
  ])('places a mixin-body rule where the call lands: %j', async (source, expected) => {
    expect(await render(source)).toBe(expected);
  });

  /*
   * Nested output (the v5 default): a mixin-body extender folds in as its selector composed
   * under the rules the call lands in, once per call.
   */
  it.each([
    [
      '.sm { b: 2; }\n@media print {\n  .m() { .x { &:extend(.sm); } }\n  .m();\n}',
      '.sm {\n  b: 2;\n}\n'
    ],
    [
      '.sm { b: 2; }\n.m() { .x { &:extend(.sm); } }\n.a { .m(); }\n.b { .m(); }',
      '.sm,\n.a .x,\n.b .x {\n  b: 2;\n}\n'
    ]
  ])('places a mixin-body extender where the call lands in nested output: %j', async (source, expected) => {
    expect(await render(source, false)).toBe(expected);
  });

  it('rejects a comma-list parent in a non-leading ampersand merge template', async () => {
    await expect(render([
      '@list-quoted: ~\'apple, satsuma, banana, pear\';',
      '@{list-quoted} { .fruit-quoted-& { content: "Quoted"; } }'
    ].join('\n'))).rejects.toMatchObject({ code: 'selector/comma-list-interpolation' });
  });
});
