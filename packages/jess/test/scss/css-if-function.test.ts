import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * CSS `if()` (css-values-5 §8.3, ledger P38) in SCSS. Owner 2026-10-19: "in
 * .scss, in these cases, i think do what sass does, and parse to the equivalent
 * structure that would be intepreted the same way in .jess".
 *
 * Every expectation is Dart Sass 1.101.7's output (`sass --no-source-map`, the
 * `sass` devDependency). The inputs are sass-spec's (`spec/expressions/if/`) or
 * the shapes its README and the CSS spec use: a branch list whose conditions are
 * CSS tests (`media()`, `supports()`, `style()`, any other function) is written
 * out, a `sass()` condition is decided at compile time, and Sass's own
 * `if($condition, $if-true, $if-false)` still works, with a deprecation warning.
 */
const render = async (source: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> =>
  new Compiler({}).renderString(source, { extension });

const result = async (source: string, extension: '.scss' | '.jess' = '.scss') =>
  new Compiler({}).renderToResult({ source, filePath: `/proj/if${extension}` }, { suppressWarnings: true });

/** A CSS `if()` with no `sass()` condition is written as Dart Sass writes it. */
const written: ReadonlyArray<readonly [string, string, string]> = [
  ['media() branches', '.a { width: if(media(width < 600px): 1px; media(width < 900px): 2px; else: 3px); }', '.a {\n  width: if(media(width < 600px): 1px; media(width < 900px): 2px; else: 3px);\n}\n'],
  ['a media() range', '.a { x: if(media(width >= 600px): 1px; else: 2px); }', '.a {\n  x: if(media(width >= 600px): 1px; else: 2px);\n}\n'],
  ['a supports() condition', '.a { display: if(supports(display: grid): grid; else: block); }', '.a {\n  display: if(supports(display: grid): grid; else: block);\n}\n'],
  ['a style() condition', '.a { color: if(style(--theme: dark): white; else: black); }', '.a {\n  color: if(style(--theme: dark): white; else: black);\n}\n'],
  ['a supports(selector()) condition', '.a { color: if(supports(selector(:has(a))): red; else: blue); }', '.a {\n  color: if(supports(selector(:has(a))): red; else: blue);\n}\n'],
  ['tests joined by `and`', '.a { x: if(media(print) and supports(display: grid): a; else: b); }', '.a {\n  x: if(media(print) and supports(display: grid): a; else: b);\n}\n'],
  ['a negated test', '.a { x: if(not media(print): a; else: b); }', '.a {\n  x: if(not media(print): a; else: b);\n}\n'],
  ['a parenthesized test', '.a { x: if((media(print)): a; else: b); }', '.a {\n  x: if((media(print)): a; else: b);\n}\n'],
  ['branch values Sass computes', '$w: 10px; .a { x: if(media(print): $w * 2; else: 1px + 1px); }', '.a {\n  x: if(media(print): 20px; else: 2px);\n}\n'],
  ['a variable in a test, which is not substituted', '$w: 10px; .a { x: if(media(width >= $w): 1px; else: 2px); }', '.a {\n  x: if(media(width >= $w): 1px; else: 2px);\n}\n'],
  ['an interpolation in a test, which is', '$w: 10px; .a { x: if(media(width >= #{$w}): 1px; else: 2px); }', '.a {\n  x: if(media(width >= 10px): 1px; else: 2px);\n}\n'],
  ['a user function named media, which a test does not call', '@function media($x) { @return 99; } .a { x: if(media(print): 1px; else: 2px); y: media(print); }', '.a {\n  x: if(media(print): 1px; else: 2px);\n  y: 99;\n}\n'],
  ['an `else` alone', 'a {b: if(else: c)}', 'a {\n  b: c;\n}\n'],
  ['two `else`s', 'a {b: if(else: c; else: d)}', 'a {\n  b: c;\n}\n'],
  ['a trailing `;`', 'a {b: if(css(): c; else: d;)}', 'a {\n  b: if(css(): c; else: d);\n}\n'],
  ['padding', 'a {b: if( css() : c ; else : d )}', 'a {\n  b: if(css(): c; else: d);\n}\n']
];

/** A `sass()` condition is SassScript, decided at compile time, and the branches it decides are resolved. */
const resolved: ReadonlyArray<readonly [string, string, string]> = [
  ['sass() true', '.a { x: if(sass(1 < 2): yes; else: no); }', '.a {\n  x: yes;\n}\n'],
  ['sass() false', 'a {b: if(sass(false): c; else: d)}', 'a {\n  b: d;\n}\n'],
  ['sass() of a variable', '$a: true; b {c: if(sass($a): d; else: e)}', 'b {\n  c: d;\n}\n'],
  ['a theme flag', '$dark: false; .a { color: if(sass($dark): white; else: black); }', '.a {\n  color: black;\n}\n'],
  ['sass() false before a media() branch', '.a { x: if(sass(false): a; media(print): b; else: c); }', '.a {\n  x: if(media(print): b; else: c);\n}\n'],
  ['sass() true after a test', 'a {b: if(css(1): c; sass(true): d; else: e)}', 'a {\n  b: if(css(1): c; else: d; else: e);\n}\n'],
  ['sass() false with no other branch', 'a {b: if(sass(false): c)}', ''],
  ['not sass()', 'a {b: if(not sass(false): c; else: d)}', 'a {\n  b: c;\n}\n'],
  ['sass() and sass()', 'a {b: if(sass(true) and sass(false): c; else: d)}', 'a {\n  b: d;\n}\n'],
  ['sass() true and a test', 'a {b: if(sass(true) and css(): c; else: d)}', 'a {\n  b: if(css(): c; else: d);\n}\n'],
  ['sass() false and a test', 'a {b: if(sass(false) and css(): c; else: d)}', 'a {\n  b: d;\n}\n'],
  ['a test or sass() false', 'a {b: if(css() or sass(false): c; else: d)}', 'a {\n  b: if(css(): c; else: d);\n}\n'],
  ['a test or sass() true', 'a {b: if(css() or sass(true): c; else: d)}', 'a {\n  b: c;\n}\n'],
  ['tests around sass() true', 'a {b: if(css(1) and sass(true) and css(2): c; else: d)}', 'a {\n  b: if(css(1) and css(2): c; else: d);\n}\n'],
  ['a paren group that keeps its parens', 'a {b: if((sass(true) and css()): c)}', 'a {\n  b: if((css()): c);\n}\n'],
  ['a paren group left alone in the condition', '$a: true; .a { x: if(sass($a) and (media(print) or supports(a: b)): a; else: c); }', '.a {\n  x: if(media(print) or supports(a: b): a; else: c);\n}\n'],
  ['short circuit: `and`', 'a {b: if(sass(false) and sass($undefined): c)}', ''],
  ['short circuit: `or`', 'a {b: if(sass(true) or sass($undefined): c)}', 'a {\n  b: c;\n}\n'],
  ['short circuit: a later branch', 'a {b: if(sass(true): c; sass($undefined): d)}', 'a {\n  b: c;\n}\n'],
  ['short circuit: the value of a branch not taken', 'a {b: if(sass(false): $undefined; else: c)}', 'a {\n  b: c;\n}\n'],
  ['an if() in a branch value', '.a { x: if(sass(true): if(media(print): a; else: b); else: c); }', '.a {\n  x: if(media(print): a; else: b);\n}\n'],
  ['a comma list value', '.a { x: if(sass(true): a, b; else: c); }', '.a {\n  x: a, b;\n}\n']
];

/** Sass's `if($condition, $if-true, $if-false)`: deprecated in Dart Sass, and still evaluated. */
const legacy: ReadonlyArray<readonly [string, string, string]> = [
  ['a variable', '$c: true; .a { x: if($c, yes, no); }', '.a {\n  x: yes;\n}\n'],
  ['a comparison', '$i: 1; .a { x: if($i == 1, first, other); }', '.a {\n  x: first;\n}\n'],
  ['map-has-key()', '$m: (a: 1px); .a { x: if(map-has-key($m, a), map-get($m, a), 0); }', '.a {\n  x: 1px;\n}\n'],
  ['a media() call in Sass math', '.a { x: if(media(print) + 1, a, b); }', '.a {\n  x: a;\n}\n'],
  ['a style() call compared', '.a { x: if(style(a) == false, a, b); }', '.a {\n  x: b;\n}\n'],
  ['a sass() call', '.a { x: if(sass(true), a, b); }', '.a {\n  x: a;\n}\n']
];

describe('scss: CSS if()', () => {
  it.each(written)('writes %s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  it.each(resolved)('resolves %s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  it('reports no diagnostic for a CSS if()', async () => {
    const compiled = await result('.a { x: if(media(width >= 600px): 1px; else: 2px); y: if(sass(true): a; else: b); }');
    expect([...compiled.errors, ...compiled.warnings]).toEqual([]);
  });
});

describe('scss: Sass if()', () => {
  it.each(legacy)('evaluates %s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  it('warns that it is deprecated, at the call, and suggests the CSS form', async () => {
    const compiled = await result('$c: true;\n.a {\n  x: if($c, yes, no);\n}\n');
    expect(compiled.errors).toEqual([]);
    expect(compiled.warnings.map(warning => [warning.code, warning.line, warning.column])).toEqual([['parse/deprecated-if-function', 3, 6]]);
    expect(compiled.warnings[0]?.fix).toContain('if(sass($condition): $if-true; else: $if-false)');
  });

  /*
   * Dart Sass fails the compile here: `media($x: print)` is a plain CSS function
   * given a keyword argument ("Plain CSS functions don't support keyword
   * arguments"). Jess writes a plain CSS function's keyword argument as authored
   * in every SCSS value (`foo($x: 1)` too), so the condition is a truthy call.
   * Not an `if()` question; left for the owner.
   */
  it.fails('rejects a keyword argument to a plain CSS function in its condition', async () => {
    const compiled = await result('$x: 1; .a { x: if(media($x: print), a, b); }');
    expect(compiled.errors.map(error => error.message)).toEqual(['Plain CSS functions don\'t support keyword arguments.']);
  });
});

/*
 * `.scss → .css` == `.scss → .jess → .css`: a CSS `if()` and Sass's `if()` lower
 * to `.jess`'s CSS `if()`, whose compile-time condition is `$( … )`.
 */
describe('scss → jess: if() lowers to `.jess` if()', () => {
  it.each([...written, ...resolved, ...legacy])('%s', async (_name, source) => {
    const jess = emitJess(parseScss(source));
    await expect(render(jess, '.jess')).resolves.toBe(await render(source));
  });

  it('spells a sass() condition `$( … )` and Sass if() as the CSS form', () => {
    expect(emitJess(parseScss('$a: true; .a { x: if(sass($a): b; media(print): c; else: d); y: if($a, e, f); }')))
      .toBe('$a: true;\n.a {\n  x: if($($a): b; media(print): c; else: d);\n  y: if($($a): e; else: f);\n}\n');
  });
});

/*
 * `.jess` parses CSS `if()` to the structure SCSS builds; its compile-time
 * condition is `$( … )`, `.jess`'s computation boundary. `$name:` in a call is
 * a named argument, never a condition.
 */
describe('jess: CSS if()', () => {
  it.each(written.filter(([name]) => !name.includes('interpolation') && !name.includes('user function') && !name.includes('Sass computes')))('writes %s', async (_name, source, expected) => {
    await expect(render(source.replaceAll(/\$w: 10px; /g, ''), '.jess')).resolves.toBe(expected);
  });

  it.each([
    ['a condition', '.a { x: if($(1 < 2): yes; else: no); }', '.a {\n  x: yes;\n}\n'],
    ['a variable', '$dark: false;\n.a { color: if($($dark): white; else: black); }', '.a {\n  color: black;\n}\n'],
    ['a condition before a media() branch', '.a { x: if($(false): a; media(print): b; else: c); }', '.a {\n  x: if(media(print): b; else: c);\n}\n'],
    ['a condition and a test', '$a: true;\n.a { x: if($($a) and media(print): a; else: b); }', '.a {\n  x: if(media(print): a; else: b);\n}\n'],
    ['a test in a value', '$w: 2px;\n.a { x: if(media(print): $($w * 2); else: 1px); }', '.a {\n  x: if(media(print): 4px; else: 1px);\n}\n']
  ])('resolves %s', async (_name, source, expected) => {
    await expect(render(source, '.jess')).resolves.toBe(expected);
  });
});
