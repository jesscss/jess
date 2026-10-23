import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseJess } from '@jesscss/jess-parser';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * `+` on text in `.scss` and `.jess` (ledger V36; owner 2026-10-22: support it
 * "when one side is a quoted string", and "make everything else an error").
 * A quoted string on either side joins the two values' text, quoted as Dart
 * Sass 1.101.7 quotes it (`sass --no-source-map`); `+`, `*` and `%` on any
 * other value that is not a number fail the compile. Inputs are the owner's
 * examples and sass-spec's (file and section named).
 */
const render = (source: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> =>
  new Compiler({}).renderString(source, { extension });

const joins: ReadonlyArray<readonly [name: string, source: string, expected: string]> = [
  ['the owner example', '$t: 10s; .a { b: "Elapsed: " + $t; }', '.a {\n  b: "Elapsed: 10s";\n}\n'],
  ['a number then a quoted string', '.a { b: 10s + " elapsed"; }', '.a {\n  b: "10s elapsed";\n}\n'],
  ['a quoted string then a word', '.a { b: "foo" + bar; }', '.a {\n  b: "foobar";\n}\n'],
  ['a word then a quoted string', '.a { b: foo + "bar"; }', '.a {\n  b: foobar;\n}\n'],
  ['null and a quoted string', '.a { b: null + "a"; }', '.a {\n  b: "a";\n}\n'],
  ['libsass-closed-issues/issue_2169.hrx', '@function test($a, $b) { @return "#{$a}" + "#{$b}" + "" + ""; }\nfoo { content: test(\'bim\', \'baz\'); }', 'foo {\n  content: "bimbaz";\n}\n'],
  ['libsass-closed-issues/issue_1610.hrx f', 'f { b: "foo" + "," + bar; }', 'f {\n  b: "foo,bar";\n}\n'],
  ['strings in the other quote', `.a { b: "a" + 'b"c'; c: 'it' + "'s"; }`, `.a {\n  b: 'ab"c';\n  c: "it's";\n}\n`],
  ['a call written out as-is', '@font-face { src: local("Foo" + " Bold"); }', '@font-face {\n  src: local("Foo Bold");\n}\n'],
  ['the expression in libsass-closed-issues/issue_439.hrx', '$selector: ".a"; .x { b: "& + " + $selector + " + " + $selector; }', '.x {\n  b: "& + .a + .a";\n}\n']
];

describe('scss: + joins text when one side is a quoted string', () => {
  it.each(joins)('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });
});

const errors: ReadonlyArray<readonly [name: string, source: string]> = [
  ['operators/plus.hrx syntax/whitespace/both', 'a {b: c + d}'],
  ['a word and a number', '.a { b: foo + 1px; }'],
  ['a number and a word', '.a { b: 1px + foo; }'],
  ['a boolean', '.a { b: true + 1; }'],
  ['a list', '.a { b: (1, 2) + 3; }'],
  ['an unquoted string a call returns', '.a { b: unquote("a") + 1; }'],
  ['an interpolation', '$x: 0.5; .a { b: #{$x} + 1; }'],
  ['* on a word', '.a { b: foo * 2; }'],
  ['* on a quoted string', '.a { b: "a" * 2; }'],
  ['% on a word', '.a { b: foo % 2; }']
];

describe('scss: other math on text fails the compile', () => {
  it.each(errors)('%s', async (_name, source) => {
    await expect(render(source)).rejects.toMatchObject({ code: 'eval/text-operand' });
  });
});

/*
 * Text in a CSS math function, or in a call written out as-is, is not this
 * rule: it is kept as written, as Dart Sass keeps it in a calculation. `-` and
 * `/` on text are not ruled and are unchanged.
 */
const kept: ReadonlyArray<readonly [source: string, expected: string]> = [
  ['.a { b: calc(foo + 1px); }', '.a {\n  b: calc(foo + 1px);\n}\n'],
  ['.a { b: min(foo + 1px, 2px); }', '.a {\n  b: min(foo + 1px, 2px);\n}\n'],
  ['.a { b: calc-size(auto, size + 1px); }', '.a {\n  b: calc-size(auto, size + 1px);\n}\n'],
  ['.a { b: max(var(--a) + 1px, 2px); }', '.a {\n  b: max(var(--a) + 1px, 2px);\n}\n'],
  ['.a { b: foo - bar; c: foo / bar; }', '.a {\n  b: foo - bar;\n  c: foo / bar;\n}\n']
];

describe('scss: text in a math function or a written-out call is kept', () => {
  it.each(kept)('%s', async (source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });
});

describe('jess: $( … ) + follows the same rule', () => {
  it.each([
    ['$t: 10s;\n.a { b: $("Elapsed: " + $t); }', '.a {\n  b: "Elapsed: 10s";\n}\n'],
    ['.a { b: $(10s + " elapsed"); }', '.a {\n  b: "10s elapsed";\n}\n'],
    ['.a { b: $(foo + "bar"); }', '.a {\n  b: foobar;\n}\n'],
    ['.a { b: $("a" + (1, 2)); }', '.a {\n  b: "a1, 2";\n}\n'],
    ['.a { b: $(("a" + "b")); }', '.a {\n  b: "ab";\n}\n']
  ])('%s', async (source, expected) => {
    await expect(render(source, '.jess')).resolves.toBe(expected);
  });

  it.each(['.a { b: $(foo + bar); }', '.a { b: $(true + 1); }', '.a { b: $(foo * 2); }', '.a { b: $(~"a" + 1); }', '.a { b: $((1, 2) + 3); }'])(
    'fails the compile: %s',
    async (source) => {
      await expect(render(source, '.jess')).rejects.toMatchObject({ code: 'eval/text-operand' });
    }
  );

  it('parses a comma list in a $( … ) group as the list a value position builds (ledger P45)', () => {
    const shape = (source: string): unknown => JSON.parse(JSON.stringify(parseJess(source).rules[0], (key, v: unknown) => (key.startsWith('_') || key === 'src' ? undefined : v)));
    const grouped = shape('.a { b: $((1, 2)); }') as { rules: [{ value: { parts: [{ ref: { value: unknown } }] } }] };
    const written = shape('.a { b: (1, 2); }') as { rules: [{ value: unknown }] };
    expect(grouped.rules[0].value.parts[0].ref.value).toEqual(written.rules[0].value);
  });

  it('keeps string interpolation as it was', async () => {
    await expect(render('$t: 10s;\n.a { b: "Elapsed: $($t)"; }', '.jess')).resolves.toBe('.a {\n  b: "Elapsed: 10s";\n}\n');
  });
});

describe('scss → jess: + lowers to $( … + … )', () => {
  it.each([
    '$t: 10s; .a { b: "Elapsed: " + $t; }',
    '$t: 10s; .a { b: $t + " elapsed"; c: $t * 2; d: ($t + 1s) * 2; e: "a" + "b" + 1px; }'
  ])('%s', async (source) => {
    const jess = emitJess(parseScss(source));
    expect(jess).toContain('$(');
    await expect(render(jess, '.jess')).resolves.toBe(await render(source));
  });
});
