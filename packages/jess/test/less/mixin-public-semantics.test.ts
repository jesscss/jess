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
   * A `(` in a guard is read once, as a group; what follows its `)` decides
   * whether it was a grouped guard or a math group in an operand. As a math
   * group its slash divides, exactly as `(4 / 2)` does in a value.
   */
  it('reads a parenthesized math group as a guard operand', async () => {
    await expect(parseAndRender(`
      @a: 5;
      @b: 6;
      .m() when ((1 + 1) = 2) { a: 1 }
      .m() when ((@a + @b) > 10) { b: 2 }
      .m() when ((@a + @b) > 20) { c: 3 }
      .m() when ((1 + 1) * 2 = 4) and (true) { d: 4 }
      .m() when (((1 + 1)) = 2) { e: 5 }
      .m() when ((4 / 2) = 2) { f: 6 }
      .m() when not ((1 + 1) = 3) { g: 7 }
      .m() when (2 = (1 + 1)) { h: 8 }
      .x { .m(); }
    `)).resolves.toBe('.x {\n  a: 1;\n  b: 2;\n  d: 4;\n  e: 5;\n  f: 6;\n  g: 7;\n  h: 8;\n}\n');
  });

  it('reads a parenthesized math group as an if() condition operand, in value and statement position', async () => {
    await expect(parseAndRender(`
      .x {
        a: if(((1 + 1) = 2), y, n);
        b: if((2 = (1 + 1)), y, n);
        c: if(((1 + 1) * 2 = 4), y, n);
        d: if(not ((1 + 1) = 3), y, n);
        if((1 = 1), { e: y; });
        if(((1 + 1) > 3), { f: y; }, { f: n; });
      }
    `)).resolves.toBe('.x {\n  a: y;\n  b: y;\n  c: y;\n  d: y;\n  e: y;\n  f: n;\n}\n');
  });

  /*
   * A group holding a condition is that condition's truth as an operand, in a
   * guard as in an `if()` (ledger P42: the parser keeps the shape, which was a
   * located-nowhere parse error). What the operand then does is evaluation's
   * call: compared, it compares; in math it is not a number, so the run is not
   * `true` and the condition does not hold.
   */
  it('reads a condition group as an operand alike in a guard and in if()', async () => {
    await expect(parseAndRender(`
      .m() when ((1 = 1) = true) { a: 1 }
      .m() when ((1 = 2) = true) { b: 2 }
      .m() when ((1 = 1) + 1) { c: 3 }
      .x { .m(); d: if(((1 = 1) = true), y, n); e: if(((1 = 1) + 1), y, n); }
    `)).resolves.toBe('.x {\n  a: 1;\n  d: y;\n  e: n;\n}\n');
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
