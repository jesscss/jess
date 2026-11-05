import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * `#{…}` holds a SassScript expression and writes its value without the quotes
 * of a lone string: https://sass-lang.com/documentation/interpolation/. Every
 * expectation is what `sass --no-source-map` 1.101.7 writes for the source. The
 * sources follow Bootstrap 5.3.8 `scss/_offcanvas.scss` and `scss/_close.scss`.
 */
const cases: ReadonlyArray<readonly [string, string, string]> = [
  ['a space list in a custom-property value', '$d: .3s; .a { --x: #{transform $d ease-in-out}; }', '.a {\n  --x: transform 0.3s ease-in-out;\n}\n'],
  ['a space list in a declaration', '.a { x: #{a b}; }', '.a {\n  x: a b;\n}\n'],
  ['a space list in a variable', '$v: #{a b}; .b { c: $v; }', '.b {\n  c: a b;\n}\n'],
  ['arithmetic inside a space list', '.a { x: #{1 + 1 2}; }', '.a {\n  x: 2 2;\n}\n'],
  ['a padded hole in a custom-property value', '$c: red; .a { --b: #{ $c }; }', '.a {\n  --b: red;\n}\n'],
  ['a padded call in a custom-property value', '@function e($x) { @return $x; } .a { --b: #{ e(1) }; }', '.a {\n  --b: 1;\n}\n']
];

describe('interpolation hole', () => {
  it.each(cases)('%s', async (_label, source, css) => {
    expect(await new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension: '.scss' })).toBe(css);
  });
});
