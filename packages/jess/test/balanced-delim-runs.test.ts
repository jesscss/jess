import { describe, expect, it } from 'vitest';
import { CssPlugin } from '@jesscss/compiler-preset/css';
import lessPlugin from '@jesscss/plugin-less';
import scssPlugin from '@jesscss/plugin-scss';
import jessPlugin from '@jesscss/plugin-jess';
import { Compiler } from '../src/index.js';

const CODE = 'css/invalid-value-punctuation';

/**
 * Valid, balanced CSS parses in every dialect (owner 2026-10-16: *"we should be
 * more permissive around valid / balanced syntax"*; ledger N18, P45). A CSS
 * delim between component values is a component of the run (css-syntax-3
 * §5.4.9) — unless the dialect gives it a meaning in that position:
 *
 * - Less reads `=`, `<` and `>` in a call argument as its comparison (V11), so
 *   a single comparison evaluates (`alpha(opacity=50)` → `alpha(false)`).
 * - SCSS reads `==` in a call argument as its comparison.
 *
 * A delim no CSS value accepts — `.`, `~`, `=`, `|`, `^` or `?`, and `:`, `<`,
 * `>`, `$`, `%` and `&` where no dialect gives them meaning — then fails the
 * compile with `css/invalid-value-punctuation` (ledger P48, owner 2026-10-16:
 * *"So all that punctuation is out, yes, except where it is used in Less
 * expressions and forms like mixin calls"*); the full matrix is
 * `invalid-value-punctuation.test.ts`. A `progid:` filter is legacy IE syntax
 * (`legacy-ie-syntax.test.ts`).
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';

async function render(dialect: Dialect, source: string): Promise<string> {
  const result = await new Compiler({}).renderToResult({ source, filePath: `/proj/delim-run.${dialect}` }, {});
  expect(result.errors).toEqual([]);
  return String(result.css);
}

async function value(dialect: Dialect, authored: string): Promise<string> {
  const css = await render(dialect, `a { x: ${authored}; }`);
  return css.slice(css.indexOf('x: ') + 3, css.lastIndexOf(';'));
}

/** The error codes a value's compile reports. */
async function errorCodes(dialect: Dialect, authored: string): Promise<string[]> {
  const source = `a { x: ${authored}; }`;
  expect(PLUGINS[dialect].safeParse!(`/proj/delim-run.${dialect}`, source).errors).toEqual([]);
  const result = await new Compiler({}).renderToResult({ source, filePath: `/proj/delim-run.${dialect}` }, {});
  return result.errors.map(error => error.code);
}

const PLUGINS = {
  css: new CssPlugin(),
  less: lessPlugin(),
  scss: scssPlugin(),
  jess: jessPlugin()
};

const DECLARATION_RUNS = [
  'a=b',
  'a = b',
  'a~b',
  'a ~ b',
  'a=b c~d',
  'a=b, c~d',
  'a:b.c',
  'a.b:c(d=e=f)'
];

const ARGUMENT_RUNS = [
  'foo(a=b=c)',
  'foo(a = b < c)',
  'foo(a~b)'
];

describe('a delim between declaration components', () => {
  for (const dialect of ['css', 'scss'] as const) {
    it.each(DECLARATION_RUNS)(`${dialect}: %s parses, then is invalid punctuation`, async (authored) => {
      expect(await errorCodes(dialect, authored)).toEqual([CODE]);
    });
  }

  /* After whitespace a `.jess` block reads `>` and `~` as a selector's leading combinator. */
  it.each(DECLARATION_RUNS.filter(authored => authored !== 'a ~ b'))('jess: %s parses, then is invalid punctuation', async (authored) => {
    expect(await errorCodes('jess', authored)).toEqual([CODE]);
  });

  it.each(DECLARATION_RUNS.slice(0, 7))('less: %s parses, then is invalid punctuation', async (authored) => {
    expect(await errorCodes('less', authored)).toEqual([CODE]);
  });

  it.each(['css', 'less', 'scss', 'jess'] as const)('%s: a glued `:` parses, then is invalid punctuation', async (dialect) => {
    expect(await errorCodes(dialect, 'a:b')).toEqual([CODE]);
  });

  it.each(['css', 'jess'] as const)('%s: `<`, glued or padded, parses, then is invalid punctuation', async (dialect) => {
    expect(await errorCodes(dialect, 'a<b')).toEqual([CODE]);
    expect(await errorCodes(dialect, 'a < b')).toEqual([CODE]);
  });
});

describe('a delim run in a call argument', () => {
  for (const dialect of ['css', 'less', 'scss', 'jess'] as const) {
    it.each(ARGUMENT_RUNS)(`${dialect}: %s parses, then is invalid punctuation`, async (authored) => {
      expect(await errorCodes(dialect, authored)).toEqual([CODE]);
    });
  }

  it.each(['css', 'less', 'jess'] as const)('%s: foo(a==b) parses, then is invalid punctuation', async (dialect) => {
    expect(await errorCodes(dialect, 'foo(a==b)')).toEqual([CODE]);
  });

  it('scss: `==` in an argument is the comparison', async () => {
    expect(await value('scss', 'foo(a==b)')).toBe('foo(false)');
  });

  it('less: a single comparison still evaluates', async () => {
    expect(await value('less', 'foo(a=b)')).toBe('foo(false)');
    expect(await value('less', 'foo(1 < 2)')).toBe('foo(true)');
  });

  /* Written through the parameter, the run is invalid punctuation (P48; owner 2026-10-16: "Nah, variables aren't looser"). */
  it('scss: an `@include` argument with an `=` run parses, then is invalid punctuation where it is written', async () => {
    const source = '@mixin m($a) { x: $a; }\na { @include m(a=b); }';
    expect(PLUGINS.scss.safeParse!('/proj/delim-run.scss', source).errors).toEqual([]);
    const result = await new Compiler({}).renderToResult({ source, filePath: '/proj/delim-run.scss' }, {});
    expect(result.errors.map(error => error.code)).toEqual([CODE]);
  });

  it('scss: a line comment beside an `@include` keyword argument still parses', async () => {
    expect(await render('scss', '@mixin m($a) { x: $a; }\na { @include m($a: // c\n 1); }')).toContain('x: 1;');
  });
});

/*
 * KNOWN GAP (evaluation, not the grammar; ledger N18): a run that reaches the
 * writer through a variable, a mixin or function parameter, or an
 * interpolation loses its authored layout and is written spaced (`a = b`); the
 * same run written in place keeps it. Each turns red when fixed. A run with
 * `=` written into a declaration value through a reference is now invalid
 * punctuation (P48), so those cases left here are a string, an escape, a
 * property name, and `f(a=b)`, which is legacy IE syntax as written (P47).
 */
describe('a substituted delim run keeps its layout', () => {
  it.fails.each([
    ['scss', '@function f($a) { @return $a; }\na { x: f(a=b); }', 'x: a=b;'],
    ['scss', '$v: a=b;\na { s: "#{$v}"; }', 's: "a=b";'],
    ['scss', '$v: a=b;\na { #{$v}: 1; }', 'a=b: 1;'],
    ['less', '@v: a=b;\na { s: ~"@{v}"; }', 's: a=b;']
  ] as const)('%s: %s', async (dialect, source, written) => {
    expect(await render(dialect, source)).toContain(written);
  });
});

/*
 * Where a declaration value ends before a nested rule (ledger N18). `.jess`
 * keeps reading a `>` or `~` after whitespace as the nested rule's leading
 * combinator. OPEN for the owner: a glued `:` now continues the run, so
 * `x: y b:hover { … }` stops, where it was read as `x: y b` and a `:hover`
 * rule; SCSS reads a delim-run value followed by a block as a nested property.
 */
describe('a delim run before a nested rule', () => {
  it.each([
    ['a { x: y\n > b { c: d } } .z { q: 1 }', 'a {\n  x: y;\n  > b {\n    c: d;\n  }\n}\n.z {\n  q: 1;\n}\n'],
    ['a { x: y ~ b { c: d } }', 'a {\n  x: y;\n  ~ b {\n    c: d;\n  }\n}\n']
  ])('jess: %s keeps the leading combinator', async (source, written) => {
    expect(await render('jess', source)).toBe(written);
  });

  it('jess: a glued `:` continues the run before a nested rule', async () => {
    const result = await new Compiler({}).renderToResult({ source: 'a { x: y\n b:hover { c: d } }', filePath: '/proj/delim-run.jess' }, {});
    expect(result.errors).not.toEqual([]);
  });

  /* The `~` value is then invalid punctuation (P48); the parse is what these pin. */
  it('scss: a delim-run value followed by a block is a nested property', async () => {
    const parsed = PLUGINS.scss.safeParse!('/proj/delim-run.scss', 'a { x: y\n ~ b { c: d } }');
    expect(parsed.errors).toEqual([]);
    expect(parsed.document!.rules[0]).toMatchObject({
      rules: [{ type: 'Declaration', name: 'x', value: { type: 'NestedPropertyBlock', base: [{ src: 'y' }, { type: 'Any', src: '~' }, { src: 'b' }] } }]
    });
    expect(await errorCodes('scss', 'y\n ~ b { c: d }')).toEqual([CODE]);
  });

  it.each(['scss', 'jess'] as const)('%s: a glued run before a rule keeps the rule', async (dialect) => {
    const parsed = PLUGINS[dialect].safeParse!(`/proj/delim-run.${dialect}`, '.k { x: a~b .n { y: 1 } }');
    expect(parsed.errors).toEqual([]);
    expect(parsed.document!.rules[0]).toMatchObject({
      rules: [
        { type: 'Declaration', name: 'x', value: [{ src: 'a' }, { type: 'Any', src: '~' }, { src: 'b' }] },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'y' }] }
      ]
    });
  });
});

/*
 * OPEN for the owner (ledger N18): SCSS reads `not` before a group as its
 * operator; a group holding a delim run is truthy.
 */
it.fails('scss: not() over a delim run is written as css writes it', async () => {
  expect(await value('scss', 'foo(not(a=b=c))')).toBe('foo(not(a=b=c))');
});

it.fails('scss: a map value keeps its delim run layout', async () => {
  expect(await render('scss', '$m: (a: b=c);\na { x: map-get($m, a); }')).toContain('x: b=c;');
});

/*
 * A glued `.` member form is plain dotted CSS in Less, not a Less form (Less
 * v5's own module access is `@`- or `#`-headed), so it is invalid punctuation
 * (owner 2026-10-16: *"color.mix() should error IMO because it's not valid in
 * any value I'm aware of"*, *"In CSS and Less if processed by Jess"*). It was
 * written evaluated (`ns.1`, `color.#800080`).
 */
it.each(['ns.$q', 'color.mix(red, blue)'])('less: a glued member form %s parses, then is invalid punctuation', async (authored) => {
  expect(await errorCodes('less', authored)).toEqual([CODE]);
});
