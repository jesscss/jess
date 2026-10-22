import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * In `.scss`, parens around a list are list syntax, not part of the value: the
 * parser builds the escaped group a Less `~( … )` builds, so the value is the
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

/* Only `.scss` reads parens around a list as list syntax: `.css` and `.jess` keep the group (J16). */
describe('a paren group around a list in .css and .jess keeps its parens', () => {
  it.each(['css', 'jess'])('%s', async (dialect) => {
    await expect(new Compiler({}).renderString('.x { y: (1, 2); z: foo((c, d), e); }', { extension: `.${dialect}` }))
      .resolves.toBe('.x {\n  y: (1, 2);\n  z: foo((c, d), e);\n}\n');
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
