import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * A CSS `if()` condition (css-values-5 §8.3: `media()`, `supports()` and
 * `style()` tests joined by `not`, `and`, `or` and parens, or `else`) is the
 * browser's, in every dialect (ledger P38). Owner 2026-10-20: ".css in general
 * is just .css... the only reason Jess would parse / manage it is usually for
 * diagnostics", and "oh weird... yeah in CSS it comes out as written": a plain
 * CSS `if()` comes out of `.less`, `.scss` and `.jess` the way `.css` writes it.
 *
 * Variables in a `media()` or `supports()` test are in a value position, so
 * both spellings substitute. Owner 2026-10-20: "we resolved in Less v5 that
 * it's in a 'value position' in the at-rule prelude, so intuitively it can be
 * $bp or ${bp} (or in Less's case @bp or @{bp})". A `style()` test's value is a
 * custom property's: "yep, that is correct, it's a custom prop declaration", so
 * only interpolation substitutes there.
 */
type Extension = '.css' | '.less' | '.scss' | '.jess';
const DIALECTS: readonly Extension[] = ['.css', '.less', '.scss', '.jess'];

const render = async (source: string, extension: Extension, compress = false): Promise<string> =>
  new Compiler(compress ? { output: { compress } } : {}).renderString(source, { extension });

/** Plain CSS `if()`s, each written by `.css` as below. */
const plainCss: ReadonlyArray<readonly [string, string, string]> = [
  [
    'tests grouped and joined by `and` and `or`',
    '.a { color: if((media(print) and supports(color: lch(0% 0 0))) or style(--scheme: dark): black; else: white); }',
    '.a {\n  color: if((media(print) and supports(color: lch(0% 0 0))) or style(--scheme: dark): black; else: white);\n}\n'
  ],
  [
    'an upper-case `NOT`',
    '.a { color: if(NOT media(print): blue; else: black); }',
    '.a {\n  color: if(NOT media(print): blue; else: black);\n}\n'
  ],
  [
    'a negated group',
    '.a { color: if(not (media(print) and supports(display: grid)): blue; else: black); }',
    '.a {\n  color: if(not (media(print) and supports(display: grid)): blue; else: black);\n}\n'
  ],
  [
    'a grouped test alone',
    '.a { color: if((media(print)): black; else: white); }',
    '.a {\n  color: if((media(print)): black; else: white);\n}\n'
  ],
  [
    'padding inside the tests',
    '.layout { display: if(media( width >= 600px ) and supports(display:grid): grid; else: block); }',
    '.layout {\n  display: if(media(width >= 600px) and supports(display: grid): grid; else: block);\n}\n'
  ],
  [
    'a padded style() test',
    '.card { background: if(style( --theme : dark): #222; else: white); }',
    '.card {\n  background: if(style(--theme: dark): #222; else: white);\n}\n'
  ],
  [
    'an upper-case `IF`',
    '.a { color: IF(media(print): black; else: white); }',
    '.a {\n  color: IF(media(print): black; else: white);\n}\n'
  ],
  [
    'an `else` branch with no value',
    '.a { color: if(media(print): black; else:); }',
    '.a {\n  color: if(media(print): black; else:);\n}\n'
  ]
];

describe('a plain CSS if() is written as `.css` writes it, in every dialect', () => {
  it.each(plainCss)('%s', async (_name, source, expected) => {
    for (const compress of [false, true]) {
      const outputs = await Promise.all(DIALECTS.map(extension => render(source, extension, compress)));
      expect(outputs).toEqual(DIALECTS.map(() => outputs[0]));
      if (!compress) {
        expect(outputs[0]).toBe(expected);
      }
    }
  });

  /* sass-spec `spec/expressions/if`: a condition whose `and` sits beside other juxtaposed values (css-values-5 gives it no meaning). */
  it('keeps every operand of a juxtaposed condition', async () => {
    const source = 'a {b: if(css(1) and css(2) var(--and) css(3): c)}';
    const outputs = await Promise.all((['.css', '.scss', '.jess'] as const).map(extension => render(source, extension)));
    expect(outputs).toEqual(outputs.map(() => 'a {\n  b: if(css(1) and css(2) var(--and) css(3): c);\n}\n'));
  });

  /*
   * Less reads a condition as a CSS one only when it is built of `media()`,
   * `supports()` and `style()` tests; `css()` is no test, so Less evaluates
   * this condition as its own (`if(false: c)`). No ruling yet says whether a
   * branch condition is ever Less's.
   */
  it.fails('less: keeps every operand of a juxtaposed condition', async () => {
    await expect(render('a {b: if(css(1) and css(2) var(--and) css(3): c)}', '.less'))
      .resolves.toBe('a {\n  b: if(css(1) and css(2) var(--and) css(3): c);\n}\n');
  });
});

/** An upper-case `AND` / `OR` between tests: a CSS keyword is any case (ledger J20), so it is written as authored. */
const keywordCase: ReadonlyArray<readonly [string, string, string]> = [
  [
    'AND',
    '.layout { display: if(media(width >= 600px) AND supports(display: grid): grid; else: block); }',
    '.layout {\n  display: if(media(width >= 600px) AND supports(display: grid): grid; else: block);\n}\n'
  ],
  [
    'OR',
    '.a { color: if(media(print) OR style(--scheme: dark): black; else: white); }',
    '.a {\n  color: if(media(print) OR style(--scheme: dark): black; else: white);\n}\n'
  ]
];

describe('an upper-case keyword between tests', () => {
  it.each(keywordCase)('%s is written as authored in css, less and jess', async (_name, source, expected) => {
    const outputs = await Promise.all((['.css', '.less', '.jess'] as const).map(extension => render(source, extension)));
    expect(outputs).toEqual(outputs.map(() => expected));
  });

  /*
   * SCSS reads the condition as a Sass expression, whose `and` / `or` operation
   * keeps no authored spelling, so it writes `and` / `or`. Keeping it needs the
   * spelling on the operation or a CSS-condition production of its own.
   */
  it.fails.each(keywordCase)('%s is written as authored in scss', async (_name, source, expected) => {
    await expect(render(source, '.scss')).resolves.toBe(expected);
  });
});

/** A variable in a `media()` or `supports()` test substitutes, in both of its dialect's spellings. */
const variables: ReadonlyArray<readonly [Extension, string]> = [
  ['.less', '@bp: 600px;\n@d: grid;\n.a { width: if(media(width >= @bp): 50%; else: 100%); display: if(supports(display: @d): @d; else: block); }'],
  ['.less', '@bp: 600px;\n@d: grid;\n.a { width: if(media(width >= @{bp}): 50%; else: 100%); display: if(supports(display: @{d}): @d; else: block); }'],
  ['.scss', '$bp: 600px;\n$d: grid;\n.a { width: if(media(width >= $bp): 50%; else: 100%); display: if(supports(display: $d): $d; else: block); }'],
  ['.scss', '$bp: 600px;\n$d: grid;\n.a { width: if(media(width >= #{$bp}): 50%; else: 100%); display: if(supports(display: #{$d}): $d; else: block); }'],
  ['.jess', '$bp: 600px;\n$d: grid;\n.a { width: if(media(width >= $bp): 50%; else: 100%); display: if(supports(display: $d): $d; else: block); }'],
  ['.jess', '$bp: 600px;\n$d: grid;\n.a { width: if(media(width >= ${bp}): 50%; else: 100%); display: if(supports(display: ${d}): $d; else: block); }']
];

/* A media query's own groups are the same value position. */
const groupedVariables: ReadonlyArray<readonly [Extension, string]> = [
  ['.less', '@sm: 600px;\n@md: 900px;\n.a { width: if(media((min-width: @sm) and (max-width: @{md})): 50%; else: 100%); }'],
  ['.scss', '$sm: 600px;\n$md: 900px;\n.a { width: if(media((min-width: $sm) and (max-width: #{$md})): 50%; else: 100%); }'],
  ['.jess', '$sm: 600px;\n$md: 900px;\n.a { width: if(media((min-width: $sm) and (max-width: ${md})): 50%; else: 100%); }']
];

describe('variables in media() and supports() tests', () => {
  it.each(groupedVariables.filter(([extension]) => extension !== '.less'))('%s in a group %s', async (extension, source) => {
    await expect(render(source, extension))
      .resolves.toBe('.a {\n  width: if(media((min-width: 600px) and (max-width: 900px)): 50%; else: 100%);\n}\n');
  });

  /* Less writes a media test's `and`-joined groups without their parens (`media(min-width: 600px and max-width: 900px)`), with or without a variable. */
  it.fails.each(groupedVariables.filter(([extension]) => extension === '.less'))('%s in a group %s', async (extension, source) => {
    await expect(render(source, extension))
      .resolves.toBe('.a {\n  width: if(media((min-width: 600px) and (max-width: 900px)): 50%; else: 100%);\n}\n');
  });

  it.each(variables)('%s %s', async (extension, source) => {
    await expect(render(source, extension))
      .resolves.toBe('.a {\n  width: if(media(width >= 600px): 50%; else: 100%);\n  display: if(supports(display: grid): grid; else: block);\n}\n');
  });
});

/** A `style()` test's value is a custom property's: interpolation substitutes, a bare variable is text. */
const styleValues: ReadonlyArray<readonly [Extension, string, string]> = [
  ['.less', '@t: dark;\n.card { background: if(style(--theme: @{t}): #222; else: white); }', 'style(--theme: dark)'],
  ['.less', '@t: dark;\n.card { background: if(style(--theme: @t): #222; else: white); }', 'style(--theme: @t)'],
  ['.scss', '$t: dark;\n.card { background: if(style(--theme: #{$t}): #222; else: white); }', 'style(--theme: dark)'],
  ['.scss', '$t: dark;\n.card { background: if(style(--theme: $t): #222; else: white); }', 'style(--theme: $t)'],
  ['.jess', '$t: dark;\n.card { background: if(style(--theme: ${t}): #222; else: white); }', 'style(--theme: dark)'],
  ['.jess', '$t: dark;\n.card { background: if(style(--theme: $t): #222; else: white); }', 'style(--theme: $t)']
];

describe('style() tests', () => {
  it.each(styleValues)('%s %s', async (extension, source, test) => {
    await expect(render(source, extension))
      .resolves.toBe(`.card {\n  background: if(${test}: #222; else: white);\n}\n`);
  });
});
