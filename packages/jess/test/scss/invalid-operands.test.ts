import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseJess } from '@jesscss/jess-parser';
import { parse as parseScss } from '@jesscss/scss-parser';
import { parse as parseLess } from '@jesscss/less-parser';
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

  /*
   * A leading operand only evaluation knows gives the quoting, as in Dart Sass:
   * an unquoted string an unquoted result, a quoted one a quoted result.
   */
  it.each([
    ['$prefix: btn; .a { b: $prefix + "-primary"; }', '.a {\n  b: btn-primary;\n}\n'],
    ['$prefix: "btn"; .a { b: $prefix + "-primary"; }', '.a {\n  b: "btn-primary";\n}\n'],
    ['$gap: 1rem; .a { b: $gap + " auto"; }', '.a {\n  b: "1rem auto";\n}\n'],
    ['$open: "("; .a { b: $open + unquote("x"); }', '.a {\n  b: "(x";\n}\n']
  ])('takes its quoting from a leading variable: %s', async (source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  it('has no .jess spelling when a leading variable decides its quoting', () => {
    expect(() => emitJess(parseScss('$prefix: btn; .a { b: $prefix + "-primary"; }'))).toThrow(/quoting from a value known at evaluation/);
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
  ['operators/plus.hrx syntax/whitespace/left/space', 'a {b: c +d}'],
  ['operators/plus.hrx syntax/whitespace/right', 'a {b: c+ d}'],
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

/* The error names the operator of the operation that fails, in every dialect. */
describe('an invalid operand is reported at its operator', () => {
  it.each([
    ['operators/plus.hrx syntax/whitespace/both', 'a {b: c + d}', '.scss', 1, 9],
    ['the last operator of a chain', '.a {\n  b: 1 + 2 - foo;\n}', '.scss', 2, 12],
    ['an operator inside a group', '.a {\n  c: 1px * (2 + bar);\n}', '.scss', 2, 15],
    ['a sum before a string literal', '.a { b: true + 1 + "x"; }', '.scss', 1, 14],
    ['Less', '.a { b: foo + 1px; }', '.less', 1, 13],
    ['.jess', '.a { b: $(1 + 2 - foo); }', '.jess', 1, 17]
  ] as const)('%s', async (_name, source, extension, line, column) => {
    await expect(render(source, extension)).rejects.toMatchObject({ code: 'eval/invalid-operand', line, column });
  });
});

/*
 * Math in a CSS math function, or in a call written out as-is, is kept as
 * written; `/` is not ruled in `.scss` and `.jess` (a separator there, or
 * unoperated division). Each is what it was before the operand rule.
 */
const kept: ReadonlyArray<readonly [source: string, expected: string]> = [
  ['.a { b: calc(foo + 1px); }', '.a {\n  b: calc(foo + 1px);\n}\n'],
  ['.a { b: min(foo + 1px, 2px); }', '.a {\n  b: min(foo + 1px, 2px);\n}\n'],
  ['.a { b: calc-size(auto, size + 1px); }', '.a {\n  b: calc-size(auto, size + 1px);\n}\n'],
  ['.a { b: calc(var(--x) + 1px); }', '.a {\n  b: calc(var(--x) + 1px);\n}\n'],
  ['.a { b: foo / bar; }', '.a {\n  b: foo / bar;\n}\n']
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

  /*
   * An unoperated slash (`10px / 2`) is division kept as written, not a list
   * operand: `.jess` writes it as Less does (less.js
   * `operations-advanced.less`: `@div-op * 2` with `@div-op: 10px / 2`).
   */
  it('keeps math on an unoperated slash as Less does', async () => {
    const compile = { unitMode: 'preserve' as const };
    await expect(new Compiler({ compile }).renderString('$d: 10px / 2; .a { r: $($d * 2); }', { extension: '.jess' })).resolves.toBe('.a {\n  r: calc(10px / 2 * 2);\n}\n');
    await expect(new Compiler({ compile }).renderString('@d: 10px / 2; .a { r: @d * 2; }', { extension: '.less' })).resolves.toBe('.a {\n  r: calc(10px / 2 * 2);\n}\n');
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
    ['$b: 2px; .a { b: 0.75rem + unquote(" + ") + $b; }', '~"$(0.75rem) + $($b)"'],
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
    '.a { b: (foo * 2); }',
    '.a { b: (1 + true); }',
    '.a { b: (url(a.png) + 1); }',
    '.a { b: (foo / 2); }',
    '.a { b: (foo - 1); }'
  ])('%s', async (source) => {
    await expect(render(source, '.less')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  /* Where a slash is CSS's separator it is not division (less.js `css-grid`, `css-3` under `math: always`). */
  it('leaves a separating slash alone', async () => {
    const source = '.a { grid-column: container-left / span 1; background: url(x.svg) 0 0 / contain; }';
    const expected = '.a {\n  grid-column: container-left / span 1;\n  background: url(x.svg) 0 0 / contain;\n}\n';
    await expect(render(source, '.less')).resolves.toBe(expected);
    await expect(new Compiler({ compile: { mathMode: 'always' } }).renderString(source, { extension: '.less' })).resolves.toBe(expected);
  });

  it('leaves math in calc() and math Less does not compute as written', async () => {
    await expect(render('.a { b: calc(foo + 1px); c: min(foo + 1px, 2px); }', '.less')).resolves.toBe('.a {\n  b: calc(foo + 1px);\n  c: min(foo + 1px, 2px);\n}\n');
    await expect(new Compiler({ compile: { mathMode: 'parens' } }).renderString('.a { b: foo + 1; }', { extension: '.less' })).resolves.toBe('.a {\n  b: foo + 1;\n}\n');
  });
});

/*
 * Owner 2026-10-23, asked whether `foo - bar` and `var(--x) + 1px` are errors
 * in `.scss` and `.jess`: *"yes"*; on colour math, which Dart Sass rejects
 * ("Undefined operation"): *"ya keep it an error in .scss"*. Less and `.jess`
 * keep colour math (ledger V36, V13).
 */
describe('scss and jess: - on a keyword, a call operand, and .scss colour math', () => {
  it.each([
    ['operators/minus.hrx syntax/whitespace/both', 'a {b: c - d}'],
    ['a keyword and a number', '.a { b: foo - 1px; }'],
    ['a call written out as-is', '.a { b: var(--x) + 1px; }'],
    ['non_conformant/sass_4_0/color_arithmetic/addition/color_color.hrx', '$v: #abc + #123; a { b: $v; }'],
    ['non_conformant/sass_4_0/color_arithmetic/addition/color_number.hrx', '$v: #abc + 1; a { b: $v; }'],
    ['non_conformant/sass_4_0/color_arithmetic/multiplication/color_number.hrx', '$v: #abc * 1; a { b: $v; }'],
    ['named colours', '.a { b: black + blue; c: red * 2; }']
  ])('.scss fails the compile: %s', async (_name, source) => {
    await expect(render(source)).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it.each(['.a { b: $(foo - bar); }', '$x: var(--x);\n.a { b: $($x + 1px); }'])('.jess fails the compile: %s', async (source) => {
    await expect(render(source, '.jess')).rejects.toMatchObject({ code: 'eval/invalid-operand' });
  });

  it('keeps colour math in Less and in its .jess lowering', async () => {
    const less = '.a { b: (black + blue); c: (#111 + 1); }';
    const expected = '.a {\n  b: #0000ff;\n  c: #121212;\n}\n';
    await expect(render(less, '.less')).resolves.toBe(expected);
    await expect(render(emitJess(parseLess(less)), '.jess')).resolves.toBe(expected);
  });

  it('keeps math in calc() as written', async () => {
    await expect(render('.a { b: calc(var(--x) + 1px); c: 1px - 2px; d: foo / bar; }')).resolves.toBe('.a {\n  b: calc(var(--x) + 1px);\n  c: -1px;\n  d: foo / bar;\n}\n');
  });
});
