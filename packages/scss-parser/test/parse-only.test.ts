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
  { name: 'map.get() desugaring input', src: '.a { x: map.get($font-weights, "medium"); }' },
  { name: '@content', src: '@content;' },
  { name: '@if / @else if / @else', src: '@if 1 = 1 { .a { color: red; } } @else if 2 = 2 { .b { color: blue; } } @else { .c { color: green; } }' },
  { name: '@if == comparison', src: '@if $a == $b { .x { y: 1; } }' },
  { name: '@if != comparison', src: '@if $a != $b { .x { y: 1; } }' },
  { name: '@mixin definition', src: '@mixin foo($a, $b: 2, ...$rest) { @content; }' },
  { name: '@function definition', src: '@function add($a, $b: 2) { @return $a; }' },
  { name: 'plain function call', src: '.a { color: fn($x); }' },
  { name: '@use import', src: '@use "foo";' },
  { name: '@use namespace override', src: '@use "foo" as bar;' },
  { name: '@use wildcard namespace', src: '@use "foo" as *;' },
  { name: '@use sass builtin', src: '@use "sass:map";' },
  { name: '@forward import', src: '@forward "foo";' },
  { name: '@forward prefixing', src: '@forward "foo" as bar-*;' },
  { name: '@forward show/hide lists', src: '@forward "foo" show $a, mixin-b, fn-c; @forward "foo" hide $a, mixin-b, fn-c;' },
  { name: '@forward with config', src: '@forward "foo" with ($a: #{$b});' },
  { name: '@extend statement', src: '.a { @extend .b; }' },
  { name: 'placeholder @extend', src: '.a { @extend %foo; }' },
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
  { name: '@at-root', src: '@at-root { .a { color: red; } }' }
];

const errorCases: ErrorCase[] = [
  {
    name: 'compound @extend target rejection',
    src: '.a { @extend .b.c; }',
    options: { context: new TreeContext({ allowExtendSelectors: ['simple'] }) },
    message: '@extend only allows simple selectors'
  }
];

const rejectionCases: ErrorCase[] = [
  {
    name: 'interpolation inside @include mixin name',
    src: '@include foo-#{$bar}();'
  },
  {
    name: 'interpolation inside @mixin name',
    src: '@mixin foo-#{$bar} { .a { color: red; } }'
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

  for (const testCase of rejectionCases) {
    it(`rejects ${testCase.name}`, () => {
      expectSingleParseError(testCase);
    });
  }
});
