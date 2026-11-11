import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * Each expectation is what `sass --no-source-map` 1.101.7 writes for the source
 * (https://sass-lang.com/documentation/at-rules/extend/), except that a selector list is
 * written one branch per line here. The placing rule is ledger J15: each call applies
 * the extend to the rule it lands in. The first spelling is Foundation 6.9.0's
 * `components/_reveal.scss`.
 */
const cases: ReadonlyArray<readonly [string, string]> = [
  ['%p { c: d; } @mixin m { @extend %p; e: f; } .a { @include m; }', '.a {\n  c: d;\n}\n.a {\n  e: f;\n}\n'],
  ['%p { c: d; } @mixin m { @extend %p; } .a { @include m; }', '.a {\n  c: d;\n}\n'],
  ['%p { c: d; } @mixin m { @extend %p; e: f; } .a { &:hover { @include m; } }', '.a:hover {\n  c: d;\n}\n.a:hover {\n  e: f;\n}\n'],
  ['.w { %p { c: d; } } @mixin m { @extend %p; } .a { @include m; }', '.w .a {\n  c: d;\n}\n'],
  ['%p { c: d; } @mixin m { @extend %p; } .x { y: z; }', '.x {\n  y: z;\n}\n'],
  ['.b { c: d; } @mixin m { @extend .b; } .a { @include m; }', '.b,\n.a {\n  c: d;\n}\n'],
  ['.b { c: d; } @mixin m { @extend .b !optional; } .a { @include m; }', '.b,\n.a {\n  c: d;\n}\n'],
  ['@mixin m { & { @extend %p; } } %p { c: d; } .a { @include m; }', '.a {\n  c: d;\n}\n'],
  ['%p { c: d; } @mixin m { .e { @extend %p; } } .a { @include m; }', '.a .e {\n  c: d;\n}\n'],
  ['%p { c: d; } .x { y: z; } .a { @each $i in 1 { .e { @extend %p; } } }', '.a .e {\n  c: d;\n}\n.x {\n  y: z;\n}\n']
];

describe('`@extend` directly in a mixin body', () => {
  it.each(cases)('%s', async (source, css) => {
    expect(await new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' })).toBe(css);
  });
});
