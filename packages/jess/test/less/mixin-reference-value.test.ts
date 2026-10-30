import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * A Less variable may hold a mixin reference (`@foo: .a;`, ledger P33,
 * jess#236). Called, looked into or passed to a mixin it is that mixin;
 * written into a value it has nothing to write, so the read that writes it is
 * `eval/uncalled-mixin-reference` and the compile fails (owner 2026-10-29:
 * "we are supposed to mark things as being errors when materialized in
 * certain places").
 */
async function render(source: string) {
  return new Compiler().renderToResult(
    { source, filePath: 'entry.less', extension: '.less' },
    { breakOnError: false }
  );
}

const mixin = '.a { c: 1; }\n#ns { .a { c: 1; } }\n';

describe('a mixin reference held in a Less variable', () => {
  it.each([
    ['a declaration value', '@foo: .a;\n.b { b: @foo; }', 9],
    ['a namespaced reference', '@foo: #ns.a;\n.b { b: @foo; }', 9],
    ['a reference with a combinator', '@foo: #ns > .a;\n.b { b: @foo; }', 9],
    ['a reference to an undefined mixin', '@foo: .nope;\n.b { b: @foo; }', 9],
    ['a space-separated list', '@foo: .a;\n.b { b: 1 @foo 2; }', 11],
    ['a comma-separated list', '@foo: .a;\n.b { b: x, @foo; }', 12],
    ['an e() argument', '@foo: .a;\n.b { b: e(@foo); }', 11],
    ['a %() argument', '@foo: .a;\n.b { b: %("%s", @foo); }', 17],
    ['an unknown function\'s argument', '@foo: .a;\n.b { b: foo(@foo); }', 13],
    ['an if() branch', '@foo: .a;\n.b { b: if(true, @foo, 1); }', 18],
    ['a variable variable', '@foo: .a;\n@n: foo;\n.b { b: @@n; }', 9],
    ['a media query', '@foo: .a;\n@media (min-width: @foo) { .b { c: 1; } }', 20]
  ])('writing it into %s is an error at the read', async (_route, written, column) => {
    const source = mixin + written;
    const result = await render(source);

    expect(result.css).toBe('');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'eval/uncalled-mixin-reference',
      phase: 'eval',
      line: source.split('\n').length,
      column
    });
  });

  it('names the variable it reads in the reason and the fix', async () => {
    const result = await render(mixin + '@foo: .a;\n.b { b: @foo; }');

    expect(result.errors[0]).toMatchObject({
      message: 'A mixin reference is not a value',
      reason: '@foo is a mixin reference, neither called nor looked up here, so it has no value to write.',
      fix: 'Call the mixin in statement position, for example @foo();, or look up one of its members, for example @foo[name].'
    });
  });

  it('reports a variable that aliases it at the alias\'s read', async () => {
    const result = await render(mixin + '@foo: .a;\n@bar: @foo;\n.b { b: @bar; }');

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'eval/uncalled-mixin-reference', line: 4, column: 7 });
  });

  it('reports a member that holds one at the lookup', async () => {
    const result = await render(mixin + '@r: { @foo: .a; }\n.b { b: @r[@foo]; }');

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'eval/uncalled-mixin-reference', line: 4, column: 9 });
  });

  it.each([
    ['a quoted string', '@foo: .a;\n.b { b: "@{foo}"; }'],
    ['an escaped string', '@foo: .a;\n.b { b: ~"@{foo}"; }'],
    ['a selector', '@foo: .a;\n.b-@{foo} { c: 1; }'],
    ['a property name', '@foo: .a;\n.b { @{foo}: 1; }']
  ])('interpolating it into %s is an error', async (_route, written) => {
    const result = await render(mixin + written);

    expect(result.css).toBe('');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'eval/uncalled-mixin-reference', phase: 'eval' });
  });

  /*
   * An interpolated reference carries no source span, so its error, like
   * `resolve/name-not-found` for `@{nope}`, is placed at the start of the file.
   */
  it.fails('places an interpolation error at the interpolation', async () => {
    const result = await render(mixin + '@foo: .a;\n.b { b: "@{foo}"; }');

    expect(result.errors[0]).toMatchObject({ line: 4, column: 10 });
  });

  it('writing a mixin parameter that holds it is an error at the parameter\'s read', async () => {
    const result = await render(mixin + '@foo: .a;\n.m(@x) { d: @x; }\n.b { .m(@foo); }');

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'eval/uncalled-mixin-reference', line: 4, column: 13 });
  });

  it.each([
    ['unused, emits nothing', '@foo: .a;\n.b { x: 1; }', '.b {\n  x: 1;\n}\n'],
    ['called, expands the mixin', '@foo: .a;\n.b { @foo(); }', '.b {\n  c: 1;\n}\n'],
    ['called through a namespace, expands the mixin', '@foo: #ns.a;\n.b { @foo(); }', '.b {\n  c: 1;\n}\n'],
    ['called with arguments, passes them', '@foo: .m;\n.m(@c: blue) { c: @c; }\n.b { @foo(red); }', '.b {\n  c: red;\n}\n'],
    ['looked into, reads the member', '@foo: .a;\n.b { b: @foo[c]; }', '.b {\n  b: 1;\n}\n'],
    ['passed to a mixin that does not write it', '@foo: .a;\n.m(@x) { d: 1; }\n.b { .m(@foo); }', '.b {\n  d: 1;\n}\n'],
    ['passed on to another mixin', '@foo: .a;\n.n(@y) { e: 2; }\n.m(@x) { .n(@x); }\n.b { .m(@foo); }', '.b {\n  e: 2;\n}\n'],
    ['passed to a mixin that calls it', '@foo: .a;\n.m(@x) { @x(); }\n.b { .m(@foo); }', '.b {\n  c: 1;\n}\n'],
    ['passed to a mixin through an alias', '@foo: .a;\n@bar: @foo;\n.m(@x) { @x(); }\n.b { .m(@bar); }', '.b {\n  c: 1;\n}\n'],
    ['a parameter default that is not written', '@foo: .a;\n.m(@x: @foo) { d: 1; }\n.b { .m(); }', '.b {\n  d: 1;\n}\n']
  ])('%s', async (_case, written, css) => {
    const result = await render(mixin + written);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.css).toBe(`.a {\n  c: 1;\n}\n#ns {\n  .a {\n    c: 1;\n  }\n}\n${css}`);
  });

  it('reports a call to an undefined mixin it names at the call', async () => {
    const result = await render('@foo: .nope;\n.b {\n  @foo();\n}');

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'resolve/name-not-found', line: 3, column: 3 });
  });
});
