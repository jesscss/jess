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

  /*
   * KNOWN GAP (not the grammar): a run bound to a mixin parameter, or a
   * variable holding one substituted into a call argument, loses its authored
   * layout in evaluation and is written spaced (`a = b`); the same run written
   * in place keeps it. Turns red when fixed.
   */
  it.fails.each([
    ['@mixin m($a) { x: $a; }\na { @include m(a=b); }', 'x: a=b;'],
    ['$v: a=b;\na { y: foo($v); }', 'y: foo(a=b);']
  ])('scss: a substituted run keeps its layout (%s)', async (source, written) => {
    expect(await render('scss', source)).toContain(written);
  });
});
