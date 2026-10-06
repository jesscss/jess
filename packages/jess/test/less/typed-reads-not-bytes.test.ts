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
  it('transforms url(@var) by the string the variable holds', async () => {
    expect(await render('@q: "a.png"; @e: ~"\'b.png\'"; .x { q: url(@q); e: url(@e); d: url(~"\'b.png\'"); }', { rootpath: 'root/' }))
      .toBe('.x { q: url("root/a.png"); e: url(root/\'b.png\'); d: url(root/\'b.png\'); }');
  });

  it('names an @@ lookup by the string content of its name', async () => {
    expect(await render('@color: red; @a: color; @b: "color"; @c: ~"color"; .x { a: @@a; b: @@b; c: @@c; }'))
      .toBe('.x { a: red; b: red; c: red; }');
    await expect(render('@color: red; @d: ~\'"color"\'; .x { d: @@d; }')).rejects.toMatchObject({ code: 'resolve/name-not-found' });
  });

  it('spreads one value that is not a list as one argument', async () => {
    expect(await render('.m(@x; @y: none) { x: @x; y: @y; } @a: ~"1px 2px"; @l: 1px 2px; .c { .m(@a...); } .d { .m(@l...); }'))
      .toBe('.c { x: 1px 2px; y: none; } .d { x: 1px; y: 2px; }');
  });

  it('iterates an opaque value as one item', async () => {
    expect(await render('.x { each(true, { a: @value; }); each(~"a, b", { b: @value; }); each(a, b, { c: @value; }); }'))
      .toBe('.x { a: true; b: a, b; c: a; c: b; }');
  });

  it('writes an escaped string in a query prelude as written, however it gets there', async () => {
    expect(await render('@r: ~"16/9"; .m(@x) { @media (aspect-ratio: @x) { .b { c: d; } } } @media (aspect-ratio: @r) { .a { b: c; } } .k { .m(@r); }'))
      .toBe('@media (aspect-ratio: 16/9) { .a { b: c; } } .k { @media (aspect-ratio: 16/9) { .b { c: d; } } }');
  });
});
