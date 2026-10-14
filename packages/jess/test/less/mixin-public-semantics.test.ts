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
   * jess#356 (ledger X16, J15): a body-form `&:extend()` written directly in a mixin
   * definition is carried on the definition and extends the rule the mixin is called
   * into, as if written in that rule's own body (lessc copies the Extend into the
   * caller), in the default nested output as in collapsed output. A call outside every
   * rule extends nothing.
   */
  it('applies a body-form extend written directly in a mixin definition (jess#356)', async () => {
    for (const collapseNesting of [false, true]) {
      await expect(parseAndRender('.m() { &:extend(.sm); }\n.x { .m(); }\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.sm,\n.x {\n  b: 2;\n}\n');
      await expect(parseAndRender('.m() { c: d; &:extend(.sm); e: f; }\n.x { .m(); }\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.x {\n  c: d;\n  e: f;\n}\n.sm,\n.x {\n  b: 2;\n}\n');
      await expect(parseAndRender('.m() { &:extend(.sm); }\n.m();\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.sm {\n  b: 2;\n}\n');
      await expect(parseAndRender('.n() { &:extend(.sm); }\n.m() { .n(); }\n.x { .m(); }\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.sm,\n.x {\n  b: 2;\n}\n');
    }
    await expect(parseAndRender('.m() { &:extend(.sm); }\n.a { .b { .m(); } }\n.sm { b: 2; }'))
      .resolves.toBe('.sm,\n.a .b {\n  b: 2;\n}\n');
  });

  /*
   * Ledger X19: a body-form `&:extend()` in a detached ruleset extends the rule each
   * call lands in, as a mixin definition's does (X16); one in an at-rule block extends
   * the rule the block lands in, within the block's scope (EXTEND-SEMANTICS §8), as if
   * written in that rule's body inside the block. Outside every rule it extends
   * nothing. Expected output is lessc 4.9.1's.
   */
  it('applies a body-form extend in a detached ruleset or a nested at-rule block (X19)', async () => {
    for (const collapseNesting of [false, true]) {
      await expect(parseAndRender('@r: { &:extend(.sm); };\n.x { @r(); }\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.sm,\n.x {\n  b: 2;\n}\n');
      await expect(parseAndRender('@r: { &:extend(.sm); };\n@r();\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.sm {\n  b: 2;\n}\n');
      await expect(parseAndRender('.a { @media print { &:extend(.sm); } }\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe('.sm {\n  b: 2;\n}\n');
      await expect(parseAndRender('@media print { &:extend(.sm); .sm { c: 3; } }', collapseNesting))
        .resolves.toBe('@media print {\n  .sm {\n    c: 3;\n  }\n}\n');
    }
    const extendedInPrint = (rule: string): string => `@media print {\n  ${rule} .z,\n  ${rule} {\n    c: 3;\n  }\n}\n`;
    await expect(parseAndRender('.y { @media print { &:extend(.y .z); .z { c: 3; } } }'))
      .resolves.toBe(extendedInPrint('.y'));
    await expect(parseAndRender('.y { @supports (display: grid) { &:extend(.y .z); .z { c: 3; } } }'))
      .resolves.toBe(extendedInPrint('.y').replace('@media print', '@supports (display: grid)'));
    await expect(parseAndRender('.m() { @media print { &:extend(.y .z); .z { c: 3; } } }\n.y { .m(); }'))
      .resolves.toBe(extendedInPrint('.y'));
    await expect(parseAndRender('@r: { @media print { &:extend(.y .z); .z { c: 3; } } };\n.y { @r(); }'))
      .resolves.toBe(extendedInPrint('.y'));

    /*
     * Nested output (`collapseNesting: false`, the Less v5 default) writes the rule the
     * block lands in as `&` beside the target, inside the block: the same selectors.
     */
    const nestedInPrint = (wrapper: string): string =>
      `.y {\n  ${wrapper} {\n    .z,\n    & {\n      c: 3;\n    }\n  }\n}\n`;
    await expect(parseAndRender('.y { @media print { &:extend(.y .z); .z { c: 3; } } }', false))
      .resolves.toBe(nestedInPrint('@media print'));
    await expect(parseAndRender('.y { @supports (display: grid) { &:extend(.y .z); .z { c: 3; } } }', false))
      .resolves.toBe(nestedInPrint('@supports (display: grid)'));

    /*
     * PINNED DEFECT (nested output): a target a mixin or detached ruleset PLACES under a
     * rule block is not rewritten in nested output, whoever extends it — EXTEND-SEMANTICS
     * §6 "placed TARGET" — so these extend nothing there.
     */
    await expect(parseAndRender('.m() { @media print { &:extend(.y .z); .z { c: 3; } } }\n.y { .m(); }', false))
      .resolves.toBe('.y {\n  @media print {\n    .z {\n      c: 3;\n    }\n  }\n}\n');
    await expect(parseAndRender('@r: { @media print { &:extend(.y .z); .z { c: 3; } } };\n.y { @r(); }', false))
      .resolves.toBe('.y {\n  @media print {\n    .z {\n      c: 3;\n    }\n  }\n}\n');
  });

  /*
   * An `each()` callback is a detached ruleset each iteration places, so its
   * body-form extend extends the rule the iteration lands in (X19), once however many
   * items there are (lessc 4.9.1 repeats the selector per pass: `.z, .y, .y`).
   * Outside every rule it extends nothing.
   */
  it('applies a body-form extend in an each() callback (X19)', async () => {
    for (const collapseNesting of [false, true]) {
      await expect(parseAndRender('@l: a, b;\n.y { each(@l, { &:extend(.z); }); }\n.z { c: 3; }', collapseNesting))
        .resolves.toBe('.z,\n.y {\n  c: 3;\n}\n');
      await expect(parseAndRender('@l: a;\n.y { each(@l, .(@v) { &:extend(.z); w-@{v}: 1; }); }\n.z { c: 3; }', collapseNesting))
        .resolves.toBe('.y {\n  w-a: 1;\n}\n.z,\n.y {\n  c: 3;\n}\n');
      await expect(parseAndRender('@l: a;\neach(@l, { &:extend(.z); });\n.z { c: 3; }', collapseNesting))
        .resolves.toBe('.z {\n  c: 3;\n}\n');
    }
  });

  /*
   * A detached ruleset passed to a mixin — as an argument or a parameter's default —
   * is placed wherever the mixin calls it, so the extends in it apply there too (X19),
   * with nothing else in the sheet extending. lessc 4.9.1 gives the same output.
   */
  it('applies the extends of a detached ruleset held as a mixin argument or default', async () => {
    const extended = '.sm,\n.x {\n  b: 2;\n}\n';
    for (const collapseNesting of [false, true]) {
      await expect(parseAndRender('.m(@r) { .x { @r(); } }\n.m({ &:extend(.sm); });\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe(extended);
      await expect(parseAndRender('.m(@r) { @r(); }\n.x { .m({ &:extend(.sm); }); }\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe(extended);
      await expect(parseAndRender('.m(@r: { &:extend(.sm); }) { .x { @r(); } }\n.m();\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe(extended);
      await expect(parseAndRender('.m(@r) { @r(); }\n.m({ .x { &:extend(.sm); } });\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe(extended);
      await expect(parseAndRender('.m(@r) { @r(); }\n.m({ .x:extend(.sm) { c: 1; } });\n.sm { b: 2; }', collapseNesting))
        .resolves.toBe(`.x {\n  c: 1;\n}\n${extended}`);
    }
  });

  /*
   * A ruleset called as a mixin, with or without parentheses, carries its body-form
   * extend into the caller the same way; an inline `:extend()` on its selector stays
   * its own (lessc 4.9.1 gives the same output).
   */
  it('applies a called ruleset\'s body-form extend to the caller', async () => {
    for (const collapseNesting of [false, true]) {
      for (const call of ['.m;', '.m();']) {
        await expect(parseAndRender(`.m { &:extend(.sm); c: d; }\n.sm { b: 2; }\n.x { ${call} }`, collapseNesting))
          .resolves.toBe('.m {\n  c: d;\n}\n.sm,\n.m,\n.x {\n  b: 2;\n}\n.x {\n  c: d;\n}\n');
      }
      await expect(parseAndRender('.m:extend(.sm) { c: d; }\n.sm { b: 2; }\n.x { .m; }', collapseNesting))
        .resolves.toBe('.m {\n  c: d;\n}\n.sm,\n.m {\n  b: 2;\n}\n.x {\n  c: d;\n}\n');
    }
  });

  // A deeper rule a mixin body places extends as its composed selector.
  it('extends from a rule nested in a mixin body as the composed selector', async () => {
    for (const collapseNesting of [false, true]) {
      await expect(parseAndRender('.m() { .y { &:extend(.sm); } }\n.sm { b: 2; }\n.x { .m(); }', collapseNesting))
        .resolves.toBe('.sm,\n.x .y {\n  b: 2;\n}\n');
    }
  });
});
