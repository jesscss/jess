import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * A value is read from the type the parser and the evaluator gave it, never by
 * scanning its bytes for quotes or separators (DESIGN-DECISIONS V3, V22: an
 * escaped string is one opaque string). So a value reads the same written
 * directly, through a variable, or through a mixin argument.
 */
async function render(source: string, less: Record<string, unknown> = {}): Promise<string> {
  const css = await new Compiler({ language: { less } }).renderString(source, { language: 'less', extension: '.less' });
  return css.replace(/\s+/g, ' ').trim();
}

describe('typed reads, not byte scans', () => {
  /*
   * A quoted string's quote is syntax, so its content is the path. An escaped
   * string is opaque (V22): its content is never re-read for a quote, so
   * `url(~"'b.png'")` is transformed whole, directly or through a variable.
   */
  it('transforms url(@var) by the string the variable holds', async () => {
    expect(await render('@q: "a.png"; @e: ~"\'b.png\'"; .x { q: url(@q); e: url(@e); d: url(~"\'b.png\'"); }', { rootpath: 'root/' }))
      .toBe('.x { q: url("root/a.png"); e: url(root/\'b.png\'); d: url(root/\'b.png\'); }');
  });

  it('names an @@ lookup by the string content of its name', async () => {
    expect(await render('@color: red; @a: color; @b: "color"; @c: ~"color"; .x { a: @@a; b: @@b; c: @@c; }'))
      .toBe('.x { a: red; b: red; c: red; }');
    await expect(render('@color: red; @d: ~\'"color"\'; .x { d: @@d; }')).rejects.toMatchObject({ code: 'resolve/name-not-found' });
  });

  /*
   * `@{name}` splices a string's content: a quoted string's, read from the
   * string, and an escaped string's as written, quotes in it included (V22) —
   * in a template, a selector, and a `@{` token spliced together at runtime.
   */
  it('splices an interpolated string by its content, never stripping quotes from bytes', async () => {
    expect(await render('@q: "x"; @e: ~\'"y"\'; .s-@{q} { v: ~"@{q}"; w: ~"@{e}"; } .t-@{e} { a: 1; }'))
      .toBe('.s-x { v: x; w: "y"; } .t-"y" { a: 1; }');
    expect(await render('@a: ~"@{"; @b: ~"}"; @q: "x"; @e: ~\'"y"\'; .x { v: ~"@{a}q@{b}"; w: ~"@{a}e@{b}"; }'))
      .toBe('.x { v: x; w: "y"; }');
    expect(await render('@m: { @k: 1px; }; @n: "k"; @o: ~"k"; .x { a: @m[@@n]; b: @m[@@o]; }')).toBe('.x { a: 1px; b: 1px; }');
  });

  it('spreads one value that is not a list as one argument', async () => {
    expect(await render('.m(@x; @y: none) { x: @x; y: @y; } @a: ~"1px 2px"; @l: 1px 2px; .c { .m(@a...); } .d { .m(@l...); }'))
      .toBe('.c { x: 1px 2px; y: none; } .d { x: 1px; y: 2px; }');
  });

  it('iterates an opaque value as one item', async () => {
    expect(await render('.x { each(true, { a: @value; }); each(~"a, b", { b: @value; }); each(a, b, { c: @value; }); }'))
      .toBe('.x { a: true; b: a, b; c: a; c: b; }');
  });

  /* One item keeps the type the parser gave it: a keyword is a keyword, `true` is truthy. */
  it('iterates a single keyword as a keyword', async () => {
    expect(await render('@k: abc; .x { each(a, { v: iskeyword(@value); }); each(@k, { w: iskeyword(@value); }); each(true, { t: if(@value, 1, 2); }); }'))
      .toBe('.x { v: true; w: true; t: 1; }');
  });

  /* A url-bearing list passed through a mixin keeps its items, as `length()` reads them. */
  it('iterates a url-bearing list passed through a mixin argument by its items', async () => {
    expect(await render('.m(@l) { each(@l, { a: @value; }); n: length(@l); } @u: url(a.png), url(b.png); .x { .m(url(a.png) url(b.png)); } .y { .m(@u); }'))
      .toBe('.x { a: url(a.png); a: url(b.png); n: 2; } .y { a: url(a.png); a: url(b.png); n: 2; }');
  });

  it('writes an escaped string in a query prelude as written, however it gets there', async () => {
    expect(await render('@r: ~"16/9"; .m(@x) { @media (aspect-ratio: @x) { .b { c: d; } } } @media (aspect-ratio: @r) { .a { b: c; } } .k { .m(@r); }'))
      .toBe('@media (aspect-ratio: 16/9) { .a { b: c; } } .k { @media (aspect-ratio: 16/9) { .b { c: d; } } }');
    expect(await render('@r: ~"16/9" ~"x"; .m(@x) { @media (aspect-ratio: @x) { .b { c: d; } } } @media (aspect-ratio: @r) { .a { b: c; } } .k { .m(@r); }'))
      .toBe('@media (aspect-ratio: 16/9 x) { .a { b: c; } } .k { @media (aspect-ratio: 16/9 x) { .b { c: d; } } }');
  });

  /*
   * A `style()` query's `--x: value` is a custom-property value, written as the
   * same value in a declaration is (DESIGN-DECISIONS P2, SEMANTIC-INVARIANTS 2):
   * a variable is substituted and an escaped string is kept as written.
   */
  it('writes a style() query value as the same custom-property value in a declaration', async () => {
    expect(await render('@a: 3; .d { --x: @a; --y: ~"a/b"; --z: ~\'a b\'; }'))
      .toBe('.d { --x: 3; --y: ~"a/b"; --z: ~\'a b\'; }');
    expect(await render('@a: 3; @container style(--x: @a) { .a { b: c; } } @container style(--y: ~"a/b") or style(--z: ~\'a b\') { .a { b: c; } }'))
      .toBe('@container style(--x: 3) { .a { b: c; } } @container style(--y: ~"a/b") or style(--z: ~\'a b\') { .a { b: c; } }');
  });
});
