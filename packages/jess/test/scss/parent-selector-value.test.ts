import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * `&` in a SCSS value is the parent selector (owner 2026-10-19: "in .scss, in
 * these cases, i think do what sass does"): the selector of the style rule it is
 * evaluated in, as a comma list of space lists, or `null` outside any rule.
 *
 * Every expectation is Dart Sass 1.101.7's output (`sass --no-source-map`, the
 * `sass` devDependency), with the blank line Dart Sass writes between top-level
 * rules dropped. The output is collapsed so the selectors read as Dart Sass
 * writes them; where a rule's own header is a selector list, Jess writes it one
 * branch per line (ledger O8) or compacts it into `:is()` (O10), and the
 * expectation keeps that header with Dart Sass's declarations.
 */
const render = async (source: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> =>
  new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension });

const cases: ReadonlyArray<readonly [string, string, string]> = [
  ['the rule it is in', '.a { x: &; }', '.a {\n  x: .a;\n}\n'],
  ['every branch of a nested selector list', '.a, .b { .c { x: &; } }', ':is(.a, .b) .c {\n  x: .a .c, .b .c;\n}\n'],
  ['a BEM element, interpolated into a string', '.card { &__title { content: "#{&}"; } }', '.card__title {\n  content: ".card__title";\n}\n'],
  ['a descendant rule, interpolated into a string', '.list { .item { content: "#{&}"; } }', '.list .item {\n  content: ".list .item";\n}\n'],
  ['a mixin argument', '@mixin label($s) { content: "#{$s}"; } .q, .r { @include label(&); }', '.q,\n.r {\n  content: ".q, .r";\n}\n'],
  ['the rule a mixin is included in', '@mixin own { content: "#{&}"; } .nav > .link { @include own; }', '.nav > .link {\n  content: ".nav > .link";\n}\n'],
  ['the rule a function is called in', '@function bem($name) { @return "#{&}__#{$name}"; } .card { content: bem(title); }', '.card {\n  content: ".card__title";\n}\n'],
  ['the rule a content block is placed in', '@mixin hover { &:hover { @content; } } .btn { @include hover { content: "#{&}"; } }', '.btn:hover {\n  content: ".btn:hover";\n}\n'],
  ['each rule an @each places', '@each $tone in info, warn { .alert-#{$tone} { content: "#{&}"; } }', '.alert-info {\n  content: ".alert-info";\n}\n.alert-warn {\n  content: ".alert-warn";\n}\n'],
  ['the rule around an @media', '.panel { @media (min-width: 640px) { content: "#{&}"; } }', '@media (min-width: 640px) {\n  .panel {\n    content: ".panel";\n  }\n}\n'],
  ['the rule a variable is assigned in', '.menu { $root: &; .entry { content: "#{$root}"; } }', '.menu .entry {\n  content: ".menu";\n}\n'],
  ['an @if that tells a rule from the root', '@mixin theme { @if & { color: red; } @else { :root { color: red; } } } @include theme; .t { @include theme; }', ':root {\n  color: red;\n}\n.t {\n  color: red;\n}\n']
];

/*
 * These read `&` as Dart Sass does too, but their `.jess` spelling waits on
 * lowerings outside `&`: Sass's global list functions, a `#{…}` in a selector
 * (`.jess` `${…}` takes a variable name) and Sass's `if()`.
 */
const unlowered: ReadonlyArray<readonly [string, string, string]> = [
  ['a list the list functions read', '.s, .t .u { a: length(&); b: nth(&, 1); c: nth(nth(&, 2), 2); }', '.s,\n.t .u {\n  a: 2;\n  b: .s;\n  c: .u;\n}\n'],
  ['a selector interpolation in a nested rule', '.a { #{&}__b { c: d; } }', '.a .a__b {\n  c: d;\n}\n'],
  ['a truthy condition inside a rule', '.f { x: if(&, yes, no); }', '.f {\n  x: yes;\n}\n'],
  ['null outside any rule', '$sel: &; .a { content: if($sel, nested, root); }', '.a {\n  content: root;\n}\n']
];

describe('scss: `&` in a value is the parent selector', () => {
  it.each([...cases, ...unlowered])('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  it('is the same value in nested output', async () => {
    await expect(new Compiler().renderString('.a, .b { .c { x: &; } }', { extension: '.scss' }))
      .resolves.toBe('.a,\n.b {\n  .c {\n    x: .a .c, .b .c;\n  }\n}\n');
  });
});

/*
 * Owner 2026-10-19: "& should also be accepted as a value in .jess IMO". SCSS
 * `&` in a value lowers to `.jess` `&` (`#{&}` in a string to `$(&)`), so
 * `.scss → .jess → .css` writes what `.scss → .css` does.
 */
describe('scss → jess: `&` in a value lowers to `&`', () => {
  it.each(cases)('%s', async (_name, source) => {
    const jess = emitJess(parseScss(source));
    await expect(render(jess, '.jess')).resolves.toBe(await render(source));
  });
});
