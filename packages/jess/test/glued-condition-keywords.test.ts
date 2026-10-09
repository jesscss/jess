import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * A condition keyword glued to its `(` (`and(`, `or(`, `not(`) is one function
 * token (css-syntax-3 §4.3.4), so in a CSS condition it is a `<general-enclosed>`
 * function, never the keyword: the condition never matches (media-queries-4
 * §3.2). Inserting a space would change what the author's query means, so it is
 * written as authored, with one `css/glued-condition-keyword` warning where it
 * is written (owner ruling 2026-10-09, ledger N17). Conditions the compiler
 * evaluates — Less guards, `if()`, Sass `@if` — are never written, keep reading
 * `and(` as the keyword and a group, and do not warn.
 */
type Dialect = 'less' | 'scss' | 'jess';
const DIALECTS: readonly Dialect[] = ['less', 'scss', 'jess'];

async function render(dialect: Dialect, source: string) {
  const result = await new Compiler().renderToResult({ source, filePath: `/proj/glued.${dialect}` }, {});
  expect(result.errors).toEqual([]);
  return { css: String(result.css), warnings: result.warnings };
}

async function prelude(dialect: Dialect, source: string) {
  const { css, warnings } = await render(dialect, source.startsWith('@page') ? `${source} { size: a4 }` : `${source} { a { b: c } }`);
  return {
    prelude: css.slice(0, css.indexOf('{')).trimEnd(),
    warnings: warnings.map(warning => [warning.code, warning.line, warning.column])
  };
}

/* The authored prelude, and the 1-based column of the glued keyword it warns at. */
const GLUED: ReadonlyArray<readonly [prelude: string, column: number]> = [
  ['@media screen and(max-width: 1280px)', 15],
  ['@media (min-width: 1px) or(max-width: 2px)', 25],
  ['@media not(color)', 8],
  ['@media (not(hover))', 9],
  ['@media only screen AND(color)', 20],
  ['@container (min-width: 1px) and(max-width: 2px)', 29],
  ['@container card (min-width: 1px) or(orientation: portrait)', 34],
  ['@container not(width > 1px)', 12],
  ['@container ((a) and(b))', 17],
  ['@supports not(display: grid)', 11],
  ['@supports (display: grid) and(gap: 1px)', 27],
  ['@supports (display: grid) or(display: flex)', 27],
  ['@supports ((display: grid) and(gap: 1px))', 28]
];

describe('a glued and( / or( / not( in a CSS condition', () => {
  for (const dialect of DIALECTS) {
    it.each(GLUED)(`${dialect}: writes %s as authored and warns once at its column`, async (source, column) => {
      expect(await prelude(dialect, source)).toEqual({
        prelude: source,
        warnings: [['css/glued-condition-keyword', 1, column]]
      });
    });
  }

  it('says which keyword was meant', async () => {
    const { warnings } = await render('less', '@supports not(display: grid) { a { b: c } }');
    expect(warnings.map(warning => warning.message)).toEqual([
      '`not(` is read by CSS as a function, so this condition never matches — write `not (` if you meant the keyword'
    ]);
  });

  it('warns once for an interpolated glued keyword and writes the substitution as authored', async () => {
    expect(await prelude('less', '@w: max-width;\n@media screen and(@{w}: 1px)')).toEqual({
      prelude: '@media screen and(max-width: 1px)',
      warnings: [['css/glued-condition-keyword', 2, 15]]
    });
  });
});

describe('the spaced keyword and other condition functions', () => {
  for (const dialect of DIALECTS) {
    it.each([
      '@media screen and (max-width: 1280px)',
      '@media not all and (color)',
      '@container (min-width: 1px) and (max-width: 2px)',
      '@container not (width > 1px)',
      '@container size(min-width: 60ch)',
      '@container size (min-width: 60ch)',
      '@supports not (display: grid)',
      '@supports (display: grid) and (gap: 1px)',
      '@supports selector(a > b)'
    ])(`${dialect}: writes %s as authored without a warning`, async (source) => {
      expect(await prelude(dialect, source)).toEqual({ prelude: source, warnings: [] });
    });
  }
});

describe('compiler-evaluated conditions keep reading and( / not( as the keyword', () => {
  it.each([
    ['less', '@a: true; @b: true; .m() when (@a) and(@b) { x: y } .z { .m(); }', '.z {\n  x: y;\n}\n'],
    ['less', '@a: false; .m() when not(@a) { x: y } .z { .m(); }', '.z {\n  x: y;\n}\n'],
    ['less', '@a: false; @b: true; .m() when (@a) or(@b) { x: y } .z { .m(); }', '.z {\n  x: y;\n}\n'],
    ['less', '@a: true; .z when (@a) and(@a) { x: y }', '.z {\n  x: y;\n}\n'],
    ['less', '@a: 1; .z { x: if((@a = 1) and(@a > 0), yes, no); }', '.z {\n  x: yes;\n}\n'],
    ['less', '@a: 1; .z { x: if(not(@a = 2), yes, no); }', '.z {\n  x: yes;\n}\n'],
    ['less', '@a: 1; .z { x: boolean((@a = 1) and(true)); }', '.z {\n  x: true;\n}\n'],
    ['scss', '$a: true; .z { @if $a and($a) { x: y } }', '.z {\n  x: y;\n}\n'],
    ['scss', '$a: false; .z { @if not($a) { x: y } }', '.z {\n  x: y;\n}\n'],
    ['scss', '$a: false; .z { x: not($a); }', '.z {\n  x: true;\n}\n'],
    ['jess', '$a: true; $b: false; $if (($a = true) and not($b)) { .z { x: y; } }', '.z {\n  x: y;\n}\n'],
    ['jess', 'm($v) when (($v = true) and not(false)) { x: y; } .z { $ > m(true); }', '.z {\n  x: y;\n}\n']
  ] as const)('%s: %s', async (dialect, source, css) => {
    expect(await render(dialect, source)).toEqual({ css, warnings: [] });
  });
});
