import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseJess } from '@jesscss/jess-parser';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * Operands an operation is not defined on, and strings built with `+`
 * (ledger V36). In `.scss` a `+` chain with a string literal among its
 * operands is the interpolated string it builds (owner 2026-10-23: *"parse
 * "Elapsed " + 10px as "Elapsed $(10px)""*); any other `+`, `*` and `%` on a
 * keyword, a string, a boolean or a list fails the compile. `.jess` has no
 * string `+` (owner 2026-10-23). In Less, math on a keyword, a call written out
 * as-is or a string fails the compile where Less computes (owner 2026-10-23).
 * Expected outputs are Dart Sass 1.101.7's (`sass --no-source-map`) unless a
 * case says otherwise; inputs are the owner's examples, Bootstrap 5.3.8's and
 * sass-spec's (file named).
 */
const render = (source: string, extension: '.scss' | '.jess' | '.less' = '.scss'): Promise<string> =>
  new Compiler({}).renderString(source, { extension });

const strip = (key: string, value: unknown): unknown => (key.startsWith('_') || key === 'src' || (key === 'value' && typeof value === 'string') ? undefined : value);
const shape = (node: unknown): unknown => JSON.parse(JSON.stringify(node, strip));

const joins: ReadonlyArray<readonly [name: string, source: string, expected: string]> = [
  ['the owner example', '$t: 10s; .a { b: "Elapsed: " + $t; }', '.a {\n  b: "Elapsed: 10s";\n}\n'],
  ['a number then a quoted string', '.a { b: 10s + " elapsed"; }', '.a {\n  b: "10s elapsed";\n}\n'],
  ['a quoted string then a word', '.a { b: "foo" + bar; }', '.a {\n  b: "foobar";\n}\n'],
  ['a word then a quoted string', '.a { b: foo + "bar"; }', '.a {\n  b: foobar;\n}\n'],
  ['operands after the literal, each interpolated', '.a { b: "a" + 1 + 2; }', '.a {\n  b: "a12";\n}\n'],
  ['operands before the literal, one sum', '.a { b: 1 + 2 + "a"; }', '.a {\n  b: "3a";\n}\n'],
  ['an unquoted string literal', '.a { b: unquote("a") + 1; }', '.a {\n  b: a1;\n}\n'],
  ['a list', '.a { b: "a" + (1, 2); }', '.a {\n  b: "a1, 2";\n}\n'],
  ['null', '.a { b: null + "a"; c: "a" + null; }', '.a {\n  b: "a";\n  c: "a";\n}\n'],
  ['an interpolation of a sum', '.a { b: #{"a" + 1}; }', '.a {\n  b: a1;\n}\n'],
  ['libsass-closed-issues/issue_2169.hrx', '@function test($a, $b) { @return "#{$a}" + "#{$b}" + "" + ""; }\nfoo { content: test(\'bim\', \'baz\'); }', 'foo {\n  content: "bimbaz";\n}\n'],
  ['libsass-closed-issues/issue_1610.hrx f', 'f { b: "foo" + "," + bar; }', 'f {\n  b: "foo,bar";\n}\n'],
  ['the expression in libsass-closed-issues/issue_439.hrx', '$selector: ".a"; .x { b: "& + " + $selector + " + " + $selector; }', '.x {\n  b: "& + .a + .a";\n}\n']
];

describe('scss: a + chain with a string literal is the string it builds', () => {
  it.each(joins)('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  it('parses to the interpolated string .jess writes', () => {
    const scss = parseScss('a { b: "Elapsed " + $t; }').rules[0] as { rules: [{ value: unknown }] };
    const jess = parseJess('a { b: "Elapsed $($t)"; }').rules[0] as { rules: [{ value: unknown }] };
    expect(shape(scss.rules[0].value)).toEqual(shape(jess.rules[0].value));
  });

  it('writes a quote a literal holds in the other quote', async () => {
    await expect(render(`.a { b: "a" + 'b"c'; c: 'it' + "'s"; }`)).resolves.toBe(`.a {\n  b: 'ab"c';\n  c: "it's";\n}\n`);
  });
});

/*
 * Bootstrap 5.3.8 builds `calc()` text and selectors with `+`
 * (`scss/_functions.scss` `add()` / `subtract()`, `scss/forms/_input-group.scss`
 * line 120), reached with its defaults (`$input-height`, `.input-group`).
 */
describe('scss: Bootstrap 5.3.8 builds strings as Dart Sass does', () => {
  const functions = `@function add($value1, $value2, $return-calc: true) {
  @if $value1 == null { @return $value2; }
  @if $value2 == null { @return $value1; }
  @if type-of($value1) == number and type-of($value2) == number and comparable($value1, $value2) { @return $value1 + $value2; }
  @return if($return-calc == true, calc(#{$value1} + #{$value2}), $value1 + unquote(" + ") + $value2);
}
`;

  it('add() reaches $input-height', async () => {
    const source = `${functions}$input-line-height: 1.5;
$input-padding-y: .375rem;
$input-height-border: 1px * 2;
$input-height: add($input-line-height * 1em, add($input-padding-y * 2, $input-height-border, false));
.form-control { min-height: $input-height; }`;
    await expect(render(source)).resolves.toBe('.form-control {\n  min-height: calc(1.5em + 0.75rem + 2px);\n}\n');
  });

  /*
   * subtract()'s body, written at the root: Jess does not yet reassign an
   * `@function` parameter inside `@if` (`$value2: …` there is lost), older
   * than this change.
   */
  it('subtract() groups a value that is not a number', async () => {
    const source = `$value1: var(--r); $value2: var(--w);
$value2: unquote("(") + $value2 + unquote(")");
.card { b: calc(#{$value1} - #{$value2}); c: $value1 + unquote(" - ") + $value2; }`;
    await expect(render(source)).resolves.toBe('.card {\n  b: calc(var(--r) - (var(--w)));\n  c: var(--r) - (var(--w));\n}\n');
  });

  it('_input-group.scss builds its validation selector', async () => {
    const source = `$form-validation-states: (valid: 1, invalid: 2);
.input-group {
  $validation-messages: "";
  @each $state in map-keys($form-validation-states) {
    $validation-messages: $validation-messages + ":not(." + unquote($state) + "-tooltip)" + ":not(." + unquote($state) + "-feedback)";
  }
  > :not(:first-child):not(.dropdown-menu)#{$validation-messages} { margin-left: 1px; }
}`;
    await expect(render(source)).resolves.toBe('.input-group {\n  > :not(:first-child):not(.dropdown-menu):not(.valid-tooltip):not(.valid-feedback):not(.invalid-tooltip):not(.invalid-feedback) {\n    margin-left: 1px;\n  }\n}\n');
  });
});

const errors: ReadonlyArray<readonly [name: string, source: string]> = [
  ['operators/plus.hrx syntax/whitespace/both', 'a {b: c + d}'],
  ['a keyword and a number', '.a { b: foo + 1px; }'],
  ['a number and a keyword', '.a { b: 1px + foo; }'],
  ['a boolean', '.a { b: true + 1; }'],
  ['a list', '.a { b: (1, 2) + 3; }'],
  ['strings a variable holds, with no literal', '$a: "p"; $b: "q"; .a { b: $a + $b; }'],
  ['an interpolation, with no literal', '$x: 0.5; .a { b: #{$x} + 1; }'],
  ['* on a keyword', '.a { b: foo * 2; }'],
  ['* on a string', '.a { b: "a" * 2; }'],
  ['% on a keyword', '.a { b: foo % 2; }'],
  ['a keyword in a group', '.a { b: (foo) * 2; }'],
  ['a call\'s string in a group', '.a { b: (unquote("1px + 2px")) * 2; }']
];

describe('scss: other math on an operand it is not defined on fails the compile', () => {
  it.each(errors)('%s', async (_name, source) => {
    await expect(render(source)).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });
});

/*
 * Math in a CSS math function, or in a call written out as-is, is kept as
 * written; a call (`var(--x)`) is not ruled in `.scss`; `-` and `/` are not
 * ruled. Each is what it was before the operand rule.
 */
const kept: ReadonlyArray<readonly [source: string, expected: string]> = [
  ['.a { b: calc(foo + 1px); }', '.a {\n  b: calc(foo + 1px);\n}\n'],
  ['.a { b: min(foo + 1px, 2px); }', '.a {\n  b: min(foo + 1px, 2px);\n}\n'],
  ['.a { b: calc-size(auto, size + 1px); }', '.a {\n  b: calc-size(auto, size + 1px);\n}\n'],
  ['.a { b: var(--x) + 1px; }', '.a {\n  b: var(--x) + 1px;\n}\n'],
  ['.a { b: foo - bar; c: foo / bar; }', '.a {\n  b: foo - bar;\n  c: foo / bar;\n}\n']
];

describe('scss: math in a math function or a written-out call is kept', () => {
  it.each(kept)('%s', async (source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });
});

describe('jess: no string +', () => {
  it.each([
    '$t: 10s;\n.a { b: $("Elapsed: " + $t); }',
    '.a { b: $("a" + "b"); }',
    '.a { b: $(~"a" + 1); }',
    '.a { b: $(foo + 1); }',
    '.a { b: $(true + 1); }',
    '.a { b: $(foo * 2); }',
    '.a { b: $((1, 2) + 3); }'
  ])('fails the compile: %s', async (source) => {
    await expect(render(source, '.jess')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it('builds the string by interpolation', async () => {
    await expect(render('$t: 10s;\n.a { b: "Elapsed: $($t)"; }', '.jess')).resolves.toBe('.a {\n  b: "Elapsed: 10s";\n}\n');
  });

  it('parses a comma list in a $( … ) group as the list a value position builds (ledger P45)', () => {
    const grouped = shape(parseJess('.a { b: $((1, 2)); }').rules[0]) as { rules: [{ value: { parts: [{ ref: { value: unknown } }] } }] };
    const written = shape(parseJess('.a { b: (1, 2); }').rules[0]) as { rules: [{ value: unknown }] };
    expect(grouped.rules[0].value.parts[0].ref.value).toEqual(written.rules[0].value);
  });
});

describe('scss → jess: a built string is the .jess interpolated string', () => {
  it.each([
    ['$t: 10s; .a { b: "Elapsed: " + $t; }', '"Elapsed: $($t)"'],
    ['$a: 0.75rem; $b: 2px; .a { b: $a + unquote(" + ") + $b; }', '~"$($a) + $($b)"'],
    ['$b: 2px; .a { b: unquote("(") + $b + unquote(")"); }', '~"($($b))"'],
    ['.a { b: unquote("x"); }', '~"x"'],
    ['$t: 10s; .a { c: $t * 2; d: ($t + 1s) * 2; }', '$($t * 2)']
  ])('%s', async (source, spelling) => {
    const jess = emitJess(parseScss(source));
    expect(jess).toContain(spelling);
    await expect(render(jess, '.jess')).resolves.toBe(await render(source));
  });
});

describe('less: math on a keyword, a call written out as-is or a string fails where Less computes', () => {
  it.each([
    '.a { b: (foo + 1); }',
    '@w: auto; .a { b: (@w + 10px); }',
    '.a { b: (var(--x) + 1px); }',
    '.a { b: (~"a" + 1); }',
    '.a { b: ("a" + 1); }',
    '.a { b: (foo * 2); }'
  ])('%s', async (source) => {
    await expect(render(source, '.less')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it('leaves math in calc() and math Less does not compute as written', async () => {
    await expect(render('.a { b: calc(foo + 1px); c: min(foo + 1px, 2px); }', '.less')).resolves.toBe('.a {\n  b: calc(foo + 1px);\n  c: min(foo + 1px, 2px);\n}\n');
    await expect(new Compiler({ compile: { mathMode: 'parens' } }).renderString('.a { b: foo + 1; }', { extension: '.less' })).resolves.toBe('.a {\n  b: foo + 1;\n}\n');
  });
});
