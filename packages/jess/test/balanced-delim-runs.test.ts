import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Valid, balanced CSS parses in every dialect (owner 2026-10-16: *"we should be
 * more permissive around valid / balanced syntax"*; ledger N18, P45). A CSS
 * delim between component values (`=`, `~`, `:`, `.`, `<`) is a component of
 * the run (css-syntax-3 §5.4.9), written as authored, glued or padded — unless
 * the dialect gives it a meaning in that position:
 *
 * - Less reads `=`, `<` and `>` in a call argument as its comparison (V11), so
 *   a single comparison evaluates (`gradient(startColorstr='#000')` →
 *   `gradient(false)`, as `alpha(opacity=50)` → `alpha(false)`).
 * - SCSS reads `==` in a call argument as its comparison.
 *
 * Where a dialect's meaning is not settled by a ruling — a chained comparison
 * (`a=b=c`, `a = b < c`), a spelling the dialect has no operator for (`==` in
 * Less), or a delim in a Less declaration value — the run is written as
 * authored.
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

const PROGID = 'progid:DXImageTransform.Microsoft.gradient(startColorstr=\'#000\', endColorstr=\'#fff\')';

const DECLARATION_RUNS = [
  'a=b',
  'a = b',
  'a~b',
  'a ~ b',
  'a=b c~d',
  'a=b, c~d',
  'progid:DX.Microsoft.Blur(pixelradius=2)',
  PROGID
];

const ARGUMENT_RUNS = [
  'foo(a=b=c)',
  'foo(a = b < c)',
  'foo(a~b)'
];

describe('a delim between declaration components', () => {
  for (const dialect of ['css', 'scss', 'jess'] as const) {
    it.each(DECLARATION_RUNS)(`${dialect}: writes %s as authored`, async (authored) => {
      expect(await value(dialect, authored)).toBe(authored);
    });
  }

  it.each(DECLARATION_RUNS.slice(0, 6))('less: writes %s as authored', async (authored) => {
    expect(await value('less', authored)).toBe(authored);
  });

  it('less: a progid filter\'s call compares its `=` arguments, as `alpha()` does', async () => {
    expect(await value('less', PROGID)).toBe('progid:DXImageTransform.Microsoft.gradient(false, false)');
    expect(await value('less', 'progid:DX.Microsoft.Blur(pixelradius=2)')).toBe('progid:DX.Microsoft.Blur(false)');
  });

  it.each(['css', 'less', 'scss', 'jess'] as const)('%s: a progid filter as the filter property', async (dialect) => {
    const css = await render(dialect, `a { filter: ${PROGID}; }`);
    expect(css).toContain('filter: progid:DXImageTransform.Microsoft.');
  });
});

describe('a delim run in a call argument', () => {
  for (const dialect of ['css', 'less', 'scss', 'jess'] as const) {
    it.each(ARGUMENT_RUNS)(`${dialect}: writes %s as authored`, async (authored) => {
      expect(await value(dialect, authored)).toBe(authored);
    });
  }

  it.each(['css', 'less', 'jess'] as const)('%s: writes foo(a==b) as authored', async (dialect) => {
    expect(await value(dialect, 'foo(a==b)')).toBe('foo(a==b)');
  });

  it('scss: `==` in an argument is the comparison', async () => {
    expect(await value('scss', 'foo(a==b)')).toBe('foo(false)');
  });

  it('less: a single comparison still evaluates', async () => {
    expect(await value('less', 'foo(a=b)')).toBe('foo(false)');
    expect(await value('less', 'foo(1 < 2)')).toBe('foo(true)');
  });

  it('scss: an `@include` argument with an `=` run evaluates', async () => {
    expect(await render('scss', '@mixin m($a) { x: $a; }\na { @include m(a=b); }')).toMatch(/x: a ?= ?b;/);
  });

  it('scss: a line comment beside an `@include` keyword argument still parses', async () => {
    expect(await render('scss', '@mixin m($a) { x: $a; }\na { @include m($a: // c\n 1); }')).toContain('x: 1;');
  });
});

describe('compressed output keeps a glued delim glued and a padded one padded', () => {
  it.each(['css', 'less', 'scss', 'jess'] as const)('%s', async (dialect) => {
    const result = await new Compiler({ output: { compress: true } }).renderToResult(
      { source: 'a { x: a=b; y: a ~ b; z: a=b, c ~ d; }', filePath: `/proj/delim-run.${dialect}` },
      {}
    );
    expect(result.errors).toEqual([]);
    expect(String(result.css)).toBe('a{x:a=b;y:a ~ b;z:a=b,c ~ d}');
  });
});

/*
 * KNOWN GAP (evaluation, not the grammar; ledger N18): a run that reaches the
 * writer through a variable, a mixin or function parameter, or an
 * interpolation loses its authored layout and is written spaced (`a = b`); the
 * same run written in place keeps it. Each turns red when fixed.
 */
describe('a substituted delim run keeps its layout', () => {
  it.fails.each([
    ['scss', '@mixin m($a) { x: $a; }\na { @include m(a=b); }', 'x: a=b;'],
    ['scss', '$v: a=b;\na { y: foo($v); }', 'y: foo(a=b);'],
    ['scss', '@function f($a) { @return $a; }\na { x: f(a=b); }', 'x: a=b;'],
    ['scss', '$v: a=b;\na { s: "#{$v}"; }', 's: "a=b";'],
    ['scss', '$v: a=b;\na { #{$v}: 1; }', 'a=b: 1;'],
    ['less', '.m(@a) { x: @a; }\na { .m(a=b); }', 'x: a=b;'],
    ['less', '@v: a=b;\na { y: foo(@v); }', 'y: foo(a=b);'],
    ['less', '@v: a=b;\na { s: ~"@{v}"; }', 's: a=b;']
  ] as const)('%s: %s', async (dialect, source, written) => {
    expect(await render(dialect, source)).toContain(written);
  });
});

/*
 * A delim run now continues a declaration value, so where the value ends before
 * a nested rule moves (ledger N18). `.jess` follows css and Less: an
 * unterminated declaration before a nested qualified rule is not read as two
 * statements. SCSS reads a value followed by a block as a nested property.
 */
describe('a delim run before a nested rule', () => {
  it.each([
    'a { x: y\n > b { c: d } }',
    'a { x: y\n ~ b { c: d } }',
    'a { x: y\n b:hover { c: d } }'
  ])('jess: %s does not parse', async (source) => {
    const result = await new Compiler({}).renderToResult({ source, filePath: '/proj/delim-run.jess' }, {});
    expect(result.errors).not.toEqual([]);
  });

  it('scss: a delim-run value followed by a block is a nested property', async () => {
    expect(await render('scss', 'a { x: y\n ~ b { c: d } }')).toBe('a {\n  x: y\n    ~ b;\n  x-c: d;\n}\n');
  });

  it.each(['scss', 'jess'] as const)('%s: a terminated-by-rule glued run keeps the rule', async (dialect) => {
    expect(await render(dialect, '.k { x: a~b .n { y: 1 } }')).toBe('.k {\n  x: a~b;\n  .n {\n    y: 1;\n  }\n}\n');
  });
});

/*
 * OPEN for the owner (ledger N18): Less reads each component of a glued-`.` run
 * as it reads any value, so a Less function after the `.` evaluates
 * (`color.mix(red, blue)` → `color.#800080`). Turns red if the owner rules the
 * member form is written as authored.
 */
it.fails('less: a glued member form is written as authored', async () => {
  expect(await value('less', 'color.mix(red, blue)')).toBe('color.mix(red, blue)');
});
