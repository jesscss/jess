import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * `alpha(opacity=50)` is well-formed CSS: a function holding an ident, a `=`
 * delim and a number, as balanced component values (css-syntax-3 §5.4.9).
 * Owner 2026-10-16: *"we should be more permissive around valid / balanced
 * syntax"*, and in `.jess` *"it would be preserved as-is"*. So `.css`, `.scss`
 * and `.jess` parse it and write it exactly as authored, glued or padded.
 * dart-sass reads the same argument as its Microsoft `name=value` form and also
 * writes it out (it drops the padding: `c = 2` becomes `c=2`). Less reads `=`
 * as its ordinary comparison (owner-ruled), so `alpha(opacity=50)` is
 * `alpha(false)` there.
 *
 * A query range comparison (`@media (width=600px)`) is a real comparison in
 * every dialect and keeps its spaced form (owner 2026-10-16: *"we do that in
 * media / container queries"*).
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';

async function render(dialect: Dialect, source: string, compress = false): Promise<string> {
  const result = await new Compiler({ output: { compress } }).renderToResult({ source, filePath: `/proj/name-value.${dialect}` }, {});
  expect(result.errors).toEqual([]);
  return String(result.css);
}

async function value(dialect: Dialect, authored: string): Promise<string> {
  const css = await render(dialect, `a { x: ${authored}; }`);
  return css.slice(css.indexOf('x: ') + 3, css.lastIndexOf(';'));
}

const AS_WRITTEN = [
  'alpha(opacity=50)',
  'foo(b=1, c = 2)',
  'foo(a=b=c)',
  'foo(bar(x=1))',
  'foo(a /* c */ = b)',
  'foo(a b=c d)',
  'foo("a"=b)',
  'foo("=")',
  'foo(x, "=")',
  'gradient(startColorstr=\'#000\', endColorstr=\'#fff\')'
];

describe('a `=` delim in a function argument', () => {
  for (const dialect of ['css', 'scss', 'jess'] as const) {
    it.each(AS_WRITTEN)(`${dialect}: writes %s as authored`, async (authored) => {
      expect(await value(dialect, authored)).toBe(authored);
    });
  }

  it('css: writes a progid filter as authored', async () => {
    const authored = 'progid:DXImageTransform.Microsoft.gradient(startColorstr=\'#000\', endColorstr=\'#fff\')';
    expect(await value('css', authored)).toBe(authored);
  });

  for (const dialect of ['css', 'scss', 'jess'] as const) {
    it(`${dialect}: keeps a glued \`=\` glued in compressed output`, async () => {
      expect(await render(dialect, 'a { x: alpha(opacity=50); y: foo(b=1, c = 2); }', true)).toBe('a{x:alpha(opacity=50);y:foo(b=1,c = 2)}');
    });
  }

  it('scss: a keyword argument whose value is a string `=` stays a keyword argument', async () => {
    expect(await render('scss', '@function f($a) { @return $a; }\na { x: f($a: "="); }')).toContain('x: "=";');
  });

  it('scss: evaluates a variable beside the `=`', async () => {
    expect(await render('scss', '$o: 50;\na { x: alpha(opacity=$o); }')).toContain('x: alpha(opacity=50);');
  });

  it('jess: evaluates a variable beside the `=`', async () => {
    expect(await render('jess', '$o: 50;\na { x: alpha(opacity=$o); }')).toContain('x: alpha(opacity=50);');
  });
});

describe('real comparisons keep their meaning', () => {
  it.each([
    ['alpha(opacity=50)', 'alpha(false)'],
    ['foo(b=1, c = 2)', 'foo(false, false)'],
    ['foo(bar(x=1))', 'foo(bar(false))']
  ])('less: %s compares, giving %s', async (authored, written) => {
    expect(await value('less', authored)).toBe(written);
  });

  it('less: `=` is the comparison', async () => {
    expect(await value('less', 'boolean(3 = 4)')).toBe('false');
  });

  it('scss: `==` is the comparison', async () => {
    expect(await value('scss', 'foo(3 == 4)')).toBe('foo(false)');
  });

  it('jess: a comparison is read inside `$( … )`', async () => {
    expect(await value('jess', 'foo($(3 == 4))')).toBe('foo(false)');
  });
});

describe('a query range comparison stays spaced', () => {
  for (const dialect of ['css', 'less', 'scss', 'jess'] as const) {
    it.each([
      ['@media (width=600px)', '@media (width = 600px)'],
      ['@media (400px<=width<=700px)', '@media (400px <= width <= 700px)'],
      ['@container (width=600px)', '@container (width = 600px)']
    ])(`${dialect}: %s`, async (authored, written) => {
      const css = await render(dialect, `${authored} { a { b: c } }`);
      expect(css.slice(0, css.indexOf('{')).trimEnd()).toBe(written);
    });
  }
});

/**
 * Ledger F1: `/`, `+`, `-` and `*` are separators and are written with one
 * space on each side regardless of source. A glued `+`, `-`, `*` or `/` delim
 * between components in a `.css` value (outside any math function) is that
 * separator; the other glued delims (`=`, `~`, `:`, `.`) stay as authored.
 */
describe('css: an operator delim between components is spaced (F1)', () => {
  it.each([
    ['a+b', 'a + b'],
    ['1px*2px', '1px * 2px'],
    ['a/b', 'a / b'],
    ['a*b*c', 'a * b * c'],
    ['(a)-(b)', '(a) - (b)'],
    ['foo(a+b)', 'foo(a + b)'],
    ['a +b', 'a + b'],
    ['a+ b', 'a + b']
  ])('writes %s as %s', async (authored, written) => {
    expect(await value('css', authored)).toBe(written);
  });

  it.each([
    'alpha(opacity=50)',
    'a~b',
    'foo(:x)',
    'progid:DX.Microsoft.Blur(pixelradius=2)',
    'calc(1px + 2px)'
  ])('keeps %s as authored', async (authored) => {
    expect(await value('css', authored)).toBe(authored);
  });

  it('leaves An+B microsyntax glued', async () => {
    expect(await render('css', 'a:nth-child(2n+1) { b: c; }')).toContain(':nth-child(2n+1)');
  });

  it('leaves a custom property verbatim', async () => {
    expect(await render('css', 'a { --x: a+b; }')).toContain('--x: a+b;');
  });

  it('compressed output keeps the spaced separator and the glued delims', async () => {
    expect(await render('css', 'a { x: a+b; y: alpha(opacity=50); z: a~b; }', true)).toBe('a{x:a + b;y:alpha(opacity=50);z:a~b}');
  });
});
