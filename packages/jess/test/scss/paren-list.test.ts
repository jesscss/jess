import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * In `.scss`, parens around a list are list syntax, not part of the value: the
 * parser builds the curly list a Less `~( … )` builds, so the value is the
 * list Dart Sass reads (ledger J16, SCSS paren lists; owner 2026-10-22: *"such
 * that we can emulate dart-sass by parsing it into the right structure"*). A
 * group around one value keeps J16's rule.
 *
 * The inputs are the owner's example and sass-spec's (file and section named);
 * each expected output is Dart Sass 1.101.7's (`sass --no-source-map`).
 */
const render = (source: string): Promise<string> => new Compiler({}).renderString(source, { extension: '.scss' });

const cases: ReadonlyArray<readonly [name: string, source: string, expected: string]> = [
  ['the owner example: a comma list of variables', '$a: 1; $b: 2; .x { y: ($a, $b); }', '.x {\n  y: 1, 2;\n}\n'],
  ['values/lists/brackets.hrx nested/unbracketed/single', 'a {b: [(c,)]}', 'a {\n  b: [c];\n}\n'],
  ['values/lists/brackets.hrx nested/unbracketed/multiple', 'a {b: [(c,) (d e)]}', 'a {\n  b: [c d e];\n}\n'],
  ['core_functions/list/append.hrx single/comma', '@use "sass:list";\na {b: list.append((1,), 2)}', 'a {\n  b: 1, 2;\n}\n'],
  ['core_functions/list/is_bracketed.hrx unbracketed/single', '@use "sass:list";\na {b: list.is-bracketed((1,))}', 'a {\n  b: false;\n}\n'],
  ['core_functions/list/join/single.hrx both/comma/first', '@use "sass:list";\na {b: list.join((1,), [2])}', 'a {\n  b: 1, 2;\n}\n'],
  ['core_functions/list/join/single.hrx first/comma', '@use "sass:list";\na {b: list.join((1,), 2 3 4)}', 'a {\n  b: 1, 2, 3, 4;\n}\n'],
  ['core_functions/list/join/single.hrx second/comma', '@use "sass:list";\na {b: list.join(1 2 3, (4,))}', 'a {\n  b: 1 2 3 4;\n}\n'],
  ['core_functions/list/separator.hrx single/comma', '@use "sass:list";\na {b: list.separator((1,))}', 'a {\n  b: comma;\n}\n']
];

describe('scss: a paren list is the list Dart Sass reads', () => {
  it.each(cases)('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });
});

/*
 * Several paren-wrapped lists, and the functions that read them, as the owner
 * asked ("multiple paren-wrapped expressions to really verify that (and test
 * functions that operate on those values)"). Each expected value is Dart Sass
 * 1.101.7's (Jess writes no blank line between rules).
 */
const several: ReadonlyArray<readonly [source: string, expected: string]> = [
  ['.x { y: ((1, 2), (3, 4)); }', '.x {\n  y: 1, 2, 3, 4;\n}\n'],
  ['.x { y: a (1, 2) b; }', '.x {\n  y: a 1, 2 b;\n}\n'],
  ['.x { y: (1, 2) (3, 4); }', '.x {\n  y: 1, 2 3, 4;\n}\n'],
  ['.x { y: ((1, 2)); }', '.x {\n  y: 1, 2;\n}\n'],
  ['.x { y: #{(1, 2)}; }', '.x {\n  y: 1, 2;\n}\n'],
  ['.x { y: foo((c, d), e); }', '.x {\n  y: foo(c, d, e);\n}\n'],
  ['.x { y: var(--x, (1, 2)); }', '.x {\n  y: var(--x, 1, 2);\n}\n'],
  ['@use "sass:list"; .x { y: list.nth(((1, 2), (3, 4)), 1); z: list.length(((1, 2), (3, 4))); }', '.x {\n  y: 1, 2;\n  z: 2;\n}\n'],
  ['@use "sass:list"; $l: (1, 2); .x { a: $l; b: list.length($l); c: list.index($l, 2); }', '.x {\n  a: 1, 2;\n  b: 2;\n  c: 2;\n}\n'],
  ['@each $v in (1, 2) { .e-#{$v} { a: $v; } }', '.e-1 {\n  a: 1;\n}\n.e-2 {\n  a: 2;\n}\n'],
  ['@function f() { @return (1, 2); } .x { a: f(); b: length(f()); }', '.x {\n  a: 1, 2;\n  b: 2;\n}\n'],
  ['@mixin m($x) { m: $x; n: length($x); } .x { @include m((1, 2)); }', '.x {\n  m: 1, 2;\n  n: 2;\n}\n']
];

describe('scss: several paren lists, and the functions that read them', () => {
  it.each(several)('%s', async (source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });
});

/*
 * A group around one value is escaped where Dart Sass drops its parens (owner
 * 2026-10-22: "if they drop parens when rendering, then those should be parsed
 * as "escaped" when parsing .scss"). The first two are lines of sass-spec
 * inputs; the rest are the orchestrator's examples, measured against Dart
 * Sass 1.101.7, among them the groups Dart Sass keeps: in a Sass calculation
 * and in a CSS `if()` condition (sass-spec `expressions/if/css.hrx`
 * `and/2/and_paren`).
 */
const oneValue: ReadonlyArray<readonly [name: string, source: string, expected: string]> = [
  ['non_conformant/colors/basic.hrx', 'p { color: (red) (green) (blue); }', 'p {\n  color: red green blue;\n}\n'],
  ['non_conformant/scss/null.hrx', 'div { $x: null; j: (null), (null), 3, 4; }', 'div {\n  j: 3, 4;\n}\n'],
  ['a dimension', '.x { y: (10px); }', '.x {\n  y: 10px;\n}\n'],
  ['a variable holding a list', '$l: 1, 2; .x { y: ($l); }', '.x {\n  y: 1, 2;\n}\n'],
  ['a call returning text', '.x { y: (unquote("foo")); }', '.x {\n  y: foo;\n}\n'],
  ['kept in a Sass calculation', '$k: foo; .x { y: calc(2 * ($k)); }', '.x {\n  y: calc(2 * (foo));\n}\n'],
  ['dropped in a call inside a calculation', '.x { y: calc(1px + foo((10px))); }', '.x {\n  y: calc(1px + foo(10px));\n}\n'],
  ['in a media feature', '$d: 10px; @media screen and (min-width: ($d)) { .a { b: c; } }', '@media screen and (min-width: 10px) {\n  .a {\n    b: c;\n  }\n}\n'],
  ['dropped in an interpolation inside a calculation', '.x { y: calc(1px + #{(10px)}); }', '.x {\n  y: calc(1px + 10px);\n}\n'],
  ['kept in a CSS if() condition', 'a {b: if(css(1) and (css(2)): c)}', 'a {\n  b: if(css(1) and (css(2)): c);\n}\n']
];

describe('scss: a group around one value', () => {
  it.each(oneValue)('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });
});

/* Only `.scss` reads these parens as syntax: `.css` and `.jess` keep the group (J16). */
describe('a paren group in .css and .jess keeps its parens', () => {
  it.each(['css', 'jess'])('%s', async (dialect) => {
    await expect(new Compiler({}).renderString('.x { y: (1, 2); z: foo((c, d), e); w: (10px); }', { extension: `.${dialect}` }))
      .resolves.toBe('.x {\n  y: (1, 2);\n  z: foo((c, d), e);\n  w: (10px);\n}\n');
  });
});

/*
 * `$selector` is a string, a list of strings or a list of lists of strings;
 * a deeper list is none (sass-spec `core_functions/selector/parse/error.hrx`),
 * and Dart Sass stops the compile. Jess fails it under `functionMode: 'error'`.
 */
describe('scss: selector.parse() rejects a list nested too deep', () => {
  it.each([
    ['inner_comma', '@use "sass:selector";\na {b: selector.parse(((c,),))}'],
    ['too_nested', '@use "sass:list";\n@use "sass:selector";\na {b: selector.parse((list.append((), list.append((), c)),))}']
  ])('%s', async (_name, source) => {
    await expect(new Compiler({ compile: { functionMode: 'error' } }).renderString(source, { extension: '.scss' }))
      .rejects.toMatchObject({ reason: expect.stringContaining('is not a valid selector: it must be a string, a list of strings, or a list of lists of strings.') });
  });
});

/*
 * Sass's empty `()` is the empty list (owner 2026-10-23: *"a Sass empty `()`
 * would be `{}` (whilst storing the raw, so that Sass functions still work"*):
 * Dart Sass's `list.separator(())` is `space`, `type-of(())` is `list`, and a map
 * function takes it as the empty map. `(a: 1)` is a map.
 */
describe('scss: the empty () is the empty list', () => {
  it.each([
    ['@use "sass:list"; .x { a: list.separator(()); b: list.length(()); c: type-of(()); }', '.x {\n  a: space;\n  b: 0;\n  c: list;\n}\n'],
    ['@use "sass:map"; .x { a: map.has-key((), a); b: type-of(map.merge((), (z: 9))); c: map.has-key(map.merge((), (z: 9)), z); }', '.x {\n  a: false;\n  b: map;\n  c: true;\n}\n'],
    ['@use "sass:list"; .x { a: list.separator(list.join((), (8, 9))); b: list.join([], (8, 9)); }', '.x {\n  a: comma;\n  b: [8, 9];\n}\n'],
    ['$e: (); .x { a: length($e); b: type-of((a: 1)); }', '.x {\n  a: 0;\n  b: map;\n}\n']
  ])('%s', async (source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  it('configures nothing with an empty `with ()`', async () => {
    await expect(render('@use "sass:math" with (); .x { a: 1; }')).resolves.toBe('.x {\n  a: 1;\n}\n');
  });
});

/*
 * `.scss` → `.jess` → CSS writes what `.scss` → CSS writes: a paren list Dart
 * Sass drops converts to `{ … }`, `(1,)` to `{1,}`, `()` to `{}` and a map to
 * `#{ … }` (owner 2026-10-23: *"those need to be separate for Jess syntax (#{}
 * vs {})"*).
 */
describe('scss → .jess → css: paren lists, the empty list and maps', () => {
  it.each([
    ['$a: 1; $b: 2; .x { y: ($a, $b); }', 'y: {$a, $b};'],
    ['.x { y: ((1, 2), (3, 4)); }', 'y: {{1, 2}, {3, 4}};'],
    ['@use "sass:list"; .x { a: list.separator((1,)); b: list.append((1,), 2); }', '$list.separator({1,})'],
    ['@use "sass:list"; $e: (); .x { a: list.separator($e); b: list.length(()); }', '$e: {};'],
    ['@use "sass:map"; $m: (a: 1, b: (c: 2)); .x { a: map.has-key($m, b); b: map.get($m, b, c); }', '$m: #{'],
    ['@use "sass:list"; $l: (1, 2); .x { a: $l; b: list.length($l); c: list.index($l, 2); }', '$l: {1, 2};'],
    ['@mixin m($x) { m: $x; } .x { @include m((1, 2)); }', '$ > m({1, 2});']
  ])('%s', async (scss, spelling) => {
    const jess = emitJess(parseScss(scss));
    expect(jess).toContain(spelling);
    await expect(new Compiler({}).renderString(jess, { extension: '.jess' })).resolves.toBe(await render(scss));
  });
});
