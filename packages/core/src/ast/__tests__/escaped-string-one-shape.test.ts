import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { parse as parseJess } from '../../../../syntax/jess/jess-parser/src/index.js';
import { parse as parseScss } from '../../../../syntax/scss/scss-parser/src/index.js';
import { Context } from '../../context.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry, makeSassRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';
import { emitJess } from '../emit-jess.js';
import type { Stylesheet } from '../nodes.js';

/*
 * Owner ruling 2026-10-06 (ledger V3): an escaped string is a string.
 * `~"0.5"` and `~"@{x}"` — and `.jess` `~"x$(1 + 1)y"` — are one node shape and
 * one value: opaque, never re-read as a number, a colour or a keyword. A plain
 * string that interpolates is likewise the same `Quoted` as one that does not
 * (C2: that it is a string is the parser's fact).
 */

const evaluator = buildEvaluator(makeLessRegistry());
const sassEvaluator = buildEvaluator(makeSassRegistry());

function render(document: Stylesheet, compress = false, collapseNesting?: boolean, ev = evaluator): string {
  const context = new Context();
  context.registerValueEvaluator(ev);
  return serialize(document, { context, compress, ...(collapseNesting === undefined ? {} : { collapseNesting }) }).css ?? '';
}

const less = (source: string, compress = false, collapseNesting?: boolean): string => render(parseLess(source), compress, collapseNesting);
const jess = (source: string, collapseNesting?: boolean): string => render(parseJess(source), false, collapseNesting);

describe('an escaped string is one string, interpolating or not', () => {
  it('keeps an interpolating escaped string as opaque as the literal one', () => {
    expect(less('@x: 0.5; @n: 4;\n.a { b: percentage(~"@{x}"); c: ~"@{n}px" + 1; d: percentage(~\'@{x}\'); }'))
      .toBe('.a {\n  b: percentage(0.5);\n  c: calc(4px + 1);\n  d: percentage(0.5);\n}\n');
    expect(less('.a { b: percentage(~"0.5"); c: ~"4px" + 1; d: percentage(~\'0.5\'); }'))
      .toBe('.a {\n  b: percentage(0.5);\n  c: calc(4px + 1);\n  d: percentage(0.5);\n}\n');
  });

  it('stays opaque whatever the spliced values spell', () => {
    expect(less('@q: "0.5"; @a: 0; @b: .5;\n.a { q: percentage(~"@{q}"); ab: percentage(~"@{a}@{b}"); }'))
      .toBe('.a {\n  q: percentage(0.5);\n  ab: percentage(00.5);\n}\n');
  });

  it('is never a colour', () => {
    expect(less('@c: red;\n.a { t: lighten(~"@{c}", 10%); l: lighten(~"red", 10%); }'))
      .toBe('.a {\n  t: lighten(red, 10%);\n  l: lighten(red, 10%);\n}\n');
  });

  it('binds across a mixin argument as the escaped string it spells, as the literal does', () => {
    expect(less('@x: 0.5;\n.m(@v) { a: percentage(@v); }\n.r1 { .m(~"0.5"); }\n.r2 { .m(~"@{x}"); }'))
      .toBe('.r1 {\n  a: percentage(0.5);\n}\n.r2 {\n  a: percentage(0.5);\n}\n');
  });

  it('stays opaque when forwarded through a variable into a mixin argument', () => {
    // Was `50%` / `#ff3333` / `5px`: the argument's eager snapshot bound its bytes and a typed position re-read them.
    const source = '@x: 0.5; @d1: ~"@{x}"; @d2: ~"0.5"; @c: ~"red"; @p: ~"4px";\n'
      + '.m(@v) { a: percentage(@v); }\n.n(@v) { b: lighten(@v, 10%); }\n.o(@v) { c: @v + 1; }\n'
      + '.ri { .m(@d1); }\n.rl { .m(@d2); }\n.rc { .n(@c); }\n.rp { .o(@p); }';
    expect(less(source)).toBe(
      '.ri {\n  a: percentage(0.5);\n}\n.rl {\n  a: percentage(0.5);\n}\n.rc {\n  b: lighten(red, 10%);\n}\n.rp {\n  c: calc(4px + 1);\n}\n'
    );
  });

  it('binds as the same string through a compressed argument and a parameter default', () => {
    expect(less('@x: 0.5;\n.m(@v) { a: percentage(@v); }\n.r { .m(~"@{x}"); }', true)).toBe('.r{a:percentage(0.5)}');
    expect(less('@x: 0.5;\n.m(@v: ~"@{x}") { a: percentage(@v); }\n.r { .m(); }')).toBe('.r {\n  a: percentage(0.5);\n}\n');
    expect(less('@x: 0.5;\n.m(@v: ~"@{x}") { a: percentage(@v); }\n.r { .m(); }', true)).toBe('.r{a:percentage(0.5)}');
  });

  it('keeps a number argument a number across the boundary', () => {
    // The snapshot carries the value the argument was evaluated to; nothing re-reads its bytes.
    expect(less('.m(@n) when (@n > 0) { w-@{n}: @n * 2; .m(@n - 1); }\n.r { .m(2); }'))
      .toBe('.r {\n  w-2: 4;\n  w-1: 2;\n}\n');
  });

  it('keeps a colour argument a colour across the boundary, through a chain of variables and a spread', () => {
    expect(less('@blue: #007bff; @primary: @blue; @pair: @primary, 1px;\n.bv(@b) { c: lighten(@b, 10%); }\n.sp(@b, @w) { d: darken(@b, 10%); w: @w * 2; }\n.x { .bv(@primary); .sp(@pair...); }'))
      .toBe('.x {\n  c: #3395ff;\n  d: #0062cc;\n  w: 2px;\n}\n');
  });

  it('is the same opaque string in .jess, whatever the template holds', () => {
    expect(jess('$x: 0.5;\n.a { b: percentage(~"${x}"); c: percentage(~"0.5"); d: percentage(~"$(0.25 + 0.25)"); e: ~"x$(1 + 1)y"; }'))
      .toBe('.a {\n  b: percentage(0.5);\n  c: percentage(0.5);\n  d: percentage(0.5);\n  e: x2y;\n}\n');
  });

  it('stays an opaque run in an at-rule prelude, compressed or not', () => {
    // The interpolating form was re-spaced as a plain ratio (`16/9`) under compress; the literal never was.
    const source = '@a: 16; @b: 9;\n@media all and (aspect-ratio: ~\'@{a} / @{b}\') { .x { c: d; } }\n@media all and (aspect-ratio: ~\'16 / 9\') { .y { c: d; } }';
    expect(render(parseLess(source), true))
      .toBe('@media all and (aspect-ratio:16 / 9){.x{c:d}}@media all and (aspect-ratio:16 / 9){.y{c:d}}');
  });

  it('never rescans spliced prelude content for its closing quote', () => {
    // Was `(foo: xy")`: the content was re-wrapped as `~"…"` text and scanned for the quote it holds.
    const source = '@v: \'x"y\';\n@media all and (foo: ~"@{v}") { .a { b: c; } }\n@media all and (foo: ~\'x"y\') { .b { b: c; } }';
    expect(less(source)).toBe('@media all and (foo: x"y) {\n  .a {\n    b: c;\n  }\n}\n@media all and (foo: x"y) {\n  .b {\n    b: c;\n  }\n}\n');
    expect(less(source, true)).toBe('@media all and (foo:x"y){.a{b:c}}@media all and (foo:x"y){.b{b:c}}');
  });

  it('writes an escaped CSS import target as its content, interpolating or not', () => {
    // Was `@import ~"foo.css";` — Less escape syntax written into CSS.
    expect(less('@p: "foo";\n@import (css) ~"@{p}.css";')).toBe('@import foo.css;\n');
    expect(less('@import (css) ~"foo.css";')).toBe('@import foo.css;\n');
  });

  /*
   * Escaped text in a selector is printed as written, glued where it stands,
   * interpolating or not (owner 2026-10-09: "everywhere that is text should
   * print AS WRITTEN"): its comma is a character, so `.b` is outside `.p`.
   */
  it('glues a selector string with a comma as written, interpolating or not', () => {
    const literal = less('@s: ~".x, .b";\n.p { @{s} { c: d; .k { e: f; } } }', false, true);
    expect(literal).toBe('.p .x, .b {\n  c: d;\n}\n.p .x, .b .k {\n  e: f;\n}\n');
    expect(less('@a: x; @s: ~".@{a}, .b";\n.p { @{s} { c: d; .k { e: f; } } }', false, true)).toBe(literal);
    expect(jess('$a: x; $s: ~".${a}, .b";\n.p { ${s} { c: d; .k { e: f; } } }', true)).toBe(literal);
  });

  it('glues a sign after an interpolating string as after the literal', () => {
    expect(less('@a: 3;\n.a { b: ~"@{a}" -foo; c: ~"3" -foo; d: "@{a}" -foo; e: "3" -foo; }'))
      .toBe('.a {\n  b: 3 -foo;\n  c: 3 -foo;\n  d: "3" -foo;\n  e: "3" -foo;\n}\n');
  });

  it('leaves interpolation outside a string alone', () => {
    expect(less('@n: 4; @p: border; @q: ~"(min-width: 4px)";\n.s-@{n} { @{p}-width: 1px; }\n@media @{q} { .m { a: b; } }'))
      .toBe('.s-4 {\n  border-width: 1px;\n}\n@media (min-width: 4px) {\n  .m {\n    a: b;\n  }\n}\n');
  });

  it('round-trips an interpolating string key through .jess', () => {
    const source = '$x: b; $m: @{ ab: 2; }; .a { v: $m[~"a${x}"]; w: $m["a${x}"]; }';
    const emitted = emitJess(parseJess(source));
    expect(emitted).toContain('$m[~"a${x}"]');
    expect(emitted).toContain('$m["a${x}"]');
    expect(jess(emitted)).toBe(jess(source));
    expect(jess(source)).toBe('.a {\n  v: 2;\n  w: 2;\n}\n');
  });
});

/*
 * Text the parser produced is typed from the parse, never by sniffing its
 * bytes back (SEMANTIC-INVARIANTS P0, ledger C2). Each case below used to type
 * joined or spliced bytes by reading them; each now reads the parser's own
 * typing.
 */
describe('typed positions read the parser\'s typing, not the bytes', () => {
  it('types an unquoted value template as opaque text, as its .jess spelling ~"…" is', () => {
    // Was `50%`: the spliced `0.5` was read back as a number.
    expect(less('@x: 0.5;\n.a { u: percentage(@{x}); }')).toBe('.a {\n  u: percentage(0.5);\n}\n');
  });

  it('types an interpolating string as the string the parser built', () => {
    // A plain string that interpolates is a `Quoted`; nothing reads its delimiters to learn so.
    const document = parseLess('@x: 0.5;\n.a { q: percentage("@{x}"); e: percentage(e("@{x}")); }');
    const rule = document.rules[1];
    expect(rule?.type === 'Ruleset' ? rule.rules[0] : undefined)
      .toMatchObject({ value: { args: [{ value: { type: 'Quoted', escaped: false, interp: { type: 'Interpolation' } } }] } });
    expect(render(document)).toBe('.a {\n  q: percentage("0.5");\n  e: percentage(0.5);\n}\n');
    expect(render(parseScss('$x: 0.5;\n.a { q: str-length("a#{$x}"); t: type-of("#{$x}"); }'), false, undefined, sassEvaluator))
      .toBe('.a {\n  q: 4;\n  t: string;\n}\n');
  });

  it('types a .jess `$( … )` by its computed value; an unquoted string result stays opaque', () => {
    // `$("0.5")` was `50%`: its unquoted bytes were read back as a number.
    expect(jess('.a { n: percentage($(0.25 + 0.25)); s: percentage($("0.5")); }'))
      .toBe('.a {\n  n: 50%;\n  s: percentage(0.5);\n}\n');
  });

  it('types a property accessor by its declaration\'s parsed value, as a variable', () => {
    // A `~(…)` escaped paren list read through `$name` was its joined bytes, one keyword.
    expect(less('.a { l: ~(1, 2, 3); n: length($l); v: length(@v); @v: ~(1, 2, 3); }'))
      .toBe('.a {\n  l: 1, 2, 3;\n  n: 3;\n  v: 3;\n}\n');
  });

  it('types a merged property accessor by its members\' parsed values', () => {
    // Was `percentage(0.25)` / `lighten(#f00, 10%)` / `1`: the members were joined to bytes and those bytes kept as one keyword.
    expect(less('.a { m+: 0.25; p: percentage($m); }\n.b { m+: #f00; p: lighten($m, 10%); }\n.c { m+: 1px; m+: 2px; l: length($m); }\n.d { m+_: 1px; m+_: 2px; l: length($m); }'))
      .toBe('.a {\n  m: 0.25;\n  p: 25%;\n}\n.b {\n  m: #f00;\n  p: #ff3333;\n}\n.c {\n  m: 1px, 2px;\n  l: 2;\n}\n.d {\n  m: 1px 2px;\n  l: 2;\n}\n');
  });

  it('compares map member names as names against a quoted key', () => {
    // `"true"` names no member by its bytes, so the lookup compares by value; the member `true` is a name, not a boolean.
    expect(jess('$m: @{ red: 1; true: 2; };\n.a { a: $m["red"]; b: $m["true"]; }')).toBe('.a {\n  a: 1;\n  b: 2;\n}\n');
  });

  it('has no byte-sniffing seam on the evaluator', () => {
    expect('materialize' in evaluator).toBe(false);
  });
});
