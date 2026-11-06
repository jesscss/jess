import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * A control block's body holds what any nested block holds, and each statement
 * means what it means there. Every expectation is what `sass --no-source-map`
 * 1.101.7 writes for the source, with the blank line it writes between top-level
 * rules dropped. Sources follow Bootstrap 5.3.8 `_progress.scss`, `_grid.scss`,
 * `_dropdown.scss`, `_card.scss` and Foundation 6.9.0 `_menu.scss`.
 * https://sass-lang.com/documentation/at-rules/control/if/
 */
const cases: ReadonlyArray<readonly [string, string, string]> = [
  ['@keyframes in an @if', '$x: true; @if $x { @keyframes spin { from { a: b; } to { a: c; } } }', '@keyframes spin {\n  from {\n    a: b;\n  }\n  to {\n    a: c;\n  }\n}\n'],
  ['a leading combinator in an @if', '$x: true; .a { @if $x { > * { b: c; } } }', '.a > * {\n  b: c;\n}\n'],
  ['a leading combinator under a rule in an @if', '$x: true; @if $x { .row { > * { b: c; } } }', '.row > * {\n  b: c;\n}\n'],
  ['a parent selector in an @if', '$x: true; .a { @if $x { &:not(:last-child) { b: c; } } }', '.a:not(:last-child) {\n  b: c;\n}\n'],
  ['declarations and a leading combinator in an @else', '$x: false; .m { @if $x { a: b; } @else { display: table; > li { display: table-cell; } } }', '.m {\n  display: table;\n}\n.m > li {\n  display: table-cell;\n}\n'],
  ['@media in an @if in a rule', '$x: true; .a { @if $x { @media screen { b: c; } } }', '@media screen {\n  .a {\n    b: c;\n  }\n}\n'],
  ['@font-face in a mixin', '@mixin m { @font-face { font-family: a; } } @include m;', '@font-face {\n  font-family: a;\n}\n'],
  ['@keyframes in a mixin in a rule', '@mixin m { @keyframes k { from { a: b; } } } .a { @include m; b: c; }', '@keyframes k {\n  from {\n    a: b;\n  }\n}\n.a {\n  b: c;\n}\n'],
  ['a rule in a @while', '$x: 2; @while $x > 0 { .w-#{$x} { > .q { b: c; } } $x: $x - 1; }', '.w-2 > .q {\n  b: c;\n}\n.w-1 > .q {\n  b: c;\n}\n']
];

describe('statements in a control block', () => {
  it.each(cases)('%s', async (_label, source, css) => {
    expect(await new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' })).toBe(css);
  });
});
