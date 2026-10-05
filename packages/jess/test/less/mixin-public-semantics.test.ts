import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

async function parseAndRender(source: string, collapseNesting = true): Promise<string> {
  const compiler = new Compiler({ output: { collapseNesting } });
  const context = compiler.createContext('entry.less');
  const parsed = await context.parseString(source, {
    filePath: 'entry.less',
    extension: '.less'
  });

  expect(parsed.node.type).toBe('Stylesheet');
  expect(context.document).toBe(parsed.node);
  return compiler.renderString(source, {
    filePath: 'entry.less',
    extension: '.less'
  });
}

describe('Less mixin semantic contracts through the public AST route', () => {
  it('expands recursive guarded mixins in source order', async () => {
    await expect(parseAndRender(`
      .countdown(@n) when (@n > 0) {
        .item-@{n} { order: @n; }
        .countdown(@n - 1);
      }
      .countdown(3);
    `)).resolves.toBe(
      '.item-3 {\n  order: 3;\n}\n.item-2 {\n  order: 2;\n}\n.item-1 {\n  order: 1;\n}\n'
    );
  });

  it('retains caller arguments through a detached-ruleset invocation', async () => {
    await expect(parseAndRender(`
      #hover(@content) { &:hover { @content(); } }
      #button(@color) {
        color: @color;
        #hover({ background-color: @color; });
      }
      .button { #button(red); }
    `)).resolves.toBe(
      '.button {\n  color: red;\n}\n.button:hover {\n  background-color: red;\n}\n'
    );
  });

  it('propagates a call-site !important marker to declarations emitted by a mixin', async () => {
    await expect(parseAndRender(`
      .paint() { color: red; background: blue; }
      .entry { .paint() !important; }
    `)).resolves.toBe(
      '.entry {\n  color: red !important;\n  background: blue !important;\n}\n'
    );
  });

  it('resolves a nested mixin body against its lexical scope', async () => {
    await expect(parseAndRender(`
      @tone: outer;
      .scope {
        @tone: inner;
        .paint() { color: @tone; }
        .entry { .paint(); }
      }
    `)).resolves.toBe('.scope .entry {\n  color: inner;\n}\n');
  });

  /*
   * A guard comparison operand is a math run, as in a value: `*`, `+` and `-`
   * compute, and a bare slash follows the math policy (parens-division leaves
   * `4 / 2` uncomputed, so it does not equal `2`).
   */
  it('evaluates arithmetic in guard comparison operands', async () => {
    await expect(parseAndRender('.m() when (2 * 2 > 1) { a: b } .x { .m(); }'))
      .resolves.toBe('.x {\n  a: b;\n}\n');
    await expect(parseAndRender(`
      @a: 3;
      .m() when (@a + 1 = 4) { a: b }
      .m() when (4 / 2 = 2) { c: d }
      .m(@n) when (@n - 1 > 0) and (@n * 2 < 10) { e: @n }
      .x { .m(); .m(2); .m(9); }
    `)).resolves.toBe('.x {\n  a: b;\n  e: 2;\n}\n');
    await expect(parseAndRender('.y when (1 + 1 = 2) { a: b }'))
      .resolves.toBe('.y {\n  a: b;\n}\n');
  });

  /*
   * jess#356: a body-form `&:extend()` written directly in a mixin definition
   * extends the rule the mixin is called into, in the default nested output as
   * in collapsed output. It is not parsed yet: the mixin body has no extend
   * statement, and the core extend recorder cannot yet apply a mixin-level
   * extend at the call site.
   */
  it.fails('applies a body-form extend written directly in a mixin definition (jess#356)', async () => {
    for (const collapseNesting of [false, true]) {
      await expect(parseAndRender('.m() { &:extend(.sm); }\n.x { .m(); }\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.sm,\n.x {\n  b: 2;\n}\n');
      await expect(parseAndRender('.m() { c: d; &:extend(.sm); e: f; }\n.x { .m(); }\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.x {\n  c: d;\n  e: f;\n}\n.sm,\n.x {\n  b: 2;\n}\n');
      await expect(parseAndRender('.m() { &:extend(.sm); }\n.m();\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.sm {\n  b: 2;\n}\n');
    }
  });
});
