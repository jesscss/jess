import { describe, expect, it } from 'vitest';
import { collectTolerantDiagnostics } from '../src/index.js';

/**
 * The editor twin of the compiler's invalid value punctuation error (ledger
 * P48, owner 2026-10-16): the same code, severity, message, reason, fix and
 * location — the declaration — as
 * `packages/jess/test/invalid-value-punctuation.test.ts` asserts for the
 * compile, over the same values.
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';
const DIALECTS = ['css', 'less', 'scss', 'jess'] as const;
const CODE = 'css/invalid-value-punctuation';

const sheet = (value: string): string => `a {\n  color: red;\n  x: ${value};\n}\n`;

function reported(dialect: Dialect, source: string) {
  return collectTolerantDiagnostics({ source, language: dialect }).diagnostics
    .filter(diagnostic => diagnostic.code === CODE || diagnostic.code === 'css/legacy-ie-syntax')
    .map(({ code, phase, defaultSeverity, message, reason, fix, line, column }) => ({ code, phase, defaultSeverity, message, reason, fix, line, column }));
}

const punctuation = (delim: string, line = 3, column = 3) => ({
  code: CODE,
  phase: 'parse',
  defaultSeverity: 'error',
  message: `\`${delim}\` is not valid in any CSS value`,
  reason: `CSS reads \`${delim}\` as a delim token, and no CSS value accepts it, so a browser drops the declaration.`,
  fix: 'Remove it. To pass the text through unchanged, write it in a custom property or a string.',
  line,
  column
});

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
    ['ns.$q', '.$'],
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
    ['a.b alpha(opacity=50)', '.'],
    ['foo(a<b<c)', '<'],
    ['(a.b)', '.'],
    ['(a=b=c)', '='],
    ['foo((a=b=c))', '='],
    ['(a.b = c)', '.'],
    ['(a = b.c)', '='],
    ['foo(a = b~c)', '=']
  ],
  scss: [
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
    ['foo(a<b<c)', '<']
  ]
};

describe('invalid value punctuation is reported at the declaration', () => {
  for (const dialect of DIALECTS) {
    it.each([...EVERY_DIALECT, ...BY_DIALECT[dialect]])(`${dialect}: %s`, (value, delim) => {
      expect(reported(dialect, sheet(value))).toEqual([punctuation(delim)]);
    });
  }

  it('reports each declaration, in a mixin and a detached ruleset too', () => {
    expect(reported('less', '.m() {\n  x: a.b;\n}\n@r: {\n  y: a~b;\n};\n.b { .m(); @r(); }\n')).toEqual([punctuation('.', 2), punctuation('~', 5)]);
  });

  it('scss: a nested property is reported once, at its declaration', () => {
    expect(reported('scss', 'a {\n  font: {\n    family: a.b;\n    size: a~b;\n  }\n}\n')).toEqual([punctuation('.', 2)]);
  });

  it.each(['css', 'scss', 'jess'] as const)('%s: legacy IE syntax wins, reported once', (dialect) => {
    for (const value of ['foo(a=b)', 'a.b alpha(opacity=50)', 'progid:DX.Microsoft.Blur(pixelradius=2)', 'a~b, progid:DX.a(b=1)']) {
      expect(reported(dialect, sheet(value)).map(diagnostic => diagnostic.code)).toEqual(['css/legacy-ie-syntax']);
    }
  });
});

describe('punctuation a dialect or CSS gives meaning is not reported', () => {
  for (const dialect of DIALECTS) {
    it.each([
      'a { --x: a.b~c; --y: =; --z: a|b ^ c?; --w: a:hover > b; --v: <length>; }\n',
      'a { x: attr(ns|foo); }\n',
      '@media (width=600px) { a { b: c } }\n@media (400px<=width<=700px) { a { b: c } }\n@container (width=600px) { a { b: c } }\n',
      '[type=text], a ~ b, ns|a, *|a, .a.b, a[x^="y"], a[x|="y"], a[x~="y"] { c: d }\n',
      'a { x: "a.b~c"; y: foo("a=b"); }\n',
      'a { x: url(a.b?c=d); y: url(https://example.com/a.png?w=1&h=2); }\n',
      '@font-face { unicode-range: U+0025-00FF, u+4??; }\n',
      'a { x: .5em -.5em +.5em 1.5 50%; }\n',
      'a { x: calc(1px + 2px); y: 12px/1.5 a; }\n'
    ])(`${dialect}: %s`, (source) => {
      expect(reported(dialect, source)).toEqual([]);
    });
  }

  for (const dialect of ['css', 'less', 'jess'] as const) {
    it.each(['var(--x, a.b~c)', 'var(--x, a:b)', 'attr(foo, a.b)', 'env(x, a.b)'])(`${dialect}: a fallback: %s`, (value) => {
      expect(reported(dialect, sheet(value))).toEqual([]);
    });
  }

  for (const dialect of ['css', 'less'] as const) {
    it.each([
      'if(media(width = 600px): a; else: c)',
      'if(media(400px <= width <= 700px): a; else: c)',
      'if(supports(selector(.a ~ .b)): a; else: c)',
      'if(supports(selector(ns|a)): a; else: c)',
      'if(style(--x: a.b): a; else: c)',
      'if(style(--a: 1): red; else: blue)',
      'foo(a:b; c:d)'
    ])(`${dialect}: a CSS if() condition or a branch list: %s`, (value) => {
      expect(reported(dialect, sheet(value))).toEqual([]);
    });
  }

  it.each([
    ['less', 'a { x: alpha(opacity=50); y: foo(b=1, c = 2); }\n'],
    ['less', 'a { x: ~"a=b"; y: ~"progid:x.y"; }\n'],
    ['less', '@c: { k: v; }\na { x: @c[k]; }\n'],
    ['less', '#ns { .m() { r: 1; } }\na { x: #ns.m[r]; }\n'],
    ['less', '.m() { x: y; }\n#ns { .m() { z: w; } }\na { .m(); #ns.m(); }\n'],
    ['less', '.m(@a) when (@a = 1) and (@a =< 2) { x: y; }\na { .m(1); }\n'],
    ['less', 'a { x: if((1 = 1), b, c); y: boolean(3 = 4); z: if(boolean(1 = 1), d, e); }\n'],
    ['less', 'a { x: (1 = 1); y: foo((a = b)); }\n'],
    ['less', '.k { x: (not(1 = 1)); }\n'],
    ['less', '@a: 2;\na { x: if(@a > 1, b, c); y: boolean(@a < 2); z: foo(@a > 1); }\n'],
    ['less', '.m(@a) when (@a > 0) and (@a < 5) { x: y; }\na { .m(2); }\n'],
    ['less', '@a: 7;\na { x: @a % 2; y: 10 % 3; z: %("%d/%d", 1, 2); }\n'],
    ['less', 'a { color: red; x: $color; }\n'],
    ['less', '.m(@a: 1; @b: 2) { x: @a @b; }\na { .m(@a: 3); }\n'],
    ['less', '.b { c: d; }\n.a { &:extend(.b); }\n'],
    ['scss', '@use "sass:color";\na { x: color.mix(red, blue); }\n'],
    ['scss', 'a { x: color.mix(red, blue); y: ns.fn(); }\n'],
    ['scss', 'a { x: foo(3 == 4); y: if(1 == 1, a, b); z: foo(1 < 2); }\n'],
    ['scss', 'a { x: foo(not(a=b=c)); }\n'],
    ['scss', '$m: (k: v);\na { x: map-get($m, k); }\n'],
    ['scss', '$a: 2;\na { x: if($a > 1, b, c); y: foo($a <= 1); z: $a % 2; }\n'],
    ['scss', '@mixin m($a: 1) { x: $a; }\na { @include m($a: 3); y: map-get((a: 1, b: 2), a); }\n'],
    ['scss', '%p { c: d; }\na { @extend %p; }\n'],
    ['css', sheet('attr(data-x type(<length> | <percentage>), 0px)')],
    ['jess', 'a { x: $(1 == 2); }\n'],
    ['jess', '$m: { a: 1 };\na { x: $m.a; }\n'],
    ['jess', '$a: 2;\na { x: $($a > 1); }\n'],
    ['jess', sheet('foo(a:b)')]
  ] as const)('%s: %s', (dialect, source) => {
    expect(reported(dialect, source)).toEqual([]);
  });

  /* Not decided (see the compile test): unreported, as the compiler leaves them. */
  it.each([
    ['css', sheet('foo(a.b: c)')],
    ['css', sheet('attr(a.b)')],
    ['less', sheet('boolean(a=b=c)')],
    ['less', sheet('foo(a=b and c=d=e)')],
    ['less', sheet('foo(not a=b=c)')]
  ] as const)('%s: not decided: %s', (dialect, source) => {
    expect(reported(dialect, source)).toEqual([]);
  });

  /*
   * The compiler reports these at the declaration that writes the value (ledger
   * P48 notes); the language service reads the parsed document and does not
   * evaluate references, so a delim that reaches a declaration only through one
   * is not reported here.
   */
  it.each([
    ['less', '@v: a=b;\na { x: @v; }\n'],
    ['less', '.m(@a) { x: @a; }\na { .m(a.b); }\n'],
    ['scss', '$v: a.b;\na { x: $v; }\n'],
    ['scss', '@mixin m($a) { x: $a; }\na { @include m(a=b); }\n'],
    ['jess', '$v: a~b;\na { x: $v; }\n']
  ] as const)('%s: through a reference, not evaluated: %s', (dialect, source) => {
    expect(reported(dialect, source)).toEqual([]);
  });
});
