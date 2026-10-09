import { describe, expect, it } from 'vitest';
import { parse as parseCss } from '@jesscss/css-parser';
import { serialize } from '@jesscss/core';
import { Compiler } from '../../src/index.js';

/*
 * Where Less math does and does not reach, now that every slash is the division
 * rule's and computed math lowers into an `Expression` (DESIGN-DECISIONS
 * P34/P35).
 */
async function render(source: string, compile: { mathMode?: 'always' | 'parens-division' | 'parens'; unitMode?: 'strict' | 'loose' | 'preserve' } = {}): Promise<string> {
  const css = await new Compiler({ compile }).renderString(source, { language: 'less', extension: '.less' });
  return css.replace(/\s+/g, ' ').trim();
}

async function renderJess(source: string): Promise<string> {
  const css = await new Compiler().renderString(source, { language: 'jess', extension: '.jess' });
  return css.replace(/\s+/g, ' ').trim();
}

async function renderIn(extension: '.less' | '.scss' | '.jess', source: string, compress = false): Promise<string> {
  const css = await new Compiler({ output: { compress } }).renderString(source, { extension });
  return css.replace(/\s+/g, ' ').trim();
}

async function renderCss(source: string, compress = false): Promise<string> {
  return (await serialize(parseCss(source), { collapseNesting: false, compress })).css.replace(/\s+/g, ' ').trim();
}

describe('Less math boundaries', () => {
  /*
   * Math inside a math function is kept as written, in every dialect — owner
   * 2026-09-24 (DESIGN-DECISIONS P35): its result is clamped to what the
   * property allows (css-values-4 §10.12), so folding changes the value.
   */
  it('keeps calc() math as written, substituting variables', async () => {
    expect(await render('@a: 10px; .x { w: calc(@a * 2); p: calc(1px - 5px); }'))
      .toBe('.x { w: calc(10px * 2); p: calc(1px - 5px); }');
    expect(await render('@v: 50vh/2; .x { w: calc(50% + (@v - 20px)); }', { unitMode: 'strict' }))
      .toBe('.x { w: calc(50% + (50vh / 2 - 20px)); }');
  });

  /*
   * Math written inside a math function computes nothing, so a group around it,
   * or around one value, keeps its parens, redundant or not — owner 2026-10-06,
   * "no reason to drop parens. the user wanted to write it that way for a reason."
   */
  it('keeps the parens around math written inside calc() and around one value, in .less and .jess', async () => {
    expect(await render('@v: 10px; .x { w: calc(100% - ((@v * 3) + (@v * 2))); h: calc(100% + (25vh - 20px)); }'))
      .toBe('.x { w: calc(100% - ((10px * 3) + (10px * 2))); h: calc(100% + (25vh - 20px)); }');
    expect(await render('@v: 10px; .x { a: calc((10px)); b: calc( (1px + 2px) ); c: calc(100% - (((@v + @v)))); }'))
      .toBe('.x { a: calc((10px)); b: calc((1px + 2px)); c: calc(100% - (((10px + 10px)))); }');
    expect(await renderJess('$v: 10px; .x { w: calc(100% - (($v * 3) + ($v * 2))); }'))
      .toBe('.x { w: calc(100% - ((10px * 3) + (10px * 2))); }');
    expect(await renderJess('.x { w: calc(10px / (2 * 5)); v: calc(((10vh)) + calc((5vh))); }'))
      .toBe('.x { w: calc(10px / (2 * 5)); v: calc(((10vh)) + calc((5vh))); }');
  });

  /*
   * Parens are dropped when the calculation in them is resolved (owner
   * 2026-10-07), inside a math function as anywhere else: a call a callable
   * computes, or a variable bound to math that computed, loses every level of
   * parens around it. Only the parens go: `calc((x))` stays a `calc()`, since a
   * math function's result is clamped to what the property allows (P35), so
   * `padding: calc((min(-5px, 1px)))` is `calc(-5px)`, never `-5px`. Math
   * written in the math function computes nothing, and neither does a call
   * written out as-is or math kept as written, so their groups keep their
   * parens.
   */
  it('drops the parens around a calculation resolved inside calc()', async () => {
    expect(await render('@a: 10px; @b: 10px; @c: 10px + 20px; .x { one: calc(100% - ((min(@a + @b)))); two: calc(100% - (((@a + @b)))); '
      + 'q: calc((percentage(0.5))); s: calc(1px + (min(1px, 2px))); u: calc(100% - ((@c))); p: calc((min(-5px, 1px))); '
      + 'r: calc(((@c))); v: calc((var(--a)) + 1px); w: calc((var(--a))); m: calc((min(1px, 2em))); }'))
      .toBe('.x { one: calc(100% - 20px); two: calc(100% - (((10px + 10px)))); q: calc(50%); s: calc(1px + 1px); '
        + 'u: calc(100% - 30px); p: calc(-5px); r: calc(30px); v: calc((var(--a)) + 1px); w: calc((var(--a))); m: calc((min(1px, 2em))); }');
    expect(await render('@x: calc((min(-5px, 1px))); .x { a: @x * 2; b: unit(@x); }'))
      .toBe('.x { a: -10px; b: -5; }');
    expect(await render('@k: 1px + 1em; .x { a: calc((@k)); b: calc(100% - ((@k))); }'))
      .toBe('.x { a: calc((1px + 1em)); b: calc(100% - ((1px + 1em))); }');
    expect(await renderIn('.scss', '$a: 10px; .x { one: calc(100% - ((min($a + $a)))); }'))
      .toBe('.x { one: calc(100% - 20px); }');
    expect(await renderJess('@-from "#less" import (percentage); .x { a: calc(100% - (($percentage(0.5)))); b: calc(100% - ((min(10px, 1px)))); }'))
      .toBe('.x { a: calc(100% - 50%); b: calc(100% - ((min(10px, 1px)))); }');
    expect(await renderJess('@-from "#less" import (percentage); .x { a: calc(($percentage(0.5))); b: calc((($(1px + 2px)))); c: calc((var(--a))); }'))
      .toBe('.x { a: calc(50%); b: calc(3px); c: calc((var(--a))); }');

    /* CSS computes nothing: its bytes are kept as written, and `.jess` writes valid CSS the same. */
    const css = '.x { a: calc(100% - ((min(10px, 20px)))); b: calc((var(--a))); c: calc(100% - ((1px + 2px))); }';
    expect(await renderCss(css)).toBe(css);
    expect(await renderJess(css)).toBe(css);
  });

  /*
   * Text is not a resolved calculation: a group around an escaped string —
   * `e("…")`, `~"…"`, the text an `if()` picks — keeps the parens written
   * around it, however the group is reached and however long the text is, so
   * the math around it never re-reads its bytes: `2 * (1px + 2px)` is not
   * `2 * 1px + 2px` (ledger J16; owner 2026-10-09: text prints as written). The
   * test is the value's type, never its bytes. A variable holding such a group
   * holds the text and the group. In `.scss` an unquoted string is text inside
   * a `calc()`, and a call's in a group that math reads.
   */
  it('keeps the parens around text, however it is reached', async () => {
    expect(await render('@v: e("1px + 2px"); .x { a: calc(2 * (e("1px + 2px"))); b: calc(2 * (@v)); '
      + 'c: calc(2 * (if(true, ~"1px + 2px", 1px))); d: calc(2 / (e("1px/2"))); f: calc(2 * (e("foo"))); '
      + 'g: calc((e("1px + 2px"))); h: calc(2 * (~"1px + 2px")); k: calc(1px + (e("var(--a, 1px)"))); }'))
      .toBe('.x { a: calc(2 * (1px + 2px)); b: calc(2 * (1px + 2px)); c: calc(2 * (1px + 2px)); d: calc(2 / (1px/2)); '
        + 'f: calc(2 * (foo)); g: calc((1px + 2px)); h: calc(2 * (1px + 2px)); k: calc(1px + (var(--a, 1px))); }');
    expect(await render('@v: e("1px + 2px"); .x { a: (e("1px + 2px")) * 2; a2: (~"1px + 2px") * 2; b: 2 - (@v); d: (e("1px + 2px")); e: (e("foo")); f: ((~"x")); }'))
      .toBe('.x { a: calc((1px + 2px) * 2); a2: calc((1px + 2px) * 2); b: calc(2 - (1px + 2px)); d: (1px + 2px); e: (foo); f: ((x)); }');
    expect(await render('@a: (e("1px + 2px")); @s: ~"a b"; .m(@x) { m: (@x); n: calc(2 * (@x)); } '
      + '.x { a: calc(2 * @a); b: @a; c: (@s); s: ~"@{a}"; t: calc(@a); .m(e("1px + 2px")); .m(~"a b"); }'))
      .toBe('.x { a: calc(2 * (1px + 2px)); b: (1px + 2px); c: (a b); s: 1px + 2px; t: calc((1px + 2px)); m: (1px + 2px); n: calc(2 * (1px + 2px)); m: (a b); n: calc(2 * (a b)); }');
    const scss = '$v: unquote("1px + 2px"); $k: foo; $g: (unquote("1px + 2px")); .x { a: calc(2 * (unquote("1px + 2px"))); b: calc(2 * ($v)); '
      + 'c: calc(2 * (unquote("foo"))); d: calc(2 * ($k)); e: (unquote("1px + 2px")); f: ($k); g: (unquote("1px + 2px")) * 2; h: $g * 2; i: $g; }';
    expect(await renderIn('.scss', scss))
      .toBe('.x { a: calc(2 * (1px + 2px)); b: calc(2 * (1px + 2px)); c: calc(2 * (foo)); d: calc(2 * (foo)); e: 1px + 2px; f: foo; '
        + 'g: calc((1px + 2px) * 2); h: calc((1px + 2px) * 2); i: 1px + 2px; }');
    expect(await renderJess('@-from "#less" import (e); .x { a: calc(2 * ($e("1px + 2px"))); b: calc(2 * (($e("1px + 2px")))); c: ($e("foo")); }'))
      .toBe('.x { a: calc(2 * (1px + 2px)); b: calc(2 * ((1px + 2px))); c: (foo); }');
  });

  /*
   * A mixin argument holding text in a group binds the text and the group, as a
   * variable does, so math in the mixin keeps the group (ledger J16): written
   * as `calc(2 * 1px + 2px)` it would be other arithmetic.
   */
  it('carries the group around text a mixin argument holds', async () => {
    for (const source of [
      '@t: (e("1px + 2px")); .m(@x) { n: calc(2 * @x); } .x { .m(@t); }',
      '.m(@x) { n: calc(2 * @x); } .x { .m((e("1px + 2px"))); }',
      '@t: (~"1px + 2px"); .m(@x) { n: calc(2 * @x); } .x { .m(@t); }',
      '@t: (e("1px + 2px")); .m(@x) when (true) { n: calc(2 * @x); } .x { .m(@t); }'
    ]) {
      expect(await render(source), source).toBe('.x { n: calc(2 * (1px + 2px)); }');
      expect(await renderIn('.less', source, true), source).toBe('.x{n:calc(2 * (1px + 2px))}');
    }
  });

  /*
   * In `.scss` only a call's unquoted string in a group is text outside a
   * calculation; any other keyword in a group is an identifier, written as it
   * is (ledger J16).
   */
  it('reads a .scss keyword in a group outside a calculation as an identifier', async () => {
    expect(await renderIn('.scss', '$g: (foo); $k: foo; .x { a: (foo) * 2; b: $g * 2; c: $k * 2; d: (unquote("1px + 2px")) * 2; }'))
      .toBe('.x { a: (foo) * 2; b: foo * 2; c: foo * 2; d: calc((1px + 2px) * 2); }');
  });

  /*
   * The group is dropped only where the text is spliced or read (owner
   * 2026-10-09, ledger J16): an interpolation into a selector, a property name
   * or a string, and an argument a callable reads. A call written out as-is, a
   * list and a math function's argument write the text as written, its group
   * included.
   */
  it('gives the text of a group around text where it is spliced or read', async () => {
    expect(await render('@a: (~"x"); @t: (e("1px + 2px")); .x-@{a} { @{a}-p: 1; s: "@{a}"; e: escape((e("a b"))); '
      + 'f: foo((e("x"))); l: (e("x")), (~"y") 1px; i: (if(true, ~"a b", 1px)); m: min((e("1px + 2px")), 3px); n: max(@t, 3px); }'))
      .toBe('.x-x { x-p: 1; s: "x"; e: a%20b; f: foo((x)); l: (x), (y) 1px; i: (a b); m: min((1px + 2px), 3px); n: max((1px + 2px), 3px); }');
    expect(await render('.m(@x) { .y-@{x} { p: "@{x}"; q: @x; } } .x { .m((e("a"))); }'))
      .toBe('.x { .y-a { p: "a"; q: (a); } }');
  });

  /*
   * The authored spelling is a property of the value, not of the path that
   * reached calc(): the same `calc((…))` prints the same bytes in every
   * position, while a typed consumer still reads its magnitude
   * (SEMANTIC-INVARIANTS 1 and 2).
   */
  it('spells a calc() paren group the same in every position', async () => {
    for (const v of ['calc((10px))', 'calc((1px + 2vw))', 'calc(100% - (10px))', 'calc(((5vh)))', 'calc((0.5px))']) {
      const out = await render(`@x: ${v}; @list: ${v}, 2px;
        .m(@a) { m: @a; } .d(@a: ${v}) { d: @a; } .r(@a...) { r: @a; }
        .x { decl: ${v}; var: @x; .m(${v}); .d(); .r(${v}); ext: extract(@list, 1); each(@list, { e: @value; }); }`);
      expect(out, v).toBe(`.x { decl: ${v}; var: ${v}; m: ${v}; d: ${v}; r: ${v}; ext: ${v}; e: ${v}; e: 2px; }`);
    }
    expect(await renderJess('$x: calc((10px)); .x { w: calc(min(calc((5vh)), 2px) * 2); v: $x; }'))
      .toBe('.x { w: calc(min(calc((5vh)), 2px) * 2); v: calc((10px)); }');
    expect(await render('@x: calc((10px)); .x when (@x = 10px) { a: unit(@x, em); b: @x * 2; c: percentage(calc((0.5))); }'))
      .toBe('.x { a: 10em; b: 20px; c: 50%; }');
  });

  /* A group around kept math or around raw bytes holds nothing that computes. */
  it('keeps a paren group written in a math function argument, as css does', async () => {
    for (const src of [
      '.x { w: calc(var(--a, (1px + 2px)) + (3px)); }',
      '.x { w: calc(var(--a, (1px + 2px))); }',
      '.x { w: var(--a, (1px + 2px)); }',
      '.x { w: min((10px + 5px), 20px); }',
      '.x { w: clamp(1px, (2vw + 1px), 3px); }',
      '.x { w: calc((1px + 2vw) * 2); v: calc(((1px + 2vw))); }'
    ]) {
      expect(await renderJess(src), src).toBe(await renderCss(src));
    }
    expect(await render('.x { w: calc(var(--a, (1px + 2px)) + (3px)); }'))
      .toBe('.x { w: calc(var(--a, (1px + 2px)) + (3px)); }');
  });

  /* A calc() group is valid CSS with one parse in all four grammars (SEMANTIC-INVARIANTS 4). */
  it('emits a calc() group around one value identically in every dialect', async () => {
    const src = '.x { a: calc((10px)); b: calc(((5vh))); }';
    const css = await renderCss(src);
    expect(css).toBe('.x { a: calc((10px)); b: calc(((5vh))); }');
    for (const extension of ['.less', '.scss', '.jess'] as const) {
      expect(await renderIn(extension, src), extension).toBe(css);
    }
  });

  /* The interior of a kept calc() is written as authored under compress, group or not. */
  it('does not compress inside a kept calc(), with or without a group', async () => {
    for (const extension of ['.less', '.jess'] as const) {
      expect(await renderIn(extension, '.x { a: calc((0.5px)); b: calc(1px + (0.5px)); c: calc((0.5px + 1px)); d: calc(0.5px + 1vw); }', true), extension)
        .toBe('.x{a:calc((0.5px));b:calc(1px + (0.5px));c:calc((0.5px + 1px));d:calc(0.5px + 1vw)}');
    }
  });

  /* A sign is not an operator the math mode governs (tests-config/math/strict/parens.css). */
  it('negates a variable or group in every math mode', async () => {
    for (const mathMode of ['always', 'parens-division', 'parens'] as const) {
      expect(await render('@var: 1; @w: 2px; .x { a: -@var; b: -(@var); c: -@w; d: -(@w * 2); }', { mathMode }), mathMode)
        .toBe('.x { a: -1; b: -1; c: -2px; d: -4px; }');
    }
  });

  /*
   * A group is consumed only by what computes in it; a group around one value
   * nothing computes keeps its parens, in every dialect (SEMANTIC-INVARIANTS 4;
   * orchestrator judgment under owner delegation 2026-10-06).
   */
  it('emits a paren group around one value identically in every dialect', async () => {
    const src = '.x { c: (10vh); d: var(--a, (10px)); e: calc(var(--a, ((5vh)))); f: (red) (1px); g: (10px) / 2; '
      + 'h: (var(--x)); i: (calc(1px + 1vw)); j: (foo(1)); k: var(--a, (rgb(1, 2, 3))); l: (rgb(1, 2, 3)); }';
    const css = await renderCss(src);
    expect(css).toBe('.x { c: (10vh); d: var(--a, (10px)); e: calc(var(--a, ((5vh)))); f: (red) (1px); g: (10px) / 2; '
      + 'h: (var(--x)); i: (calc(1px + 1vw)); j: (foo(1)); k: var(--a, (rgb(1, 2, 3))); l: (rgb(1, 2, 3)); }');
    for (const extension of ['.less', '.scss', '.jess'] as const) {
      expect(await renderIn(extension, src), extension).toBe(css);
    }
    expect(await renderJess('.x { w: min((10px), 1px); }')).toBe('.x { w: min((10px), 1px); }');
    expect(await render('@c: foo(1); .x { b: ((10px)); c: (@c); d: (10px) * 2; e: percentage((0.5)); }'))
      .toBe('.x { b: ((10px)); c: (foo(1)); d: 20px; e: 50%; }');
  });

  /*
   * Once something computes, the parens do not survive (DESIGN-DECISIONS F4): a
   * call a callable computes, a `.jess` `$( … )`, and a variable or mixin
   * parameter bound to math, exactly as a group around the math itself.
   */
  it('consumes a paren group around anything that computes', async () => {
    expect(await render('.a { b: 1px solid (darken(red, 10%)); w: (percentage(0.5)); u: (unit(5, px)); f: (if(true, a, b)); }'))
      .toBe('.a { b: 1px solid #cc0000; w: 50%; u: 5px; f: a; }');
    expect(await renderIn('.scss', '.a { w: (percentage(0.5)); b: solid (darken(red, 10%)); }'))
      .toBe('.a { w: 50%; b: solid #cc0000; }');
    expect(await renderJess('.a { a: ($(1px + 2px)); b: ($(foo + 1)); }')).toBe('.a { a: 3px; b: (foo + 1); }');
    expect(await render('@a: 1px + 2px; .x { b: (@a); }')).toBe('.x { b: 3px; }');
    expect(await render('@a: 1px + 2px; .x { b: (@a); c: @a; }', { mathMode: 'parens' }))
      .toBe('.x { b: 3px; c: 1px + 2px; }');
    expect(await render('.m(@x) { b: (@x); } .x { .m(1px + 2px); } .y { .m(percentage(0.5)); }'))
      .toBe('.x { b: 3px; } .y { b: 50%; }');
  });

  /*
   * A reference that resolves is a calculation resolved, so a group around one
   * drops its parens when what it names is one value: a variable, a parameter,
   * a property or a member (SETTLED — orchestrator judgment under owner
   * delegation 2026-10-07, applying the owner's rule "parens are dropped IF the
   * calculation in the parens is resolved"). One naming a call written out
   * as-is keeps them, as a group around the call does, and so does one naming a
   * list, which what surrounds it would otherwise re-read
   * (`calc(100% / (@v))` with `@v: 50vh/2`).
   */
  it('drops the parens around a reference that resolves to one value', async () => {
    expect(await render('@a: 10vh; @k: foo; @l: 1px 2px; @v: 50vh/2; @g: (10px); @c: foo(1); .m(@x) { p: (@x); } '
      + '.x { width: (@a); k: (@k); l: (@l); v: calc(100% / (@v)); g: (@g); c: (@c); w: (@a) + 1em; q: calc(2 * (@a)); .m(5px); }'))
      .toBe('.x { width: 10vh; k: foo; l: (1px 2px); v: calc(100% / (50vh / 2)); g: 10px; c: (foo(1)); w: calc(10vh + 1em); q: calc(2 * 10vh); p: 5px; }');
    expect(await renderIn('.scss', '$d: 10px; .x { k: ($d); }')).toBe('.x { k: 10px; }');
    expect(await renderJess('$d: 10px; .x { k: ($d); }')).toBe('.x { k: 10px; }');
  });

  /*
   * Every way of reading a value names the same value (SEMANTIC-INVARIANTS 2): a
   * group around a property, a member, an `@@name` or a `.jess` function call
   * is consumed exactly when the group around the value it reads would be.
   */
  it('consumes a group around a computed value however it is read', async () => {
    const less = '@n: v; @v: 1px + 2px; @m: { v: 1px + 2px; k: 10px; }; #ns { @v: 1px + 2px; } .mx() { @r: 1px + 2px; } '
      + '.x { w: 1px + 2px; a: ($w); b: (@m[v]); c: (#ns[@v]); d: (@@n); e: (.mx()[@r]); f: (@m[k]); }';
    expect(await render(less)).toBe('.x { w: 3px; a: 3px; b: 3px; c: 3px; d: 3px; e: 3px; f: 10px; }');
    const jess = '@-from "#less" import (percentage); $p: $percentage(0.5); $f: @($x) { result: $x; }; '
      + '.x { a: ($percentage(0.5)); b: ($p); c: ($f(10px)); }';
    expect(await renderJess(jess)).toBe('.x { a: 50%; b: 50%; c: 10px; }');
  });

  /*
   * A comparison computes a boolean, so a group around one at a `$( … )`
   * boundary is consumed; a `$( … )` around one value computes nothing, so a
   * group around it keeps its parens as a group around the value does.
   */
  it('consumes a group around a comparison, not around a $( … ) of one value', async () => {
    expect(await renderJess('.x { a: $((1 > 0)); b: $((2 = 2)); c: $((1px < 2px)); d: $((1 + 1 > 0)); e: ($(10px)); f: ($(1px + 2px)); }'))
      .toBe('.x { a: true; b: true; c: true; d: true; e: (10px); f: 3px; }');
  });

  /*
   * A function's result is a value like any other: a computing consumer reads
   * the value inside a group it returns, and only a declaration writing the
   * result out keeps the parens.
   */
  it('computes with a function result written as a group around one value', async () => {
    const src = '@function f($x) { @return ($x); } @function g() { @return (1px); } '
      + '.x { a: f(1px) * 2; b: percentage(f(0.5)); c: f(1px); d: max(f(1px), 2px); e: if(f(1px) == 1px, y, n); h: g() + g(); }';
    expect(await renderIn('.scss', src)).toBe('.x { a: 2px; b: 50%; c: 1px; d: 2px; e: y; h: 2px; }');
  });

  /*
   * Math kept is written as `calc()` and computes nothing, so a group written
   * as one of its operands keeps its parens inside it (ledger J16), while math
   * that computes reads the value inside: a unitless number adopts the unit
   * (ledger V27).
   */
  it('keeps the parens of an operand of math kept as written', async () => {
    expect(await render('.x { a: (10px) + 1em; c: 1em + (10px); d: ((10px)) + 1em; e: foo + (1px); f: (1px) + foo; g: (10px) + 1; }'))
      .toBe('.x { a: calc((10px) + 1em); c: calc(1em + (10px)); d: calc(((10px)) + 1em); e: foo + (1px); f: (1px) + foo; g: 11px; }');
    expect(await render('.x { a: (10px) + 1em; }', { unitMode: 'loose' })).toBe('.x { a: 11px; }');
  });

  /*
   * A paren group around one value keeps its parens where it is written directly
   * in a declaration value or inside a math function; one reached through a
   * variable, a parameter or an interpolation evaluates to its value, Less
   * grouping (orchestrator judgment under owner delegation 2026-10-06; ledger
   * J16). A parameter stands for its argument as a variable does.
   */
  it('evaluates a group reached through a variable, a parameter or an interpolation to its value', async () => {
    expect(await render('@g: (10px); .m(@x) { a: @x; b: @x * 2; } .d(@x: (10px)) { a: @x; } .x { a: @g; .m((10px)); .d(); }'))
      .toBe('.x { a: 10px; a: 10px; b: 20px; a: 10px; }');
    expect(await render('@a: (10px); .x-@{a} { s: ~"@{a}"; m: @a @a; c: (10px); k: calc((10px)); p: (@a); } @c: calc((10px)); .y { c: @c; }'))
      .toBe('.x-10px { s: 10px; m: 10px 10px; c: (10px); k: calc((10px)); p: 10px; } .y { c: calc((10px)); }');
    expect(await render('@a: (10px) (red); @b: @a; .x { a: @b; w: 1px; v: $w; } .y { w: (1px); v: $w; }'))
      .toBe('.x { a: 10px red; w: 1px; v: 1px; } .y { w: (1px); v: 1px; }');
    expect(await renderIn('.scss', '$a: (10px); @mixin m($x) { a: $x; } .x-#{$a} { @include m((10px)); s: "#{$a}"; m: $a $a; c: (10px); }'))
      .toBe('.x-10px { a: 10px; s: "10px"; m: 10px 10px; c: (10px); }');
    expect(await renderJess('$a: (10px);\n.x { m: $a $a; c: (10px); }')).toBe('.x { m: 10px 10px; c: (10px); }');
    expect(await renderIn('.less', '.m(@x) { b: @x; } .x { .m((0.5px)); c: (0.5px); }', true)).toBe('.x{b:.5px;c:(0.5px)}');

    // Wherever the reference is read: in a math function, a query, through a member, and around a call.
    expect(await render('@a: (10px); .x { w: calc(@a * 2); v: calc(1px + @a); } @media (min-width: @a) { .y { b: 1; } } @container (min-width: @a) { .z { b: 1; } }'))
      .toBe('.x { w: calc(10px * 2); v: calc(1px + 10px); } @media (min-width: 10px) { .y { b: 1; } } @container (min-width: 10px) { .z { b: 1; } }');
    expect(await render('#ns { @a: (10px); } @m: { k: (10px); }; .mx() { @r: (10px); k: (10px); } .x { a: #ns[@a]; b: @m[k] @m[k]; c: .mx()[@r]; d: .mx()[k]; }'))
      .toBe('.x { a: 10px; b: 10px 10px; c: 10px; d: 10px; }');
    expect(await render('@a: (var(--y)); @b: (foo(1)); .x-@{b} { a: @a; s: ~"@{a}"; }')).toBe('.x-foo(1) { a: var(--y); s: var(--y); }');
    expect(await renderIn('.scss', '$a: (10px); .x { w: calc(#{$a} * 2); } @media (min-width: $a) { .y { b: 1; } }'))
      .toBe('.x { w: calc(10px * 2); } @media (min-width: 10px) { .y { b: 1; } }');

    // A group written inside a math function keeps its parens, even in a value a reference reached.
    expect(await render('@c: clamp(1px, (10px), 3em); @d: calc(1px + (10px)); .x { c: @c; d: @d; }'))
      .toBe('.x { c: clamp(1px, (10px), 3em); d: calc(1px + (10px)); }');
  });

  // Kept math is its arithmetic inside a math function in every dialect, never a nested `calc()` (owner 2026-10-06).
  it('writes kept math a math function reads as its arithmetic in .scss and .jess', async () => {
    const preserve = new Compiler({ compile: { unitMode: 'preserve' } });
    const out = async (extension: '.scss' | '.jess', source: string): Promise<string> =>
      (await preserve.renderString(source, { extension, suppressWarnings: true })).replace(/\s+/g, ' ').trim();
    expect(await out('.scss', '$x: 1px + 1em; .a { w: calc(100% - ($x)); v: calc(($x) * 2); }'))
      .toBe('.a { w: calc(100% - (1px + 1em)); v: calc((1px + 1em) * 2); }');
    expect(await out('.jess', '$x: $(1px + 1em);\n.a { w: calc($x * 2); }')).toBe('.a { w: calc((1px + 1em) * 2); }');
  });

  it('still consumes the parens of Less math outside a math function', async () => {
    expect(await render('@v: 1; .x { a: (1px + 2px) 3px; b: -(@v); c: ((1px + 2px)); }'))
      .toBe('.x { a: 3px 3px; b: -1; c: 3px; }');
    expect(await render('.x { w: 4px * (1 + 1) / 4 + 3px; v: 2 * (1px + 1em); }', { mathMode: 'parens' }))
      .toBe('.x { w: 4px * 2 / 4 + 3px; v: 2 * calc(1px + 1em); }');
  });

  /*
   * Division by zero is an evaluation error in every unit mode (owner
   * 2026-09-24, DESIGN-DECISIONS P35): the author opted into division and there
   * is no quotient to print. This is the case the `units/loose` and
   * `units/no-strict` fixtures used to carry as `ignores 0/0 rules`.
   */
  it('raises on division by zero under math: always, in every unit mode', async () => {
    for (const unitMode of ['strict', 'loose', 'preserve'] as const) {
      await expect(render('.x { font: ignores 0/0 rules; }', { mathMode: 'always', unitMode }), unitMode)
        .rejects.toMatchObject({ code: 'eval/division-by-zero' });
      await expect(render('.x { w: (1px / 0); }', { unitMode }), unitMode)
        .rejects.toMatchObject({ code: 'eval/division-by-zero' });
    }
    expect(await render('.x { font: ignores 0/0 rules; }')).toBe('.x { font: ignores 0 / 0 rules; }');
  });

  it('keeps calc() around a value that is not one number', async () => {
    expect(await render('@v: 50vh/2; .x { w: calc(@v); }')).toBe('.x { w: calc(50vh / 2); }');
  });

  /*
   * In `.less` and `.jess` a `calc()` keeps its wrapper around one number too
   * (ledger V32, SETTLED — orchestrator judgment under owner delegation
   * 2026-10-07, principle O17): the property clamps a math function's result
   * and not a bare value (P35), so `padding: calc(min(-5px, 1px))` stays valid
   * where `padding: -5px` is dropped. A typed consumer still reads the number.
   * A `.scss` `calc()` is a Sass calculation, which dart-sass simplifies to the
   * number.
   */
  it('keeps calc() around one number in .less and .jess, as a Sass calculation simplifies it', async () => {
    expect(await render('@x: 3px; .x { q: calc(percentage(0.5)); p: calc(min(-5px, 1px)); r: calc(5px); w: calc(@x); n: calc(1px + calc(5px)); }'))
      .toBe('.x { q: calc(50%); p: calc(-5px); r: calc(5px); w: calc(3px); n: calc(1px + calc(5px)); }');
    expect(await render('@c: calc(percentage(0.5)); .x { a: @c * 2; b: unit(calc(5px)); c: percentage(calc(0.5)); e: calc(@c); }'))
      .toBe('.x { a: 100%; b: 5; c: 50%; e: calc(50%); }');
    expect(await renderJess('@-from "#less" import (percentage); $x: 3px; .x { q: calc($percentage(0.5)); r: calc(5px); w: calc($x); z: calc($(1px + 2px)); }'))
      .toBe('.x { q: calc(50%); r: calc(5px); w: calc(3px); z: calc(3px); }');
    expect(await renderIn('.scss', '$x: 3px; .x { q: calc(percentage(0.5)); p: calc(min(-5px, 1px)); r: calc(5px); w: calc($x); s: calc(10px * 2); u: calc((min(-5px, 1px))); }'))
      .toBe('.x { q: 50%; p: -5px; r: 5px; w: 3px; s: 20px; u: -5px; }');
  });

  /* Escaped text is opaque (V3): unwrapping it would write `w: 100% - 2px`, which no browser accepts. lessc 4.9.1 and dart-sass keep the calc(). */
  it('keeps calc() around escaped or interpolated text', async () => {
    expect(await render('@a: 2px; @c: ~"100% - @{a}"; .x { w: calc(~"100% - @{a}"); v: calc(@c); u: calc(e("100% - @{a}")); t: translateX(calc(~"100% - @{a}")); }'))
      .toBe('.x { w: calc(100% - 2px); v: calc(100% - 2px); u: calc(100% - 2px); t: translateX(calc(100% - 2px)); }');
    expect(await renderIn('.scss', '$a: 2px; .x { w: calc(#{"100% - #{$a}"}); v: calc(#{$a}); }'))
      .toBe('.x { w: calc(100% - 2px); v: calc(2px); }');
  });

  it('keeps the parens of an authored group that a preserved call does not evaluate', async () => {
    expect(await render('.x { w: hsl(210, percentage((20 / 20)), 50%); }'))
      .toBe('.x { w: hsl(210, percentage((20 / 20)), 50%); }');
  });

  /*
   * Ledger F8: math written OUTSIDE a math function is the same computation when
   * a `calc()` reads it — through a variable, a group or a call argument. The
   * `calc()` keeps its own operations as written; it does not make another
   * operation less strict, nor silence the warning `preserve` owes the author.
   */
  it('answers unitMode for math a calc() reads but did not write', async () => {
    for (const source of [
      '@x: 1px + 1em; .x { w: calc(@x * 2); }',
      '@x: (1px * 2px); .x { w: calc(100% - @x); }',
      '.x { w: calc(1px + foo(2px + 3em)); }'
    ]) {
      await expect(render(source, { unitMode: 'strict' }), source).rejects.toThrow('Invalid unit arithmetic');
      const { warnings } = await new Compiler({ quiet: true })
        .renderToResult({ source, filePath: 'entry.less', extension: '.less' }, { quiet: true });
      expect(warnings.map(w => w.code), source).toEqual(['eval/unexpressible-unit']);
    }
    expect(await render('@w: (10px + 2em); .x { w: calc(100% - @w); k: @w; }', { unitMode: 'loose' }))
      .toBe('.x { w: calc(100% - 12px); k: 12px; }');
  });

  it('validates the units of every slash-list side, as it does a lone operation', async () => {
    await expect(render('.x { w: 2px*3px/1px; }', { unitMode: 'strict' })).rejects.toThrow('Invalid unit arithmetic');
    await expect(render('.x { w: 2px*3px; }', { unitMode: 'strict' })).rejects.toThrow('Invalid unit arithmetic');
  });

  it('gives an @import media postlude the same query value as @media', async () => {
    expect(await render('@import url(a.css) (min-width: 2*3px);')).toBe('@import url(a.css) (min-width: 6px);');
    expect(await render('@media (min-width: 2*3px) { .y { k: 1; } }')).toBe('@media (min-width: 6px) { .y { k: 1; } }');
  });

  it('leaves a <declaration-value> payload literal: style() and var() fallbacks', async () => {
    expect(await render('@a: 3; @container style(--x: @a * 2) { .y { k: 1; } }'))
      .toBe('@container style(--x: 3 * 2) { .y { k: 1; } }');
    expect(await render('@a: 3; .x { w: var(--y, @a * 2); v: var(--y, 4 / 2 + 5em); }'))
      .toBe('.x { w: var(--y, 3 * 2); v: var(--y, 4 / 2 + 5em); }');
    expect(await render('.x { w: var(--y, 1/2); }', { mathMode: 'always' })).toBe('.x { w: var(--y, 1/2); }');
  });
});
