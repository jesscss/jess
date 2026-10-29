import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * `@each $key, $value in $map` destructures each map entry as its `key value`
 * pair: a map iterates as its list of pairs. A name past the item's last value
 * binds null, so a declaration that reads it is dropped. Every expectation is
 * Dart Sass 1.101.7's output (Jess writes no blank line between rules).
 */
const render = async (source: string): Promise<string> =>
  new Compiler().renderString(source, { extension: '.scss' });

const cases: ReadonlyArray<readonly [name: string, source: string, expected: string]> = [
  [
    'a map variable read only through the value name',
    '$cfgs: (a: 1);\n@each $k, $v in $cfgs { x { c: $v; } }',
    'x {\n  c: 1;\n}\n'
  ],
  [
    'an inline map',
    '@each $k, $v in (primary: blue) { .t { k: $k; v: $v; } }',
    '.t {\n  k: primary;\n  v: blue;\n}\n'
  ],
  [
    'a map variable with quoted keys, into an interpolated selector',
    '$theme-colors: ("primary": #0d6efd, "danger": #dc3545);\n'
    + '@each $color, $value in $theme-colors { .text-#{$color} { color: $value !important; } }',
    '.text-primary {\n  color: #0d6efd !important;\n}\n.text-danger {\n  color: #dc3545 !important;\n}\n'
  ],
  [
    'a map with number keys',
    '$spacers: (0: 0, 1: .25rem);\n@each $key, $value in $spacers { .m-#{$key} { margin: $value; } }',
    '.m-0 {\n  margin: 0;\n}\n.m-1 {\n  margin: 0.25rem;\n}\n'
  ],
  [
    'a map value read in a media query',
    '$grid-breakpoints: (sm: 576px, md: 768px);\n'
    + '@each $name, $width in $grid-breakpoints { @media (min-width: $width) { .container-#{$name} { max-width: $width; } } }',
    '@media (min-width: 576px) {\n  .container-sm {\n    max-width: 576px;\n  }\n}\n'
    + '@media (min-width: 768px) {\n  .container-md {\n    max-width: 768px;\n  }\n}\n'
  ],
  [
    'a nested map read with map-get and map.get',
    '@use "sass:map";\n'
    + '@each $key, $m in (x: (a: 1)) { .#{$key} { b: map-get($m, a); c: map.get($m, a); } }',
    '.x {\n  b: 1;\n  c: 1;\n}\n'
  ],
  [
    'a nested map driving an inner map loop',
    '@use "sass:map";\n'
    + '$utilities: ("opacity": (property: opacity, class: opacity, values: (0: 0, 50: .5)));\n'
    + '@each $key, $utility in $utilities { @each $k, $v in map.get($utility, values) '
    + '{ .#{map.get($utility, class)}-#{$k} { #{map.get($utility, property)}: $v; } } }',
    '.opacity-0 {\n  opacity: 0;\n}\n.opacity-50 {\n  opacity: 0.5;\n}\n'
  ],
  [
    'three names over a map of lists: the value stays whole and the third name is null',
    '@each $a, $b, $c in (x: 1 2, y: 3 4) { .three { a: $a; b: $b; c: $c; } }',
    '.three {\n  a: x;\n  b: 1 2;\n}\n.three {\n  a: y;\n  b: 3 4;\n}\n'
  ],
  [
    'two names over a list of two-item lists',
    '@each $a, $b in (1 2, 3 4) { .l { a: $a; b: $b; } }',
    '.l {\n  a: 1;\n  b: 2;\n}\n.l {\n  a: 3;\n  b: 4;\n}\n'
  ],
  [
    'three names over a list of two-item lists: the third name is null',
    '@each $a, $b, $c in (1 2, 3 4) { .l { a: $a; b: $b; c: $c; } }',
    '.l {\n  a: 1;\n  b: 2;\n}\n.l {\n  a: 3;\n  b: 4;\n}\n'
  ]
];

describe('scss: @each destructuring a map entry', () => {
  it.each(cases)('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });
});
