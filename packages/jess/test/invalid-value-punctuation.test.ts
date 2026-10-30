import { describe, expect, it } from 'vitest';
import type { AbstractPlugin } from '@jesscss/core';
import { CssPlugin } from '@jesscss/compiler-preset';
import lessPlugin from '@jesscss/plugin-less';
import scssPlugin from '@jesscss/plugin-scss';
import jessPlugin from '@jesscss/plugin-jess';
import { Compiler } from '../src/index.js';

/**
 * A delim no CSS value accepts — `.`, `~`, `=`, `|`, `^` or `?`, and `:`, `<`,
 * `>`, `$`, `%` and `&` where no dialect gives them meaning — parses in every
 * dialect as balanced CSS (ledger N18, P45) and then fails the compile
 * with one `css/invalid-value-punctuation` error at the declaration (ledger
 * P48). Owner 2026-10-16: *"the point of parsing valid CSS isn't that we're
 * obligated to actually accept everything. Jess/Less apply diagnostics like a
 * linter / syntax checker"*; *"So all that punctuation is out, yes, except
 * where it is used in Less expressions and forms like mixin calls"*;
 * *"color.mix() should error IMO because it's not valid in any value I'm aware
 * of"*, *"In CSS and Less if processed by Jess"*.
 *
 * The language service reports the same code, message and place
 * (`packages/diagnostics-core/test/invalid-value-punctuation.test.ts`).
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';
const DIALECTS = ['css', 'less', 'scss', 'jess'] as const;

const PLUGINS: Record<Dialect, AbstractPlugin> = {
  css: new CssPlugin(),
  less: lessPlugin(),
  scss: scssPlugin(),
  jess: jessPlugin()
};

const CODE = 'css/invalid-value-punctuation';

/** The declaration sits on line 3, column 3. */
const sheet = (value: string, prelude = ''): string => `${prelude}a {\n  color: red;\n  x: ${value};\n}\n`;

async function compile(dialect: Dialect, source: string) {
  return new Compiler({}).renderToResult({ source, filePath: `/proj/punctuation.${dialect}` }, { suppressWarnings: true });
}

/** Each value, and the delim the error names. */
const EVERY_DIALECT: ReadonlyArray<readonly [value: string, delim: string]> = [
  ['a=b', '='],
  ['a = b', '='],
  ['a~b', '~'],
  ['a|b', '|'],
  ['a^b', '^'],
  ['a ^ b', '^'],
  ['a?b', '?'],
  ['a.b', '.'],
  ['a, b.c', '.'],
  ['red a=b', '='],
  ['foo(a=b=c)', '='],
  ['foo(a~b)', '~'],
  ['foo(x, a~b)', '~'],
  ['foo(bar(a|b))', '|'],
  ['foo(a = b < c)', '='],
  ['a:b', ':']
];

const BY_DIALECT: Record<Dialect, ReadonlyArray<readonly [value: string, delim: string]>> = {
  css: [
    ['foo(a==b)', '=='],
    ['color.mix(red, blue)', '.'],
    ['ns.fn()', '.'],
    ['ns.$q', '.$'], // css reads `.$` as one delim
    ['map.get($m, k)', '.'],
    ['foo(a b=c d)', '='],
    ['foo(a=1px 2px)', '='],
    ['foo("a"=b)', '='],
    ['(a.b)', '.'],
    ['~"a=b"', '~'],
    ['expression(document.body.clientWidth)', '.'],
    ['if(media(width >= 600px): a.b; else: c)', '.'],
    ['foo(a: b.c)', '.'],
    ['a : b', ':'],
    ['foo(x, a:b)', ':'],
    ['a<b', '<'],
    ['a>b', '>'],
    ['foo(a<b<c)', '<'],
    ['<length>', '<'],
    ['$brand-primary', '$'],
    ['AT&T Sans', '&'],
    ['100%%', '%']
  ],
  less: [
    ['foo(a==b)', '=='],
    ['color.mix(red, blue)', '.'],
    ['ns.fn()', '.'],
    ['ns.$q', '.'],
    ['map.get($m, k)', '.'],
    ['@{v}.b', '.'],
    ['expression(document.body.clientWidth)', '.'],
    ['if(media(width >= 600px): a.b; else: c)', '.'],
    ['if((1 = 1), a.b, c)', '.'],
    ['(a.b)', '.'],
    ['(a=b=c)', '='],
    ['foo((a=b=c))', '='], // a paren group of the run, as `(a=b=c)` is anywhere in a value
    ['a.b alpha(opacity=50)', '.'], // Less reads `alpha(opacity=50)` as a comparison (V11)
    ['foo(a<b<c)', '<'], // one comparison is Less's (V11); a chain is the run
    ['<length>', '<'], // a `<syntax>` type name compares nothing
    ['foo(a<b>c)', '<'] // a glued `<b>` after an operand stays the comparison's run
  ],
  scss: [
    ['f(a.b)', '.'],
    ['list.append(c, a.b)', '.'],
    ['expression(document.body.clientWidth)', '.'],
    ['foo(a b=c d)', '='],
    ['foo(a=1px 2px)', '='],
    ['foo("a"=b)', '='],
    ['(a.b)', '.'],
    ['#{$a}.b', '.']
  ],
  jess: [
    ['foo(a==b)', '=='],
    ['color.mix(red, blue)', '.'],
    ['ns.fn()', '.'],
    ['ns.$q', '.'],
    ['map.get($m, k)', '.'],
    ['m.$v', '.'],
    ['foo(a b=c d)', '='],
    ['foo(a=1px 2px)', '='],
    ['foo("a"=b)', '='],
    ['(a.b)', '.'],
    ['expression(document.body.clientWidth)', '.'],
    ['foo(x, a:b)', ':'],
    ['a<b', '<'],
    ['a>b', '>'],
    ['foo(a<b<c)', '<'],
    ['(a ~ b)', '~'],
    ['(3px > 2px and 3px < 5px)', '>'],
    ['(a : b)', ':']
  ]
};

const casesFor = (dialect: Dialect) => [...EVERY_DIALECT, ...BY_DIALECT[dialect]];

describe('invalid value punctuation parses', () => {
  for (const dialect of DIALECTS) {
    it.each(casesFor(dialect))(`${dialect}: %s`, (value) => {
      const result = PLUGINS[dialect].safeParse!(`/proj/punctuation.${dialect}`, sheet(value));
      expect(result.errors).toEqual([]);
      expect(result.document).toBeDefined();
    });
  }
});

describe('invalid value punctuation fails the compile', () => {
  for (const dialect of DIALECTS) {
    it.each(casesFor(dialect))(`${dialect}: %s`, async (value, delim) => {
      const result = await compile(dialect, sheet(value));
      expect(result.css).toBe('');
      expect(result.errors.map(error => [error.code, error.phase, error.line, error.column, error.message])).toEqual([
        [CODE, 'parse', 3, 3, `\`${delim}\` is not valid in any CSS value`]
      ]);
    });
  }

  it('says why, and what to do', async () => {
    const [error] = (await compile('css', sheet('a~b'))).errors;
    expect(error!.reason).toBe('CSS reads `~` as a delim token, and no CSS value accepts it, so a browser drops the declaration.');
    expect(error!.fix).toBe('Remove it. To pass the text through unchanged, write it in a custom property or a string.');
  });

  it.each(DIALECTS)('%s: renderString rejects', async (dialect) => {
    await expect(new Compiler({}).renderString(sheet('a.b'), {
      filePath: `/proj/punctuation.${dialect}`,
      config: { suppressWarnings: true }
    })).rejects.toMatchObject({ code: CODE });
  });

  /* A later identical declaration replaces an earlier one in the output; the error is still the first one written. */
  for (const collapseNesting of [false, true]) {
    it.each(DIALECTS)(`%s: reports the first in source order (collapseNesting: ${collapseNesting})`, async (dialect) => {
      const source = 'a {\n  b {\n    x: a.b;\n    x: a.b;\n  }\n}\n';
      const result = await new Compiler({ output: { collapseNesting } }).renderToResult(
        { source, filePath: `/proj/punctuation.${dialect}` },
        { suppressWarnings: true }
      );
      expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([[CODE, 3, 5]]);
    });
  }

  it('less: a declaration in a called mixin', async () => {
    const result = await compile('less', '.m() {\n  x: a.b;\n}\n.b { .m(); }\n');
    expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([[CODE, 2, 3]]);
  });

  it('less: a declaration in a called detached ruleset', async () => {
    const result = await compile('less', '@r: {\n  x: a~b;\n};\n.b { @r(); }\n');
    expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([[CODE, 2, 3]]);
  });

  it('scss: a nested property is reported at its declaration', async () => {
    const result = await compile('scss', 'a {\n  font: {\n    family: a.b;\n  }\n}\n');
    expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([[CODE, 2, 3]]);
  });

  /* Legacy IE syntax is the more specific error (ledger P47); a value holding both reports it once. */
  it.each(['css', 'scss', 'jess'] as const)('%s: legacy IE syntax wins, reported once', async (dialect) => {
    for (const value of ['foo(a=b)', 'a.b alpha(opacity=50)', 'progid:DX.Microsoft.Blur(pixelradius=2)', 'a~b, progid:DX.a(b=1)']) {
      const result = await compile(dialect, sheet(value));
      expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([['css/legacy-ie-syntax', 3, 3]]);
    }
  });

  it('less: legacy IE syntax wins, reported once', async () => {
    const result = await compile('less', sheet('a~b progid:DX.Microsoft.Blur(pixelradius=2)'));
    expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([['css/legacy-ie-syntax', 3, 3]]);
  });
});

/*
 * A value a reference reaches is checked where it is written, as the same
 * value written in the declaration is (owner 2026-10-16: *"Nah, variables
 * aren't looser"*): the error is the declaration's that writes it.
 */
describe('invalid value punctuation through a reference fails the compile', () => {
  it.each([
    ['less', '@v: a=b;\na { x: @v; }\n', '=', 2, 5],
    ['less', '@v: a.b;\na { x+: @v; x+: c; }\n', '.', 2, 5],
    ['less', '.m(@a) {\n  x: @a;\n}\na { .m(a.b); }\n', '.', 2, 3],
    ['less', '@v: a.b;\n.m(@a) {\n  x: @a;\n}\na { .m(@v); }\n', '.', 3, 3],
    ['less', '@v: a.b;\n.m(@a: @v) {\n  x: @a;\n}\na { .m(); }\n', '.', 3, 3],
    ['less', '@v: (a.b);\na { x: @v; }\n', '.', 2, 5],
    ['less', '@v: a=b;\na { y: foo(@v); }\n', '=', 2, 5],
    ['less', '.m(@rest...) {\n  x: @rest;\n}\na { .m(a.b, c); }\n', '.', 2, 3],
    ['less', '@c: { k: a.b; };\na { x: @c[k]; }\n', '.', 2, 5],
    ['less', '@v: a.b;\na { x: @{v}; }\n', '.', 2, 5],
    ['scss', '$v: a.b;\na { x: $v; }\n', '.', 2, 5],
    ['scss', '$v: a=b;\na { y: foo($v); }\n', '=', 2, 5],
    ['scss', '@function f() { @return a=b; }\na { x: f(); }\n', '=', 2, 5],
    ['scss', '@mixin m($a) {\n  x: $a;\n}\na { @include m(a=b); }\n', '=', 2, 3],
    ['scss', '$v: a.b;\na {\n  font: {\n    family: $v;\n  }\n}\n', '.', 3, 3],
    ['scss', '@mixin m($a) {\n  x: $a;\n}\na { @include m(a.b); }\n', '.', 2, 3],
    ['scss', '$m: (k: a.b);\na { x: map-get($m, k); }\n', '.', 2, 5],
    ['jess', '$v: a~b;\na { x: $v; }\n', '~', 2, 5],
    ['jess', '$m: #{ a: b.c };\na { x: $m.a; }\n', '.', 2, 5]
  ] as const)('%s: %s', async (dialect, source, delim, line, column) => {
    const parsed = PLUGINS[dialect].safeParse!(`/proj/punctuation.${dialect}`, source);
    expect(parsed.errors).toEqual([]);
    const result = await compile(dialect, source);
    expect(result.css).toBe('');
    expect(result.errors.map(error => [error.code, error.line, error.column, error.message])).toEqual([
      [CODE, line, column, `\`${delim}\` is not valid in any CSS value`]
    ]);
  });

  /* Only a value that is written is checked. */
  it.each([
    ['less', 'an unused variable', '@v: a.b;\na { x: y; }\n'],
    ['less', 'an unwritten mixin argument', '@v: a.b;\n.m(@a) { x: y; }\na { .m(a.b); .m(@v); }\n'],
    ['less', 'a function result passed to a rest parameter', '.m(@rest...) { x: @rest; }\n.a { .m(e("|"), c); }\n'], // guards: a parameter snapshot's evaluated bytes read as a delim
    ['scss', 'a function that is never called', '@function f() { @return a=b; }\na { x: y; }\n'],
    ['less', 'a custom property', '@v: a.b;\na { --x: @v; }\n'],
    ['less', 'strings', '@v: a.b;\na { x: "@{v}"; y: ~"@{v}"; }\n'],
    ['less', 'a url', '@v: a.b;\na { x: url(@v); }\n'],
    ['less', 'conditions', '@v: a.b;\na { x: if((@v = a), b, c); y: boolean(@v = a); }\n'],
    ['less', 'a guard', '.m(@a) when not (@a = a) { x: y; }\na { .m(a.b); }\n'],
    ['less', 'a selector and a query', '@v: a.b;\n.c-@{v} { d: e; }\n@media (min-width: @v) { a { b: c; } }\n'],
    ['scss', 'an unused variable', '$v: a.b;\na { x: y; }\n'],
    ['scss', 'a custom property', '$v: a.b;\na { --x: #{$v}; }\n'],
    ['scss', 'a string', '$v: a.b;\na { x: "#{$v}"; }\n'],
    ['jess', 'an unused variable and collection', '$v: a~b;\n$m: #{ a: b.c };\na { x: y; }\n']
  ] as const)('%s: %s compiles', async (dialect, _label, source) => {
    const result = await compile(dialect, source);
    expect(result.errors).toEqual([]);
    expect(result.css).not.toBe('');
  });
});

/*
 * A `var()`, `env()` or `attr()` fallback in a regular declaration is
 * substituted into that property, so it is a value and is checked as one.
 * Owner 2026-10-16, verbatim, on `x: var(--x, a.b~c)`: *"errr... but a.b is not
 * a valid value"*; *"even so... it's not a valid value"*. The custom-property
 * name of `var()`, the variable name of `env()`, and `attr()`'s attribute name,
 * namespace `|` and `type(…)` are not values; a custom property's value,
 * a `var()` in it included, is written as authored.
 */
describe('a var(), env() or attr() fallback is a value', () => {
  it.each([
    ['css', 'a {\n  color: var(--brand, $primary);\n}\n', '$'],
    ['css', 'a {\n  padding-top: env(safe-area-inset-top, $gutter);\n}\n', '$'],
    ['css', 'a {\n  width: attr(data-w type(<length>), $default-width);\n}\n', '$'],

    /* Less reads a `var()` fallback written directly as one text node, not a run (a parser shape gap, pinned below). */
    ...(['css', 'scss', 'jess'] as const).flatMap(dialect => ['var(--gap, a.b)', 'var(--x, a.b~c)', 'attr(foo, a.b)', 'env(x, a.b)']
      .map(value => [dialect, `a {\n  margin: ${value};\n}\n`, '.'] as const)),
    ...(['css', 'scss', 'jess'] as const).map(dialect => [dialect, 'a {\n  margin: var(--x, a:b);\n}\n', ':'] as const),
    ...['attr(foo, a.b)', 'env(x, a.b)'].map(value => ['less', `a {\n  margin: ${value};\n}\n`, '.'] as const),
    ['less', '@gap: a.b;\na {\n  margin: var(--gap, @gap);\n}\n', '.']
  ] as const)('%s: %s fails the compile', async (dialect, source, delim) => {
    const result = await compile(dialect, source);
    expect(result.css).toBe('');
    expect(result.errors.map(error => [error.code, error.line, error.column, error.message])).toEqual([
      [CODE, source.startsWith('@') ? 3 : 2, 3, `\`${delim}\` is not valid in any CSS value`]
    ]);
  });

  /* Known gap: Less builds a fallback written directly as one text node, so its delim is not read until the Less grammar builds the run. */
  it.fails('less: a fallback written directly', async () => {
    const result = await compile('less', 'a {\n  margin: var(--gap, a.b);\n}\n');
    expect(result.errors.map(error => error.code)).toEqual([CODE]);
  });

  it.each([
    ...DIALECTS.flatMap(dialect => [
      [dialect, 'a {\n  width: attr(data-w type(<length>), 0px);\n}\n', 'width: attr(data-w type(<length>), 0px);'],
      [dialect, 'a {\n  width: attr(data-w type(<length>),0px);\n}\n', 'width: attr(data-w type(<length>), 0px);']
    ] as const),
    ...DIALECTS.flatMap(dialect => [
      [dialect, 'a {\n  --y: var(--x, a.b);\n}\n', '--y: var(--x, a.b);'],
      [dialect, 'a {\n  color: var(--brand, red);\n}\n', 'color: var(--brand, red);']
    ] as const)
  ] as const)('%s: %s compiles', async (dialect, source, written) => {
    const result = await compile(dialect, source);
    expect(result.errors).toEqual([]);
    expect(result.css).toContain(written);
  });
});

describe('punctuation a dialect or CSS gives meaning compiles', () => {
  async function clean(dialect: Dialect, source: string): Promise<string> {
    const result = await compile(dialect, source);
    expect(result.errors).toEqual([]);
    return result.css;
  }

  for (const dialect of DIALECTS) {
    it.each([
      ['a custom property', 'a { --x: a.b~c; --y: =; --z: a|b ^ c?; --w: a:hover > b; --v: <length>; }\n'],
      ['attr() with a namespace', 'a { x: attr(ns|foo); }\n'],
      ['a query range', '@media (width=600px) { a { b: c } }\n@media (400px<=width<=700px) { a { b: c } }\n@container (width=600px) { a { b: c } }\n'],
      ['selectors', '[type=text], a ~ b, ns|a, *|a, .a.b, a[x^="y"], a[x|="y"], a[x~="y"] { c: d }\n'],
      ['a string', 'a { x: "a.b~c"; y: foo("a=b"); }\n'],
      ['an unquoted url()', 'a { x: url(a.b?c=d); y: url(https://example.com/a.png?w=1&h=2); }\n'],
      ['a unicode range', '@font-face { unicode-range: U+0025-00FF, u+4??; }\n'],
      ['numbers', 'a { x: .5em -.5em +.5em 1.5 50%; }\n'],
      ['an operator', 'a { x: calc(1px + 2px); y: 12px/1.5 a; }\n']
    ])(`${dialect}: %s`, async (_label, source) => {
      await clean(dialect, source);
    });
  }

  const CSS_IF = [
    'if(media(width = 600px): a; else: c)',
    'if(media(400px <= width <= 700px): a; else: c)',
    'if(media(width >= 600px): 1px; else: 2px)',
    'if(supports(display: grid): a; else: b)',
    'if(supports(selector(.a ~ .b)): a; else: c)',
    'if(supports(selector(ns|a)): a; else: c)',
    'if(style(--x: a.b): a; else: c)',
    'if(media(width < 600px): a; media(width < 900px): b; else: c)',
    'if(style(--a: 1): red; else: blue)'
  ];
  for (const dialect of DIALECTS) {
    it.each(CSS_IF)(`${dialect}: a CSS if() condition: %s`, async (value) => {
      expect(await clean(dialect, sheet(value))).toContain(`x: ${value};`);
    });
  }

  const IF_AND = 'if(media(print) and supports(display: grid): a; else: b)';
  it.each(['css', 'less', 'scss', 'jess'] as const)('%s: a CSS if() condition joined by `and`', async (dialect) => {
    expect(await clean(dialect, sheet(IF_AND))).toContain(`x: ${IF_AND};`);
  });

  /* A call argument whose first item is followed by a `:` is a branch (ledger P38): the colon is its structure. */
  it.each(['css', 'less'] as const)('%s: a branch list', async (dialect) => {
    expect(await clean(dialect, sheet('foo(a:b; c:d)'))).toContain('x: foo(a: b; c: d);');
  });

  it('jess: a branch', async () => {
    expect(await clean('jess', sheet('foo(a:b)'))).toContain('x: foo(a:b);');
  });

  it.each(['css', 'less'] as const)('%s: a typed attr()', async (dialect) => {
    await clean(dialect, sheet('attr(data-x type(<length> | <percentage>), 0px)'));
  });

  it.each([
    ['a comparison argument', 'a { x: alpha(opacity=50); y: foo(b=1, c = 2); }\n', 'x: alpha(false);'],
    ['an escape', 'a { x: ~"a=b"; y: ~"progid:x.y"; }\n', 'x: a=b;'],
    ['a lookup', '@c: { k: v; }\na { x: @c[k]; }\n', 'x: v;'],
    ['a namespaced mixin lookup', '#ns { .m() { r: 1; } }\na { x: #ns.m[r]; }\n', 'x: 1;'],
    ['mixin calls', '.m() { x: y; }\n#ns { .m() { z: w; } }\na { .m(); #ns.m(); }\n', 'x: y;'],
    ['a guard', '.m(@a) when (@a = 1) and (@a =< 2) { x: y; }\na { .m(1); }\n', 'x: y;'],
    ['if() and boolean() conditions', 'a { x: if((1 = 1), b, c); y: boolean(3 = 4); z: if(boolean(1 = 1), d, e); }\n', 'x: b;'],
    ['a condition in a paren group', 'a { x: (1 = 1); y: foo((a = b)); }\n', 'x: (1 = 1);'],
    ['a glued condition keyword', '.k { x: (not(1 = 1)); }\n', 'x: (not(1 = 1));'],
    ['comparisons', '@a: 2;\na { x: if(@a > 1, b, c); y: boolean(@a < 2); z: foo(@a > 1); }\n', 'z: foo(true);'],
    ['a guard with < and >', '.m(@a) when (@a > 0) and (@a < 5) { x: y; }\na { .m(2); }\n', 'x: y;'],
    ['modulo and %()', '@a: 7;\na { x: @a % 2; y: 10 % 3; z: %("%d/%d", 1, 2); }\n', 'z: "1/2";'],
    ['a property accessor', 'a { color: red; x: $color; }\n', 'x: red;'],
    ['a named mixin argument', '.m(@a: 1; @b: 2) { x: @a @b; }\na { .m(@a: 3); }\n', 'x: 3 2;'],
    ['an extend', '.b { c: d; }\n.a { &:extend(.b); }\n', '.b,\n.a {']
  ])('less: %s', async (_label, source, written) => {
    expect(await clean('less', source)).toContain(written);
  });

  it.each([
    ['a module call', '@use "sass:color";\na { x: color.mix(red, blue); }\n'],
    ['a module call written as authored', 'a { x: color.mix(red, blue); y: ns.fn(); }\n'],
    ['`==` and the comparison operators', 'a { x: foo(3 == 4); y: if(1 == 1, a, b); z: foo(1 < 2); }\n'],
    ['the not() operator', 'a { x: foo(not(a=b=c)); }\n'],
    ['a map', '$m: (k: v);\na { x: map-get($m, k); }\n'],
    ['comparisons and modulo', '$a: 2;\na { x: if($a > 1, b, c); y: foo($a <= 1); z: $a % 2; }\n'],
    ['a keyword argument and a map literal', '@mixin m($a: 1) { x: $a; }\na { @include m($a: 3); y: map-get((a: 1, b: 2), a); }\n'],
    ['a placeholder', '%p { c: d; }\na { @extend %p; }\n']
  ])('scss: %s', async (_label, source) => {
    await clean('scss', source);
  });

  it.each([
    ['an expression', 'a { x: $(1 == 2); }\n', 'x: false;'],
    ['a comparison', '$a: 2;\na { x: $($a > 1); }\n', 'x: true;'],
    ['a member lookup', '$m: #{ a: 1 };\na { x: $m.a; }\n', 'x: 1;']
  ])('jess: %s', async (_label, source, written) => {
    expect(await clean('jess', source)).toContain(written);
  });
});

/*
 * NOT DECIDED, for the owner: each is outside both the owner's list of
 * invalid punctuation and the list of what is exempt, so none is reported.
 * Each is pinned as it compiles today; a ruling flips the pin.
 */
describe('not decided: compiles, unreported', () => {
  async function written(dialect: Dialect, source: string): Promise<string> {
    const result = await compile(dialect, source);
    expect(result.errors).toEqual([]);
    return result.css;
  }

  it.each([
    ['css', 'attr(a.b)']
  ] as const)('%s: the attribute name of attr(): %s', async (dialect, value) => {
    await written(dialect, sheet(value));
  });

  it('css: a branch condition of an ordinary call', async () => {
    expect(await written('css', sheet('foo(a.b: c)'))).toContain('x: foo(a.b: c);');
  });

  it.each([
    ['boolean(a=b=c)', 'x: false;'],
    ['foo(a=b and c=d=e)', 'x: foo(false);'],
    ['foo(not a=b=c)', 'x: foo(true);']
  ])('less: a chained comparison inside a Less condition: %s', async (value, css) => {
    expect(await written('less', sheet(value))).toContain(css);
  });
});
