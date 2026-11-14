import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * `--#{…}` where a value goes is one identifier: the Sass interpolation docs say
 * it can be used "in almost any place in a stylesheet" and the result is part of
 * the token around it (https://sass-lang.com/documentation/interpolation/).
 *
 * Every snippet is taken from Bootstrap 5.3.8 (`scss/_alert.scss`, `_grid.scss`,
 * `_reboot.scss`, `mixins/_grid.scss`, `_badge.scss`, `_variables.scss`), and every
 * expectation is what `sass --no-source-map` 1.101.7 writes for it.
 */
const cases: ReadonlyArray<readonly [string, string, string]> = [
  ['a var() name', '$prefix: bs-; .a { color: var(--#{$prefix}alert-color); }', '.a {\n  color: var(--bs-alert-color);\n}\n'],
  ['a var() name with a fallback', '$prefix: bs-; $g: 1px; .a { gap: var(--#{$prefix}gap, #{$g}); }', '.a {\n  gap: var(--bs-gap, 1px);\n}\n'],
  ['two holes in one name', '$prefix: bs-; $state: info; .a { color: var(--#{$prefix}#{$state}-text-emphasis); }', '.a {\n  color: var(--bs-info-text-emphasis);\n}\n'],
  ['a name inside rgba()', '$prefix: bs-; .a { color: rgba(var(--#{$prefix}body-color-rgb), .75); }', '.a {\n  color: rgba(var(--bs-body-color-rgb), 0.75);\n}\n'],
  ['a name inside calc()', '$prefix: bs-; .a { margin: calc(-.5 * var(--#{$prefix}gutter-x)); }', '.a {\n  margin: calc(-0.5 * var(--bs-gutter-x));\n}\n'],
  ['a name that ends in the hole', '$name: bs; .a { color: var(--theme-#{$name}); }', '.a {\n  color: var(--theme-bs);\n}\n'],
  ['a name passed to a mixin', '@mixin rfs($v, $p) { #{$p}: $v; } $prefix: bs-; .badge { @include rfs(1px, --#{$prefix}badge-font-size); }', '.badge {\n  --bs-badge-font-size: 1px;\n}\n'],
  ['a name in a variable default', '$prefix: bs-; $kbd-bg: var(--#{$prefix}body-color) !default; .a { b: $kbd-bg; }', '.a {\n  b: var(--bs-body-color);\n}\n']
];

describe('an interpolated custom-property name in a value', () => {
  it.each(cases)('%s', async (_label, source, css) => {
    expect(await new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' })).toBe(css);
  });
});
