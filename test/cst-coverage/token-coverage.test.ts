import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssCst } from '../../packages/css-parser/src/cst-css.js';
import { parseLessCst } from '../../packages/less-parser/src/cst.js';
import { parseScssCst } from '../../packages/scss-parser/src/cst.js';
import { parseJessCst } from '../../packages/jess-parser/src/cst.js';
import {
  checkSource,
  formatViolations,
  TRIVIA_ALLOWANCE,
  type CorpusSource,
  type CstParseResult,
  type Dialect,
  type Violation
} from './token-coverage-probe.js';

/**
 * CST token-coverage invariant, all four dialects.
 *
 * ASSERTION: concatenating a parse's CST leaves in source order reconstructs the
 * source. THE ONE ALLOWANCE: spans that are entirely TRIVIA — whitespace and
 * `/* … *\/` block comments in every dialect, plus `// …` line comments in Less /
 * SCSS / Jess. Trivia is skipped between terms and recorded on the trivia log, so
 * it is deliberately not a leaf; every other byte must be covered by exactly one
 * leaf whose text equals the source over its span.
 *
 * This is a property of a SINGLE parse: no baseline version, no second parser, no
 * recorded snapshot. That is what makes it stronger than a differential — it fails
 * at the commit that introduces a hole. It caught, and now pins, a class of defect
 * that output-shape and byte-identity tests are blind to: a production that
 * CONSUMES its input without emitting a leaf over it. Such a span reads as ABSENT
 * (not merely unstructured) to every position-dependent consumer — the language
 * service, error ranges, incremental reparse.
 *
 * Regression origin: SCSS's strict at-rule prelude used a `balanced()` text
 * scanner in a CST-visible position. It emitted leaves for its own delimiters and
 * interior runs but nothing for a NESTED group, so `@media (not (a))` /
 * `@media ((a) and (b))` left the inner `(…)` covered by no leaf. In the same pass,
 * SCSS's `!important` referenced the recognition-only `CssAstSyntaxImportant`
 * rule, which `compose()` links NON-capturing, so the keyword was consumed with no
 * leaf either.
 */

const s = (label: string, text: string): CorpusSource => ({ label, text });

// test/cst-coverage -> repo root is two levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readSource = (label: string, rel: string): CorpusSource => ({ label, text: readFileSync(resolve(repoRoot, rel), 'utf8') });

/**
 * Valid CSS is valid in all four dialects, so this corpus runs through every one —
 * a hole in a shared production is then reported four times, and a hole in one
 * dialect's OVERRIDE of a shared production is isolated to that dialect.
 */
const sharedCssSources: CorpusSource[] = [
  s('ruleset', 'a { color: red }'),
  s('important', 'a { b: c !important }'),
  s('important-spaced', 'a { b: c ! important ; }'),
  s('multi-selector', 'a, .b > .c ~ d + e f { color: red }'),
  s('attribute-selector', 'a[href^="http" i] { color: red }'),
  s('pseudo', 'li:nth-child(2n + 1):not(.x, .y)::before { content: "•" }'),
  s('nested-rule', '.a { color: red; .b { color: blue } }'),
  s('custom-property', ':root { --x: red; --y: ; --z: foo(bar) baz }'),
  s('var-fallback', 'a { color: var(--x, blue) }'),
  s('numbers-units', 'a { width: calc(100% - 2.5em); z-index: -3; opacity: .5 }'),
  s('colors', 'a { color: #fff; background: #11223344; border-color: rgb(1 2 3 / 40%) }'),
  s('url', 'a { background: url(foo.png); mask: url("bar.svg") }'),
  s('font-shorthand', 'a { font: italic small-caps 700 12px/1.5 "Helvetica Neue", sans-serif }'),
  s('media-simple', '@media screen { a { color: red } }'),
  s('media-feature', '@media (min-width: 100px) { a { color: red } }'),
  s('media-range', '@media (100px <= width <= 200px) { a { color: red } }'),
  s('media-not-parens', '@media (NoT (a)) { a { b: c } }'),
  s('media-and-parens', '@media ((a) AnD (b)) { a { b: c } }'),
  s('media-or-nested', '@media ((a) or ((b) and (c))) { a { b: c } }'),
  s('media-list', '@media only screen and (min-width: 1px), print { a { b: c } }'),
  s('container', '@container (height > 670px) { a { b: c } }'),
  s('container-named', '@container card (width > 400px) { a { b: c } }'),
  s('supports', '@supports (display: grid) and (not (display: inline-grid)) { a { b: c } }'),
  s('supports-selector', '@supports selector(a:has(b)) { a { b: c } }'),
  s('keyframes', '@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }'),
  s('font-face', '@font-face { font-family: "X"; src: url(x.woff2) format("woff2") }'),
  s('layer', '@layer base { a { color: red } }'),
  s('charset-import', '@charset "utf-8";\n@import url("a.css") screen;'),
  s('page', '@page :first { margin: 1in }'),
  s('property', '@property --x { syntax: "<color>"; inherits: false; initial-value: red }'),
  s('comments', '/* head */\na { /* mid */ color: red /* tail */ }\n/* foot */'),
  s('escapes', '.\\31 23 { content: "\\"q\\"" }'),
  s('unicode-range', '@font-face { unicode-range: U+0025-00FF, U+4?? }')
];

const lessSources: CorpusSource[] = [
  /*
   * The widest single-file node surface the repo owns (it is the perf
   * feature-exercise workload) — real authored breadth the snippets cannot reach.
   */
  readSource('benchmark.less', 'packages/jess/benchmark/benchmark.less'),
  s('variable', '@x: red; a { color: @x }'),
  s('mixin', '.m(@a; @b: 2) { width: @a }\n.use { .m(1; 2) }'),
  s('guard', '.g(@x) when (@x > 0) and (iscolor(red)) { x: @x }'),
  s('extend', '.a:extend(.b all) { color: red }\n.c { &:extend(.d) }'),
  s('detached-ruleset', '@dr: { prop: val; };\n.use { @dr() }'),
  s('map-lookup', '@map: { primary: blue; };\n.m { color: @map[primary] }'),
  s('interp-selector', '.sel-@{name} { color: red }'),
  s('interp-value', '.q { content: "a@{b}c"; background: ~"raw" }'),
  s('operations', '.o { width: (1px + 2px) * 3; margin: -@x }'),
  s('import-options', '@import (reference, optional) "file.less";'),
  s('line-comment', '// head\na { b: c } // tail'),
  s('nested-media', '.a { @media (min-width: 1px) and (max-width: 2px) { b: c } }'),
  s('mixin-call-important', '.use { .m() !important }')
];

const scssSources: CorpusSource[] = [
  s('variable', '$x: red !default; a { color: $x }'),
  s('interpolation', 'a { #{$prop}-size: #{$v}px }'),
  s('interp-selector', '.sel-#{$name} { color: red }'),
  s('mixin', '@mixin m($a, $b: 2) { width: $a }\n.use { @include m(1, 2) }'),
  s('mixin-content', '@mixin m { @content }\n.use { @include m { a: b } }'),
  s('function', '@function f($x) { @return $x * 2 }\n.u { width: f(2px) }'),
  s('control', '@if $a == 1 { a: b } @else if $a { c: d } @else { e: f }'),
  s('each-for-while', '@each $k, $v in (a: 1, b: 2) { .#{$k} { x: $v } }\n@for $i from 1 through 3 { .c#{$i} { y: $i } }'),
  s('map', '$m: (a: 1, b: (c: 2));\n.u { x: map-get($m, a) }'),
  s('placeholder-extend', '%p { color: red }\n.a { @extend %p }'),
  s('use-forward', '@use "sass:math" as m;\n@forward "src/list" hide list-reset;'),
  s('nested-props', 'a { font: { family: serif; size: 1px } }'),
  s('line-comment', '// head\na { b: c } // tail'),
  s('at-root', '.a { @at-root .b { c: d } }'),
  s('diagnostics', '@debug "d";\n@warn "w";'),
  s('media-interp', '@media #{$q} and (min-width: 1px) { a { b: c } }'),
  s('media-nested-parens', '@media (not (a)) { a { b: c } }'),
  s('media-deep-parens', '@media ((a) and ((b) or (c))) { a { b: c } }'),
  s('media-string-paren', '@media (a: ")") { b { c: d } }'),
  s('supports-nested-parens', '@supports (not (display: grid)) { a { b: c } }'),
  s('unknown-at-rule-group', '@unknown ((a) [b] "c") { d { e: f } }')
];

const jessSources: CorpusSource[] = [
  s('ruleset', 'a { color: red }'),
  s('variable', '$x: red; a { color: $x }'),
  s('interp-name', '${name}-suffix { color: red }'),
  s('lookup', '$m: { a: 1 }; .u { x: $m[a] }'),
  s('expression-interp', 'a { content: $(1 + 2) }'),
  s('line-comment', '// head\na { b: c } // tail'),
  s('nested', '.a { .b { c: d } &:hover { e: f } }'),
  s('media', '@media (min-width: 1px) { a { b: c } }')
];

const dialects: Dialect[] = [
  {
    name: 'css',
    parse: parseCssCst as (input: string) => CstParseResult,
    trivia: TRIVIA_ALLOWANCE.css,
    sources: sharedCssSources
  },
  {
    name: 'less',
    parse: parseLessCst as (input: string) => CstParseResult,
    trivia: TRIVIA_ALLOWANCE.preprocessor,
    sources: [...sharedCssSources, ...lessSources]
  },
  {
    name: 'scss',
    parse: parseScssCst as (input: string) => CstParseResult,
    trivia: TRIVIA_ALLOWANCE.preprocessor,
    sources: [...sharedCssSources, ...scssSources]
  },
  {
    name: 'jess',
    parse: parseJessCst as (input: string) => CstParseResult,
    trivia: TRIVIA_ALLOWANCE.preprocessor,
    sources: [...sharedCssSources, ...jessSources]
  }
];

describe('CST token coverage', () => {
  for (const dialect of dialects) {
    describe(dialect.name, () => {
      for (const source of dialect.sources) {
        it(`leaves reconstruct the source: ${source.label}`, () => {
          const violations = checkSource(dialect, source);
          const index = new Map([[`${dialect.name}:${source.label}`, source.text]]);
          expect(formatViolations(violations, index)).toBe('');
        });
      }
    });
  }

  /*
   * The probe is only worth its runtime if it actually detects a hole, so assert
   * its detection directly against a synthetic tree that consumes a span without a
   * leaf over it. Without this, a probe silently degraded to "always passes" would
   * look identical to a clean corpus.
   */
  it('detects an uncovered non-trivia span', () => {
    const text = '@media (not (a)) {}';
    const holed: CstParseResult = {
      ok: true,
      unconsumedFrom: null,
      tree: {
        _tag: 'node',
        type: 'StyleSheet',
        span: { start: 0, end: text.length },
        children: [
          { _tag: 'leaf', value: '@media', span: { start: 0, end: 6 } },
          { _tag: 'leaf', value: '(', span: { start: 7, end: 8 } },
          { _tag: 'leaf', value: 'not ', span: { start: 8, end: 12 } },
          /* `(a)` at [12,15] deliberately consumed with no leaf. */
          { _tag: 'leaf', value: ')', span: { start: 15, end: 16 } },
          { _tag: 'leaf', value: '{', span: { start: 17, end: 18 } },
          { _tag: 'leaf', value: '}', span: { start: 18, end: 19 } }
        ]
      }
    };
    const violations: Violation[] = checkSource(
      { name: 'probe', parse: () => holed, trivia: TRIVIA_ALLOWANCE.preprocessor, sources: [] },
      s('synthetic', text)
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('uncovered');
    expect(violations[0]!.span).toEqual({ start: 12, end: 15 });
  });
});
