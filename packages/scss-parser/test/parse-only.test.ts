import { describe, expect, it } from 'vitest';
import { Parser } from '../src/index.js';
import { TreeContext } from '@jesscss/core';

type ParseCase = {
  name: string;
  src: string;
  options?: Parameters<Parser['parse']>[2];
};

type ErrorCase = ParseCase & {
  message?: string;
};

const parser = new Parser();

function expectParseOk({ src, options }: ParseCase) {
  const result = parser.parse(src, 'stylesheet', options);
  expect(result.lexerResult.errors.map(error => error.message)).toEqual([]);
  expect(result.errors.map(error => error.message)).toEqual([]);
  expect(result.tree).toBeDefined();
}

function expectSingleParseError({ src, options, message }: ErrorCase) {
  const result = parser.parse(src, 'stylesheet', options);
  expect(result.lexerResult.errors.map(error => error.message)).toEqual([]);
  expect(result.errors.length).toBeGreaterThan(0);
  if (message) {
    expect(result.errors[0]?.message).toContain(message);
  }
}

const positiveCases: ParseCase[] = [
  { name: 'basic CSS', src: '.a { color: red; }' },
  { name: 'Sass map literal', src: '.a { x: ("regular": 400, "medium": 500); }' },
  { name: 'nested property declarations', src: '.a { font: { size: 1rem; weight: bold; } }' },
  { name: 'nested property declarations with base value', src: '.a { margin: auto { left: 1px; right: 2px; } }' },
  { name: 'map.get() desugaring input', src: '.a { x: map.get($font-weights, "medium"); }' },
  { name: '@content', src: '@content;' },
  { name: '@content with args', src: '@content($color, $count);' },
  { name: '@if / @else if / @else', src: '@if 1 = 1 { .a { color: red; } } @else if 2 = 2 { .b { color: blue; } } @else { .c { color: green; } }' },
  { name: '@if == comparison', src: '@if $a == $b { .x { y: 1; } }' },
  { name: '@if != comparison', src: '@if $a != $b { .x { y: 1; } }' },
  { name: '@mixin definition', src: '@mixin foo($a, $b: 2, ...$rest) { @content; }' },
  { name: 'interpolation inside @mixin name', src: '@mixin foo-#{$bar} { .a { color: red; } }' },
  { name: '@function definition', src: '@function add($a, $b: 2) { @return $a; }' },
  { name: 'plain function call', src: '.a { color: fn($x); }' },
  { name: '@include mixin call', src: '@include wrap(red);' },
  { name: 'interpolation inside @include mixin name', src: '@include foo-#{$bar}();' },
  { name: '@include module-qualified mixin call', src: '@include ns.foo($x);' },
  { name: '@include using block', src: '@include wrap(red) using ($c, $n) { .child { color: $c; z-index: $n; } }' },
  { name: '@use import', src: '@use "foo";' },
  { name: 'legacy Sass @import as StyleImport', src: '@import "foo";' },
  { name: 'legacy Sass multi @import', src: '@import "a", "b";' },
  { name: 'nested legacy Sass @import', src: '.scope { @import "foo"; }' },
  { name: 'plain CSS @import preserved', src: '@import "foo.css";' },
  { name: '@use namespace override', src: '@use "foo" as bar;' },
  { name: '@use wildcard namespace', src: '@use "foo" as *;' },
  { name: '@use sass builtin', src: '@use "sass:map";' },
  { name: '@forward import', src: '@forward "foo";' },
  { name: '@forward with config', src: '@forward "foo" with ($a: #{$b});' },
  { name: '@extend statement', src: '.a { @extend .b; }' },
  { name: 'placeholder @extend', src: '.a { @extend %foo; }' },
  { name: 'placeholder ruleset', src: '%foo { color: red; }' },
  { name: 'interpolated @extend target', src: '.a { @extend .b-#{$c}; }' },
  { name: 'allowed selector-list @extend targets', src: '.a { @extend .b, .c; }' },
  { name: 'module-member variable reference', src: '.a { color: ns.$c; }' },
  { name: 'module-qualified function call', src: '.a { color: ns.fn($x); }' },
  { name: '@each loop', src: '@each $a in $list { .x { y: $a; } }' },
  { name: '@each destructuring loop', src: '@each $a, $b in $list { .x { y: $a; z: $b; } }' },
  { name: '@for through loop', src: '@for $i from 1 through 3 { .x { y: $i; } }' },
  { name: '@for to loop', src: '@for $i from 1 to 3 { .x { y: $i; } }' },
  { name: 'escaped module-qualified mixin-ruleset call', src: '.a { color: ns.\\#foo($x); }' },
  { name: '$var declaration', src: '$foo: 1;' },
  { name: '$var declaration with recovery enabled', src: '$foo: 1;', options: { recoveryEnabled: true } },
  { name: '$var followed by rule with recovery enabled', src: '$foo: 1; .bar { color: red; }', options: { recoveryEnabled: true } },
  { name: '$var flags !default and !global', src: '$foo: 1 !default; $bar: 2 !global;' },
  { name: 'interpolation inside strings', src: '.a { content: "foo-#{$bar}"; }' },
  { name: 'interpolation inside selectors', src: '.foo-#{$bar} { color: red; }' },
  { name: 'interpolation inside declaration names', src: '.a { #{$prop}: red; }' },
  { name: 'interpolation inside custom property names', src: '.a { --x-#{$y}: red; }' },
  { name: 'interpolation inside @media prelude', src: '@media #{$cond} { .a { color: red; } }' },
  { name: 'interpolation inside @supports prelude', src: '@supports #{$cond} { .a { color: red; } }' },
  { name: 'interpolation inside @container prelude', src: '@container #{$cond} { .a { color: red; } }' },
  { name: 'interpolation inside @scope prelude', src: '@scope #{$cond} { .a { color: red; } }' },
  { name: 'interpolation inside @layer names', src: '@layer foo-#{$bar} { .a { color: red; } }' },
  { name: '@use with interpolated config values', src: '@use "foo" with ($a: #{$b});' },
  { name: '@use with config var flags', src: '@use "foo" with ($a: 1 !default, $b: 2 !global);' },
  { name: 'diagnostic at-rules', src: '@debug "x"; @warn "y"; @error "z";' },
  { name: '@at-root', src: '@at-root { .a { color: red; } }' },
  { name: '@at-root selector shorthand', src: '@at-root .a { color: red; }' }
];

const errorCases: ErrorCase[] = [
  {
    name: 'compound @extend target rejection',
    src: '.a { @extend .b.c; }',
    options: { context: new TreeContext({ allowExtendSelectors: ['simple'] }) },
    message: '@extend only allows simple selectors'
  },
  {
    name: '@forward prefixing rejection',
    src: '@forward "foo" as bar-*;',
    message: '@forward with "as <prefix>-*" prefixing is not supported'
  },
  {
    name: '@forward show/hide rejection',
    src: '@forward "foo" show $a, mixin-b, fn-c;',
    message: '@forward with "show"/"hide" lists is not supported'
  },
  {
    name: '@at-root filter rejection',
    src: '@at-root (without: media) { .a { color: red; } }',
    message: '@at-root prelude/filter forms are not yet supported in Jess'
  }
];

describe('scss-parser (parse only)', () => {
  for (const testCase of positiveCases) {
    it(`parses ${testCase.name}`, () => {
      expectParseOk(testCase);
    });
  }

  for (const testCase of errorCases) {
    it(`reports parse error for ${testCase.name}`, () => {
      expectSingleParseError(testCase);
    });
  }
});
