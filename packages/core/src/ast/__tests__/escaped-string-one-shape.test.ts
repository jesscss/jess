import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { parse as parseJess } from '../../../../syntax/jess/jess-parser/src/index.js';
import { Context } from '../../context.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';
import type { Stylesheet } from '../nodes.js';

/*
 * Owner ruling 2026-10-06 (ledger D22, V3): an escaped string is a string.
 * `~"0.5"` and `~"@{x}"` — and `.jess` `~"x$(1 + 1)y"` — are one node shape and
 * one value: opaque, never re-read as a number, a colour or a keyword.
 */

const evaluator = buildEvaluator(makeLessRegistry());

function render(document: Stylesheet, compress = false): string {
  const context = new Context();
  context.registerValueEvaluator(evaluator);
  return serialize(document, { context, compress }).css ?? '';
}

const less = (source: string): string => render(parseLess(source));
const jess = (source: string): string => render(parseJess(source));

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

  it('leaves interpolation outside an escaped string alone', () => {
    expect(less('@n: 4; @p: border; @q: ~"(min-width: 4px)";\n.s-@{n} { @{p}-width: 1px; }\n@media @{q} { .m { a: b; } }'))
      .toBe('.s-4 {\n  border-width: 1px;\n}\n@media (min-width: 4px) {\n  .m {\n    a: b;\n  }\n}\n');
  });
});

/*
 * Text the parser produced is typed from the parse, never by sniffing its
 * bytes back (SEMANTIC-INVARIANTS P0). Each case below used to type joined or
 * spliced bytes by reading them; each now reads the parser's own typing.
 */
describe('typed positions read the parser\'s typing, not the bytes', () => {
  it('types an unquoted value template as opaque text, as its .jess spelling ~"…" is', () => {
    // Was `50%`: the spliced `0.5` was read back as a number.
    expect(less('@x: 0.5;\n.a { u: percentage(@{x}); }')).toBe('.a {\n  u: percentage(0.5);\n}\n');
  });

  it('types a quoted template as a string from the delimiters the grammar built', () => {
    expect(less('@x: 0.5;\n.a { q: percentage("@{x}"); e: percentage(e("@{x}")); }'))
      .toBe('.a {\n  q: percentage("0.5");\n  e: percentage(0.5);\n}\n');
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

  it('keeps a kept computation\'s bytes a keyword rather than re-reading them', () => {
    // A merged property joins its members to bytes; those bytes are not re-read as a number.
    expect(less('.a { m+: 0.25; p: percentage($m); }')).toBe('.a {\n  m: 0.25;\n  p: percentage(0.25);\n}\n');
  });

  it('compares map member names as names against a quoted key', () => {
    // `"true"` names no member by its bytes, so the lookup compares by value; the member `true` is a name, not a boolean.
    expect(jess('$m: @{ red: 1; true: 2; };\n.a { a: $m["red"]; b: $m["true"]; }')).toBe('.a {\n  a: 1;\n  b: 2;\n}\n');
  });

  it('has no byte-sniffing seam on the evaluator', () => {
    expect('materialize' in evaluator).toBe(false);
  });
});
